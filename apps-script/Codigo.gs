/**
 * DóndeVivo · recepción de avisos y pagos de destacados.
 *
 * Corre en la cuenta de Google de Augusto (Apps Script, gratis):
 *  - recibe desde la web cada aviso nuevo de Publicá y cada comprobante de pago,
 *  - guarda fotos y comprobantes en Supabase (los comprobantes en una carpeta privada),
 *  - le pide a Gemini que revise fotos, texto y comprobante,
 *  - manda un correo a Augusto con todo y botones para aprobar, confirmar o rechazar,
 *  - al confirmar, publica el aviso y lo destaca por los días del plan.
 *
 * Las claves NO van en este archivo. Se cargan a mano en
 * Configuración del proyecto > Propiedades de la secuencia de comandos:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY
 */

var SITIO = 'https://pablonicron-oss.github.io/dondevivo-robot/';
var WHATSAPP_AUGUSTO = '595983458755';
var PLANES = { 7: null, 15: null, 30: null };   // precios en guaraníes; se completan en Propiedades (PRECIO_7, PRECIO_15, PRECIO_30)

/* ---------------- utilidades ---------------- */

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function secreto() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('SECRETO');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRETO', s); }
  return s;
}

function firma(accion, id) {
  var b = Utilities.computeHmacSha256Signature(accion + '|' + id, secreto());
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('').slice(0, 32);
}

function precio(dias) {
  var v = prop('PRECIO_' + dias);
  return v ? parseInt(String(v).replace(/\D/g, ''), 10) : null;
}

function gs(n) { return 'Gs. ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function urlScript() { return ScriptApp.getService().getUrl(); }

/* ---------------- Supabase ---------------- */

function sb(metodo, ruta, cuerpo, extra) {
  var opciones = {
    method: metodo, muteHttpExceptions: true,
    headers: Object.assign({
      apikey: prop('SUPABASE_SERVICE_KEY'),
      Authorization: 'Bearer ' + prop('SUPABASE_SERVICE_KEY'),
      'Content-Type': 'application/json', Prefer: 'return=representation'
    }, extra || {})
  };
  if (cuerpo !== undefined) opciones.payload = JSON.stringify(cuerpo);
  var r = UrlFetchApp.fetch(prop('SUPABASE_URL') + '/rest/v1/' + ruta, opciones);
  if (r.getResponseCode() >= 300) throw new Error('Supabase ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
  var t = r.getContentText();
  return t ? JSON.parse(t) : null;
}

function subirFoto(ruta, base64, mime) {
  var r = UrlFetchApp.fetch(prop('SUPABASE_URL') + '/storage/v1/object/fotos/' + ruta, {
    method: 'post', muteHttpExceptions: true, contentType: mime || 'image/jpeg',
    headers: { Authorization: 'Bearer ' + prop('SUPABASE_SERVICE_KEY'), 'x-upsert': 'true' },
    payload: Utilities.base64Decode(base64)
  });
  if (r.getResponseCode() >= 300) throw new Error('No se pudo guardar una foto: ' + r.getResponseCode());
  return prop('SUPABASE_URL') + '/storage/v1/object/public/fotos/' + ruta;
}

/* ---------------- Gemini ---------------- */

function modelosGemini() {
  var c = CacheService.getScriptCache(), m = c.get('modelos');
  if (m) return JSON.parse(m);
  var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': prop('GEMINI_API_KEY') }, muteHttpExceptions: true });
  var lista = (JSON.parse(r.getContentText()).models || []).filter(function (x) {
    return (x.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && /gemini/.test(x.name) &&
      !/(preview|exp|tts|image|live|embedding|omni|pro)/.test(x.name);
  }).map(function (x) { return x.name.split('/').pop(); });
  lista.sort(function (a, b) {   // primero los flash estables y conocidos, que tienen cupo gratis
    var p = function (n) { return /latest/.test(n) ? 0 : /^gemini-\d+(\.\d+)?-flash$/.test(n) ? 1 : /flash-lite/.test(n) ? 3 : 2; };
    return p(a) - p(b) || (b > a ? 1 : -1);
  });
  if (lista.indexOf('gemini-flash-latest') < 0) lista.unshift('gemini-flash-latest');
  c.put('modelos', JSON.stringify(lista.slice(0, 8)), 21600);
  return lista.slice(0, 8);
}

function gemini(partes) {
  var cuerpo = { contents: [{ parts: partes }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } };
  var c = CacheService.getScriptCache(), bueno = c.get('modelo');
  var lista = modelosGemini().slice();
  if (bueno) lista.unshift(bueno);
  for (var i = 0; i < lista.length && i < 6; i++) {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + lista[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': prop('GEMINI_API_KEY') }, payload: JSON.stringify(cuerpo)
    });
    var code = r.getResponseCode();
    if (code < 300) {
      c.put('modelo', lista[i], 21600);
      var d = JSON.parse(r.getContentText());
      return JSON.parse(d.candidates[0].content.parts[0].text);
    }
    if (code >= 500) Utilities.sleep(4000);     // si el problema es del servidor, espera y sigue con otro
  }
  return null;
}

function revisarAviso(a, fotos) {
  var partes = [{ text:
    'Sos moderador de un portal inmobiliario de Paraguay. Revisá este aviso que publicó un usuario. ' +
    'Marcá como problema: fotos con desnudos, contenido sexual, violencia, personas en primer plano, memes, ' +
    'capturas de pantalla, fotos que no son de un inmueble, o texto ofensivo, estafas, datos de contacto ' +
    'escritos encima de las fotos. Respondé solo JSON: {"ok": true/false, "problemas": ["..."], "fotos_malas": [indices empezando en 1]}.\n\n' +
    'Título: ' + a.titulo + '\nDescripción: ' + (a.descripcion || '') + '\nTexto para la IA: ' + (a.ia || '') }];
  fotos.slice(0, 8).forEach(function (f) { partes.push({ inline_data: { mime_type: f.mime || 'image/jpeg', data: f.data } }); });
  try { return gemini(partes) || { ok: true, problemas: ['No se pudo revisar con Gemini, miralo vos.'] }; }
  catch (e) { return { ok: true, problemas: ['No se pudo revisar con Gemini, miralo vos.'] }; }
}

function leerComprobante(base64, mime, monto, codigo) {
  var partes = [{ text:
    'Esto es un comprobante de transferencia bancaria de Paraguay. Extraé los datos y respondé solo JSON: ' +
    '{"monto": numero en guaranies sin puntos o null, "fecha": "AAAA-MM-DD" o null, "cuenta_destino": "texto o null", ' +
    '"titular_destino": "texto o null", "banco": "texto o null", "concepto": "texto o null", "parece_editado": true/false}' }];
  partes.push({ inline_data: { mime_type: mime, data: base64 } });
  var l = null;
  try { l = gemini(partes); } catch (e) { l = null; }
  if (!l) return { leido: false, chequeos: [['No se pudo leer el comprobante, revisalo vos', false]] };
  var hoy = new Date(), fecha = l.fecha ? new Date(l.fecha + 'T12:00:00') : null;
  var dias = fecha ? Math.abs(hoy - fecha) / 864e5 : 99;
  var cuenta = String(prop('CUENTA_NUMERO') || '').replace(/\D/g, '');
  var destino = String(l.cuenta_destino || '').replace(/\D/g, '');
  var chequeos = [
    ['Monto ' + (l.monto ? gs(l.monto) : 'no legible') + (monto ? ' (esperado ' + gs(monto) + ')' : ''), !!(l.monto && monto && Number(l.monto) >= monto)],
    ['Fecha ' + (l.fecha || 'no legible'), dias <= 2],
    ['Cuenta de destino ' + (l.cuenta_destino || 'no legible'), !!(cuenta && destino && (destino.indexOf(cuenta.slice(-6)) >= 0))],
    ['Código ' + codigo + ' en el concepto' + (l.concepto ? ' (dice ' + l.concepto + ')' : ''), !!(l.concepto && String(l.concepto).toUpperCase().replace(/\s/g, '').indexOf(codigo) >= 0)],
    [l.parece_editado ? 'Gemini cree que el comprobante podría estar editado' : 'No parece editado', !l.parece_editado]
  ];
  return { leido: true, datos: l, chequeos: chequeos };
}

/* ---------------- recepción desde la web ---------------- */

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.web) return json({ ok: true });                       // campo trampa para bots
    if (d.tipo === 'aviso') return json(recibirAviso(d));
    if (d.tipo === 'pago') return json(recibirPago(d));
    return json({ ok: false, error: 'pedido desconocido' });
  } catch (err) {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'DóndeVivo · error al recibir un envío', String(err && err.stack || err));
    return json({ ok: false, error: 'No pudimos recibirlo. Probá de nuevo en unos minutos.' });
  }
}

function limitar(clave, max) {
  var c = CacheService.getScriptCache(), n = parseInt(c.get(clave) || '0', 10);
  if (n >= max) throw new Error('Demasiados envíos seguidos');
  c.put(clave, String(n + 1), 3600);
}

function recibirAviso(d) {
  if (!d.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return { ok: false, error: 'Revisá tu correo.' };
  if (!d.whatsapp || String(d.whatsapp).replace(/\D/g, '').length < 9) return { ok: false, error: 'Revisá tu WhatsApp.' };
  if (!d.fotos || d.fotos.length < 3) return { ok: false, error: 'Sumá al menos 3 fotos.' };
  limitar('mail:' + d.email.toLowerCase(), 5);

  var id = 'dondevivo:' + Utilities.getUuid().slice(0, 8);
  var carpeta = id.replace(':', '-');
  var urls = d.fotos.slice(0, 12).map(function (f, i) { return subirFoto(carpeta + '/' + (i + 1) + '.jpg', f.data, f.mime); });
  var wa = String(d.whatsapp).replace(/\D/g, '').replace(/^0/, '595');
  var aviso = {
    id: id, fuente: 'dondevivo', url: SITIO + '#/aviso/' + encodeURIComponent(id),
    titulo: String(d.titulo || '').slice(0, 150), descripcion: String(d.descripcion || '').slice(0, 4000),
    operacion: d.operacion === 'venta' ? 'venta' : 'alquiler', tipo: d.tipo_inmueble || 'otro',
    estado_obra: null, precio: d.precio || null, moneda: d.moneda === 'USD' ? 'USD' : 'PYG',
    dormitorios: d.dormitorios || null, banos: d.banos || null, m2: d.m2 || null,
    ciudad: d.ciudad || null, barrio: d.barrio || null, departamento: null, region: d.region || 'resto',
    lat: null, lng: null, fotos: urls, fotos_total: urls.length, comodidades: d.comodidades || [],
    garantia: d.garantia || null, mascotas: d.mascotas || null, contacto: wa,
    activo: false, motivo_baja: 'en revisión', publicado_en: new Date().toISOString(),
    primera_vez: new Date().toISOString(), ultima_revision: new Date().toISOString()
  };
  sb('post', 'avisos', aviso);
  sb('post', 'propios', { id: id, email: d.email, whatsapp: wa, ia: d.ia || null, quien: d.quien || null,
                          direccion: d.direccion || null, ubic: d.ubic || null, extras: d.extras || {} });

  var rev = revisarAviso({ titulo: aviso.titulo, descripcion: aviso.descripcion, ia: d.ia }, d.fotos);
  correoAviso(aviso, d, rev);
  return { ok: true, id: id };
}

function recibirPago(d) {
  var dias = [7, 15, 30].indexOf(Number(d.dias)) >= 0 ? Number(d.dias) : null;
  if (!dias) return { ok: false, error: 'Elegí un plan.' };
  if (!d.comprobante || !d.comprobante.data) return { ok: false, error: 'Adjuntá el comprobante.' };
  limitar('pago:' + d.id, 4);
  var filas = sb('get', 'avisos?id=eq.' + encodeURIComponent(d.id) + '&select=*');
  if (!filas || !filas.length) return { ok: false, error: 'No encontramos tu aviso.' };
  var aviso = filas[0], monto = precio(dias);
  var propio = (sb('get', 'propios?id=eq.' + encodeURIComponent(d.id) + '&select=*') || [])[0] || {};
  var codigo = /^DV-\d{4}$/.test(String(d.codigo || '')) ? d.codigo : 'DV-' + Math.floor(1000 + Math.random() * 9000);
  if ((sb('get', 'pedidos?codigo=eq.' + codigo + '&select=codigo') || []).length) codigo += '-' + Math.floor(Math.random() * 90 + 10);

  var mime = d.comprobante.mime || 'application/pdf';
  var ext = mime.indexOf('pdf') >= 0 ? 'pdf' : mime.indexOf('png') >= 0 ? 'png' : 'jpg';
  var nombre = codigo + '-' + d.id.replace(':', '-') + '.' + ext;
  var archivo = Utilities.newBlob(Utilities.base64Decode(d.comprobante.data), mime, nombre);
  var ruta = guardarComprobante(nombre, archivo);

  var lectura = leerComprobante(d.comprobante.data, mime, monto, codigo);
  var codigoPedido = codigo;
  sb('post', 'pedidos', { codigo: codigoPedido, aviso_id: d.id, plan_dias: dias, monto: monto,
                          estado: 'pendiente', lectura: lectura, comprobante_url: ruta });
  correoPago(aviso, propio, { codigo: codigoPedido, dias: dias, monto: monto }, lectura, archivo);
  return { ok: true, codigo: codigoPedido };
}

function guardarComprobante(nombre, blob) {   // carpeta privada en Supabase (no ocupa tu Drive)
  var r = UrlFetchApp.fetch(prop('SUPABASE_URL') + '/storage/v1/object/comprobantes/' + nombre, {
    method: 'post', muteHttpExceptions: true, contentType: blob.getContentType(),
    headers: { Authorization: 'Bearer ' + prop('SUPABASE_SERVICE_KEY'), 'x-upsert': 'true' }, payload: blob.getBytes()
  });
  return r.getResponseCode() < 300 ? 'comprobantes/' + nombre : null;
}

/* ---------------- correos ---------------- */

function boton(texto, url, color) {
  return '<a href="' + url + '" style="display:inline-block;padding:14px 26px;border-radius:12px;background:' + color +
    ';color:#fff;text-decoration:none;font-weight:800;font-size:16px;margin:4px 8px 4px 0">' + texto + '</a>';
}

function enlace(accion, id) { return urlScript() + '?accion=' + accion + '&id=' + encodeURIComponent(id) + '&t=' + firma(accion, id); }

function fichaHtml(aviso, d) {
  var fotos = (aviso.fotos || []).map(function (u, i) {
    return '<img src="' + u + '" alt="Foto ' + (i + 1) + '" style="width:180px;height:130px;object-fit:cover;border-radius:10px;margin:0 6px 6px 0">';
  }).join('');
  var fila = function (k, v) { return v ? '<tr><td style="color:#667085;padding:4px 12px 4px 0;vertical-align:top">' + k + '</td><td style="padding:4px 0">' + esc(v) + '</td></tr>' : ''; };
  return '<div style="margin:18px 0">' + fotos + '</div>' +
    '<h2 style="margin:6px 0 4px">' + esc(aviso.titulo) + '</h2>' +
    '<table style="font-size:15px;border-collapse:collapse">' +
    fila('Operación', aviso.operacion) + fila('Tipo', aviso.tipo) +
    fila('Precio', aviso.precio ? (aviso.moneda === 'USD' ? 'USD ' : 'Gs. ') + String(aviso.precio).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : 'A convenir') +
    fila('Ciudad', aviso.ciudad) + fila('Barrio', aviso.barrio) + fila('Dirección', d.direccion) +
    fila('Dormitorios', aviso.dormitorios) + fila('Baños', aviso.banos) + fila('Metros', aviso.m2 ? aviso.m2 + ' m²' : '') +
    fila('Mascotas', aviso.mascotas) + fila('Garantía', aviso.garantia) +
    fila('Descripción', aviso.descripcion) + fila('Para la IA', d.ia) +
    fila('Publica', d.quien) + fila('Correo', d.email) + fila('WhatsApp', d.whatsapp) +
    '</table>';
}

function moderacionHtml(rev) {
  if (!rev || (rev.ok && !(rev.problemas || []).length)) return '<p style="background:#ECFDF3;color:#05603A;padding:12px 14px;border-radius:10px;font-weight:700">Gemini no vio nada raro en las fotos ni en el texto.</p>';
  return '<p style="background:#FEF3F2;color:#B42318;padding:12px 14px;border-radius:10px;font-weight:700">Ojo, Gemini marcó esto: ' +
    esc((rev.problemas || []).join(' · ')) + (rev.fotos_malas && rev.fotos_malas.length ? ' · fotos ' + rev.fotos_malas.join(', ') : '') + '</p>';
}

function correoAviso(aviso, d, rev) {
  var html = '<div style="font-family:Arial,sans-serif;color:#101828;max-width:760px">' +
    '<p style="font-size:16px">Llegó un aviso nuevo para publicar en DóndeVivo.</p>' + moderacionHtml(rev) +
    fichaHtml(aviso, d) + '<div style="margin:22px 0">' +
    boton('Aprobar y publicar', enlace('aprobar', aviso.id), '#0B7A5E') + boton('Rechazar', enlace('rechazar_aviso', aviso.id), '#B42318') +
    '</div></div>';
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: '🏠 Nuevo aviso para revisar en DóndeVivo, ' + aviso.titulo, htmlBody: html });
}

function correoPago(aviso, propio, pedido, lectura, archivo) {
  var chequeos = (lectura.chequeos || []).map(function (c) {
    return '<li style="margin:4px 0;color:' + (c[1] ? '#05603A' : '#B42318') + '">' + (c[1] ? '✔ ' : '✖ ') + esc(c[0]) + '</li>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif;color:#101828;max-width:760px">' +
    '<p style="font-size:18px;font-weight:800">Plan de ' + pedido.dias + ' días · ' + (pedido.monto ? gs(pedido.monto) : 'monto a confirmar') + ' · pedido ' + pedido.codigo + '</p>' +
    '<p style="margin:0 0 6px;font-weight:700">Lo que leyó Gemini del comprobante (adjunto):</p><ul style="padding-left:18px;margin:0 0 10px">' + chequeos + '</ul>' +
    '<p style="color:#667085">Antes de confirmar, fijate en tu banco que la plata haya entrado.</p>' +
    '<div style="margin:18px 0">' + boton('Confirmar pago', enlace('confirmar', pedido.codigo), '#0B7A5E') +
    boton('Rechazar', enlace('rechazar_pago', pedido.codigo), '#B42318') + '</div>' +
    (aviso.activo ? '' : '<p style="font-weight:700">Este aviso todavía no está publicado. Al confirmar el pago se publica y se destaca.</p>') +
    fichaHtml(aviso, { direccion: propio.direccion, ia: propio.ia, quien: propio.quien, email: propio.email, whatsapp: propio.whatsapp }) +
    '</div>';
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '💰 Sumaste una venta de ' + (pedido.monto ? gs(pedido.monto) : 'un destacado') + ' en DóndeVivo',
    htmlBody: html, attachments: [archivo]
  });
}

function avisarAnunciante(id, asunto, texto) {
  var p = (sb('get', 'propios?id=eq.' + encodeURIComponent(id) + '&select=email') || [])[0];
  if (!p || !p.email) return;
  MailApp.sendEmail({ to: p.email, subject: asunto, name: 'DóndeVivo',
    htmlBody: '<div style="font-family:Arial,sans-serif;color:#101828;font-size:16px;max-width:600px">' + texto +
      '<p style="color:#667085">DóndeVivo · todas las casas y deptos de Paraguay en un solo lugar</p></div>' });
}

/* ---------------- botones de los correos ---------------- */

var ACCIONES = {
  aprobar: 'Publicar este aviso', rechazar_aviso: 'Rechazar este aviso',
  confirmar: 'Confirmar el pago y destacar', rechazar_pago: 'Rechazar este pago'
};

function doGet(e) {
  var p = e.parameter || {};
  if (!ACCIONES[p.accion] || !p.id || p.t !== firma(p.accion, p.id)) {
    return HtmlService.createHtmlOutput('<p style="font-family:Arial;font-size:18px">Este enlace no es válido.</p>');
  }
  var t = HtmlService.createTemplate(
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#101828">' +
    '<h2><?= titulo ?></h2><p style="color:#667085">Pedido o aviso <?= id ?></p>' +
    '<button id="b" style="font-size:18px;font-weight:800;padding:16px 30px;border:0;border-radius:14px;color:#fff;background:<?= color ?>;cursor:pointer" ' +
    'onclick="this.disabled=true;this.textContent=\'Un momento...\';google.script.run.withSuccessHandler(function(m){document.getElementById(\'r\').textContent=m;document.getElementById(\'b\').style.display=\'none\'}).withFailureHandler(function(e){document.getElementById(\'r\').textContent=\'No se pudo: \'+e.message}).ejecutar(\'<?= accion ?>\',\'<?= id ?>\',\'<?= t ?>\')"><?= titulo ?></button>' +
    '<p id="r" style="font-size:17px;font-weight:700;margin-top:24px"></p></div>');
  t.titulo = ACCIONES[p.accion]; t.id = p.id; t.accion = p.accion; t.t = p.t;
  t.color = /rechazar/.test(p.accion) ? '#B42318' : '#0B7A5E';
  return t.evaluate().setTitle('DóndeVivo');
}

function ejecutar(accion, id, t) {
  if (!ACCIONES[accion] || t !== firma(accion, id)) throw new Error('enlace no válido');
  var ahora = new Date();
  if (accion === 'aprobar') {
    sb('patch', 'avisos?id=eq.' + encodeURIComponent(id), { activo: true, motivo_baja: null });
    sb('patch', 'propios?id=eq.' + encodeURIComponent(id), { estado: 'publicado' });
    avisarAnunciante(id, 'Tu inmueble ya está publicado en DóndeVivo',
      '<p>¡Listo! Tu inmueble ya está publicado.</p><p><a href="' + SITIO + '#/aviso/' + encodeURIComponent(id) + '">Ver mi aviso</a></p>' +
      '<p>Si querés que lo vea más gente, podés destacarlo desde la web.</p>');
    return 'Aviso publicado. Ya se ve en la web en la próxima actualización.';
  }
  if (accion === 'rechazar_aviso') {
    sb('patch', 'avisos?id=eq.' + encodeURIComponent(id), { activo: false, motivo_baja: 'rechazado' });
    sb('patch', 'propios?id=eq.' + encodeURIComponent(id), { estado: 'rechazado' });
    avisarAnunciante(id, 'Tu aviso en DóndeVivo necesita cambios',
      '<p>Revisamos tu aviso y no lo pudimos publicar así. Escribinos por WhatsApp y lo vemos juntos.</p>' +
      '<p><a href="https://wa.me/' + WHATSAPP_AUGUSTO + '">Escribir por WhatsApp</a></p>');
    return 'Aviso rechazado. Le avisamos por correo.';
  }
  var pedido = (sb('get', 'pedidos?codigo=eq.' + encodeURIComponent(id) + '&select=*') || [])[0];
  if (!pedido) throw new Error('no encontramos el pedido');
  if (accion === 'confirmar') {
    if (pedido.estado === 'confirmado') return 'Este pago ya estaba confirmado.';
    var actual = (sb('get', 'avisos?id=eq.' + encodeURIComponent(pedido.aviso_id) + '&select=destacado_hasta') || [])[0] || {};
    var desde = actual.destacado_hasta && new Date(actual.destacado_hasta) > ahora ? new Date(actual.destacado_hasta) : ahora;
    var hasta = new Date(desde.getTime() + pedido.plan_dias * 864e5);
    sb('patch', 'avisos?id=eq.' + encodeURIComponent(pedido.aviso_id), { activo: true, motivo_baja: null, destacado_hasta: hasta.toISOString() });
    sb('patch', 'pedidos?codigo=eq.' + encodeURIComponent(id), { estado: 'confirmado', resuelto: ahora.toISOString() });
    sb('patch', 'propios?id=eq.' + encodeURIComponent(pedido.aviso_id), { estado: 'publicado' });
    avisarAnunciante(pedido.aviso_id, 'Tu aviso ya está destacado en DóndeVivo',
      '<p>Recibimos tu pago. Tu aviso ya está destacado hasta el ' +
      Utilities.formatDate(hasta, 'America/Asuncion', 'dd/MM/yyyy') + '.</p>' +
      '<p><a href="' + SITIO + '#/aviso/' + encodeURIComponent(pedido.aviso_id) + '">Ver mi aviso</a></p>');
    return 'Pago confirmado. Destacado hasta el ' + Utilities.formatDate(hasta, 'America/Asuncion', 'dd/MM/yyyy') + '.';
  }
  if (accion === 'rechazar_pago') {
    sb('patch', 'pedidos?codigo=eq.' + encodeURIComponent(id), { estado: 'rechazado', resuelto: ahora.toISOString() });
    avisarAnunciante(pedido.aviso_id, 'No pudimos confirmar tu pago en DóndeVivo',
      '<p>No pudimos confirmar la transferencia de tu destacado (pedido ' + esc(pedido.codigo) + '). ' +
      'Escribinos por WhatsApp y lo resolvemos.</p><p><a href="https://wa.me/' + WHATSAPP_AUGUSTO + '">Escribir por WhatsApp</a></p>');
    return 'Pago rechazado. Le avisamos por correo.';
  }
}

/* Correr una vez a mano para dar permisos y crear el secreto. */
function configurar() {
  secreto();

  Logger.log('Listo. URL de la web app: ' + urlScript());
}
