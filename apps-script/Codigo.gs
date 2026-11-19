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

var URL_APP = 'https://script.google.com/macros/s/AKfycbxzVMle5jtoI35yGDvp8s7jng9twf7V6lw539LDs5i2h2rE8etXrK58w9ZXV9ZdSYQ/exec';
function urlScript() { return URL_APP; }   // fija: desde la tarea horaria Google devuelve otra dirección

function miLink(id) { return SITIO + 'mi.html?id=' + encodeURIComponent(id) + '&t=' + firma('mi', id); }
function bajaLink(id) { return urlScript() + '?accion=baja&id=' + encodeURIComponent(id) + '&t=' + firma('baja', id); }
function enc(id) { return encodeURIComponent(id); }
function propio(id) { return (sb('get', 'propios?id=eq.' + enc(id) + '&select=*') || [])[0] || {}; }
function num(p) { return p && p.numero ? '#' + p.numero : ''; }
function fecha(d) { return Utilities.formatDate(new Date(d), 'America/Asuncion', 'dd/MM/yyyy'); }
function quedanCorreos() { return MailApp.getRemainingDailyQuota(); }

/* descuento de un código para un plan; devuelve { ok, monto, original, codigo } */
function aplicarCupon(codigo, dias) {
  var original = precio(dias);
  codigo = String(codigo || '').trim().toUpperCase();
  if (!codigo) return { ok: true, monto: original, original: original, codigo: null };
  var c = (sb('get', 'cupones?codigo=eq.' + enc(codigo) + '&select=*') || [])[0];
  var hoy = Utilities.formatDate(new Date(), 'America/Asuncion', 'yyyy-MM-dd');
  if (!c || c.activo === false) return { ok: false, error: 'Ese código no existe.' };
  if (c.vence && String(c.vence) < hoy) return { ok: false, error: 'Ese código ya venció.' };
  if (c.usos_max && (c.usos || 0) >= c.usos_max) return { ok: false, error: 'Ese código ya se usó todas las veces.' };
  if (c.dias && Number(c.dias) !== Number(dias)) return { ok: false, error: 'Ese código es para el plan de ' + c.dias + ' días.' };
  var monto = original;
  if (c.descuento_pct) monto = Math.round(original * (100 - c.descuento_pct) / 100 / 1000) * 1000;
  if (c.descuento_gs) monto = original - c.descuento_gs;
  if (c.precio_final) monto = c.precio_final;
  return { ok: true, monto: Math.max(0, monto), original: original, codigo: codigo };
}

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
    if (d.tipo === 'mi') return json(accionMiAviso(d));
    if (d.tipo === 'link') return json(reenviarLinks(d));
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
  if (String(d.barrio || '').trim().length < 3) return { ok: false, error: 'Escribí el barrio.' };
  if (String(d.direccion || '').trim().length < 4) return { ok: false, error: 'Escribí la dirección.' };
  if (String(d.descripcion || '').trim().length < 20) return { ok: false, error: 'Contá un poco más en la descripción.' };
  if (!d.precio) return { ok: false, error: 'Escribí el precio.' };
  if (d.informe !== true) return { ok: false, error: 'Marcá la casilla para recibir la confirmación de tu aviso.' };
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
  var fila = sb('post', 'propios', { id: id, email: d.email.trim().toLowerCase(), whatsapp: wa, ia: d.ia || null, quien: d.quien || null,
                          direccion: d.direccion || null, ubic: d.ubic || null, extras: d.extras || {}, informe: true });
  var numero = (fila && fila[0] && fila[0].numero) || null;

  var rev = revisarAviso({ titulo: aviso.titulo, descripcion: aviso.descripcion, ia: d.ia }, d.fotos);
  var fotos = d.fotos.slice(0, 12).map(function (f, i) { return Utilities.newBlob(Utilities.base64Decode(f.data), f.mime || 'image/jpeg', 'foto' + (i + 1) + '.jpg'); });
  correoAviso(aviso, Object.assign({}, d, { numero: numero }), rev, fotos);
  return { ok: true, id: id, numero: numero };
}

function recibirPago(d) {
  var dias = [7, 15, 30].indexOf(Number(d.dias)) >= 0 ? Number(d.dias) : null;
  if (!dias) return { ok: false, error: 'Elegí un plan.' };
  if (!d.comprobante || !d.comprobante.data) return { ok: false, error: 'Adjuntá el comprobante.' };
  limitar('pago:' + d.id, 4);
  var filas = sb('get', 'avisos?id=eq.' + encodeURIComponent(d.id) + '&select=*');
  if (!filas || !filas.length) return { ok: false, error: 'No encontramos tu aviso.' };
  var aviso = filas[0];
  var cup = aplicarCupon(d.cupon, dias);
  if (!cup.ok) return { ok: false, error: cup.error };
  var monto = cup.monto;
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
                          estado: 'pendiente', lectura: lectura, comprobante_url: ruta, cupon: cup.codigo });
  correoPago(aviso, propio, { codigo: codigoPedido, dias: dias, monto: monto, cupon: cup.codigo, original: cup.original }, lectura, archivo);
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

function fichaHtml(aviso, d, imgs) {
  var fotos = (imgs || []).map(function (blob, i) {
    return '<img src="cid:f' + (i + 1) + '" alt="Foto ' + (i + 1) + '" style="width:180px;height:130px;object-fit:cover;border-radius:10px;margin:0 6px 6px 0">';
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
    fila('Publica', d.quien) + fila('Correo', d.email) + fila('WhatsApp', d.whatsapp) + fila('Aviso', d.numero ? '#' + d.numero : '') +
    '</table>';
}

function inline(imgs) {
  var o = {};
  (imgs || []).forEach(function (b, i) { o['f' + (i + 1)] = b; });
  return o;
}

/* trae las fotos ya subidas para meterlas dentro del correo (Gmail no siempre carga las de afuera) */
function fotosDe(aviso) {
  return (aviso.fotos || []).slice(0, 12).map(function (u, i) {
    try {
      var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
      return r.getResponseCode() < 300 ? r.getBlob().setName('foto' + (i + 1) + '.jpg') : null;
    } catch (e) { return null; }
  }).filter(function (b) { return b; });
}

function moderacionHtml(rev) {
  if (!rev || (rev.ok && !(rev.problemas || []).length)) return '<p style="background:#ECFDF3;color:#05603A;padding:12px 14px;border-radius:10px;font-weight:700">Gemini no vio nada raro en las fotos ni en el texto.</p>';
  return '<p style="background:#FEF3F2;color:#B42318;padding:12px 14px;border-radius:10px;font-weight:700">Ojo, Gemini marcó esto: ' +
    esc((rev.problemas || []).join(' · ')) + (rev.fotos_malas && rev.fotos_malas.length ? ' · fotos ' + rev.fotos_malas.join(', ') : '') + '</p>';
}

function correoAviso(aviso, d, rev, imgs) {
  var html = '<div style="font-family:Arial,sans-serif;color:#101828;max-width:760px">' +
    '<p style="font-size:16px">Llegó un aviso nuevo para publicar en DóndeVivo.</p>' + moderacionHtml(rev) +
    fichaHtml(aviso, d, imgs) + '<div style="margin:22px 0">' +
    boton('Aprobar y publicar', enlace('aprobar', aviso.id), '#0B7A5E') + boton('Rechazar', enlace('rechazar_aviso', aviso.id), '#B42318') +
    '</div></div>';
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: '🏠 Nuevo aviso ' + (d.numero ? '#' + d.numero + ' ' : '') + 'para revisar en DóndeVivo, ' + aviso.titulo,
    htmlBody: html, inlineImages: inline(imgs) });
}

function correoPago(aviso, propio, pedido, lectura, archivo) {
  var imgs = fotosDe(aviso);
  var chequeos = (lectura.chequeos || []).map(function (c) {
    return '<li style="margin:4px 0;color:' + (c[1] ? '#05603A' : '#B42318') + '">' + (c[1] ? '✔ ' : '✖ ') + esc(c[0]) + '</li>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif;color:#101828;max-width:760px">' +
    '<p style="font-size:18px;font-weight:800">Aviso ' + (num(propio) || aviso.id) + ' · plan de ' + pedido.dias + ' días · ' + (pedido.monto != null ? gs(pedido.monto) : 'monto a confirmar') + ' · pedido ' + pedido.codigo + '</p>' +
    (pedido.cupon ? '<p style="margin:0 0 10px;font-weight:700;color:#B54708">Usó el código ' + esc(pedido.cupon) + ' (precio normal ' + gs(pedido.original) + ')</p>' : '') +
    '<p style="margin:0 0 6px;font-weight:700">Lo que leyó Gemini del comprobante (adjunto):</p><ul style="padding-left:18px;margin:0 0 10px">' + chequeos + '</ul>' +
    '<p style="color:#667085">Antes de confirmar, fijate en tu banco que la plata haya entrado.</p>' +
    '<div style="margin:18px 0">' + boton('Confirmar pago', enlace('confirmar', pedido.codigo), '#0B7A5E') +
    boton('No recibí el pago', enlace('no_recibido', pedido.codigo), '#B42318') +
    boton('Rechazar y reembolsar', enlace('reembolsar', pedido.codigo), '#475467') + '</div>' +
    '<p style="color:#667085;font-size:14px">Rechazar y reembolsar es para cuando la plata entró pero el aviso no sirve. El reembolso lo hacés vos desde tu cuenta, el correo solo le avisa.</p>' +
    (aviso.activo ? '' : '<p style="font-weight:700">Este aviso todavía no está publicado. Al confirmar el pago se publica y se destaca.</p>') +
    fichaHtml(aviso, { direccion: propio.direccion, ia: propio.ia, quien: propio.quien, email: propio.email, whatsapp: propio.whatsapp, numero: propio.numero }, imgs) +
    '</div>';
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '💰 Sumaste una venta de ' + (pedido.monto != null ? gs(pedido.monto) : 'un destacado') + ' en DóndeVivo',
    htmlBody: html, attachments: [archivo], inlineImages: inline(imgs)
  });
}

function avisarAnunciante(id, asunto, texto, aunqueBaja) {
  var p = propio(id);
  if (!p.email || (p.baja && !aunqueBaja)) return false;
  MailApp.sendEmail({ to: p.email, subject: asunto + (p.numero ? ' · aviso #' + p.numero : ''), name: 'DóndeVivo',
    htmlBody: '<div style="font-family:Arial,sans-serif;color:#101828;font-size:16px;line-height:1.5;max-width:600px">' + texto +
      '<p style="margin:26px 0 8px">' + boton('Ver mi aviso', miLink(id), '#1F4FE0') + '</p>' +
      '<p style="color:#667085;font-size:13px">DóndeVivo · todas las casas y deptos de Paraguay en un solo lugar<br>' +
      'Si no querés recibir más estos correos, <a href="' + bajaLink(id) + '" style="color:#667085">date de baja acá</a>.</p></div>' });
  return true;
}

/* ---------------- botones de los correos ---------------- */

var ACCIONES = {
  aprobar: 'Publicar este aviso', rechazar_aviso: 'Rechazar este aviso',
  confirmar: 'Confirmar el pago y destacar', no_recibido: 'No recibí el pago',
  reembolsar: 'Rechazar y reembolsar', rechazar_pago: 'No recibí el pago'
};

function doGet(e) {
  var p = e.parameter || {};
  if (p.accion === 'mi') {
    try { return json(datosMiAviso(p.id, p.t)); }
    catch (err) { return json({ ok: false, error: 'No pudimos cargar tu aviso. Probá de nuevo en un rato.', detalle: String(err).slice(0, 200) }); }
  }
  if (p.accion === 'cupon') {
    try { return json(aplicarCupon(p.codigo, Number(p.dias))); }
    catch (err) { return json({ ok: false, error: 'No pudimos revisar el código. Probá de nuevo.', detalle: String(err).slice(0, 200) }); }
  }
  if (p.accion === 'baja') {
    if (!p.id || p.t !== firma('baja', p.id)) return HtmlService.createHtmlOutput('<p style="font-family:Arial;font-size:18px">Este enlace no es válido.</p>');
    sb('patch', 'propios?id=eq.' + enc(p.id), { baja: true });
    return HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;text-align:center;color:#101828">' +
      '<h2>Listo, no te mandamos más correos.</h2><p style="color:#667085">Tu aviso sigue publicado igual.</p></div>').setTitle('DóndeVivo');
  }
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
  t.color = /rechazar|no_recibido|reembolsar/.test(p.accion) ? '#B42318' : '#0B7A5E';
  return t.evaluate().setTitle('DóndeVivo');
}

function ejecutar(accion, id, t) {
  if (!ACCIONES[accion] || t !== firma(accion, id)) throw new Error('enlace no válido');
  var ahora = new Date();
  if (accion === 'aprobar') {
    sb('patch', 'avisos?id=eq.' + encodeURIComponent(id), { activo: true, motivo_baja: null });
    sb('patch', 'propios?id=eq.' + encodeURIComponent(id), { estado: 'publicado', publicado: ahora.toISOString() });
    avisarAnunciante(id, 'Tu inmueble ya está publicado en DóndeVivo',
      '<p>¡Listo! Tu inmueble ya está publicado en DóndeVivo.</p>' +
      '<p>En tu página privada ves cuánta gente lo mira, lo podés pausar o marcar como alquilado o vendido, y lo podés destacar para que aparezca primero. ' +
      'Mañana te mandamos tus primeras visitas.</p>', true);
    return 'Aviso publicado. Ya se ve en la web en la próxima actualización.';
  }
  if (accion === 'rechazar_aviso') {
    sb('patch', 'avisos?id=eq.' + encodeURIComponent(id), { activo: false, motivo_baja: 'rechazado' });
    sb('patch', 'propios?id=eq.' + encodeURIComponent(id), { estado: 'rechazado' });
    avisarAnunciante(id, 'Tu aviso en DóndeVivo necesita cambios',
      '<p>Revisamos tu aviso y no lo pudimos publicar así. Escribinos por WhatsApp y lo vemos juntos.</p>' +
      '<p><a href="https://wa.me/' + WHATSAPP_AUGUSTO + '">Escribir por WhatsApp</a></p>', true);
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
    var pp = propio(pedido.aviso_id);
    sb('patch', 'propios?id=eq.' + encodeURIComponent(pedido.aviso_id), { estado: 'publicado', publicado: pp.publicado || ahora.toISOString() });
    if (pedido.cupon) {
      var cu = (sb('get', 'cupones?codigo=eq.' + enc(pedido.cupon) + '&select=usos') || [])[0];
      if (cu) sb('patch', 'cupones?codigo=eq.' + enc(pedido.cupon), { usos: (cu.usos || 0) + 1 });
    }
    avisarAnunciante(pedido.aviso_id, 'Tu aviso ya está destacado en DóndeVivo',
      '<p>Recibimos tu pago. Tu aviso ya está destacado hasta el ' + fecha(hasta) + ' y aparece primero en las búsquedas que coinciden con tu inmueble.</p>', true);
    return 'Pago confirmado. Destacado hasta el ' + Utilities.formatDate(hasta, 'America/Asuncion', 'dd/MM/yyyy') + '.';
  }
  if (accion === 'no_recibido' || accion === 'rechazar_pago') {
    sb('patch', 'pedidos?codigo=eq.' + encodeURIComponent(id), { estado: 'no_recibido', resuelto: ahora.toISOString() });
    avisarAnunciante(pedido.aviso_id, 'No encontramos tu transferencia en DóndeVivo',
      '<p>Revisamos nuestra cuenta y no encontramos la transferencia de tu destacado (pedido ' + esc(pedido.codigo) + '). ' +
      'Si ya la hiciste, escribinos por WhatsApp con el comprobante y lo resolvemos.</p>' +
      '<p><a href="https://wa.me/' + WHATSAPP_AUGUSTO + '">Escribir por WhatsApp</a></p>', true);
    return 'Listo. Le avisamos que no encontramos la transferencia.';
  }
  if (accion === 'reembolsar') {
    sb('patch', 'pedidos?codigo=eq.' + encodeURIComponent(id), { estado: 'reembolso', resuelto: ahora.toISOString() });
    sb('patch', 'avisos?id=eq.' + encodeURIComponent(pedido.aviso_id), { activo: false, motivo_baja: 'rechazado', destacado_hasta: null });
    sb('patch', 'propios?id=eq.' + encodeURIComponent(pedido.aviso_id), { estado: 'rechazado' });
    avisarAnunciante(pedido.aviso_id, 'Tuvimos un inconveniente con tu aviso en DóndeVivo',
      '<p>Revisamos tu aviso y hubo un inconveniente, así que no lo pudimos publicar ni destacar (pedido ' + esc(pedido.codigo) + ').</p>' +
      '<p>Te devolvemos el dinero de tu destacado en las próximas horas a la cuenta desde donde transferiste. ' +
      'Si tenés alguna duda, escribinos por WhatsApp.</p>' +
      '<p><a href="https://wa.me/' + WHATSAPP_AUGUSTO + '">Escribir por WhatsApp</a></p>', true);
    return 'Listo. Le avisamos que le devolvés el dinero. Acordate de hacer la transferencia de ' + gs(pedido.monto || 0) + '.';
  }
}

/* ---------------- página privada Mi aviso ---------------- */

function visitasDe(id, desdeIso) {
  return sb('get', 'visitas?aviso_id=eq.' + enc(id) + (desdeIso ? '&dia=gte.' + desdeIso.slice(0, 10) : '') + '&select=dia,vistas,contactos&order=dia.asc') || [];
}

function sumar(filas) {
  return filas.reduce(function (t, f) { t.vistas += f.vistas || 0; t.contactos += f.contactos || 0; return t; }, { vistas: 0, contactos: 0 });
}

function datosMiAviso(id, t) {
  if (!id || t !== firma('mi', id)) return { ok: false, error: 'Este link no es válido. Pedí uno nuevo con tu correo.' };
  var a = (sb('get', 'avisos?id=eq.' + enc(id) + '&select=id,titulo,precio,moneda,operacion,ciudad,barrio,fotos,activo,motivo_baja,destacado_hasta,publicado_en') || [])[0];
  if (!a) return { ok: false, error: 'No encontramos este aviso.' };
  var p = propio(id), filas = visitasDe(id);
  return {
    ok: true, numero: p.numero, estado: p.estado, baja: !!p.baja, publicado: p.publicado,
    aviso: { titulo: a.titulo, precio: a.precio, moneda: a.moneda, operacion: a.operacion, ciudad: a.ciudad, barrio: a.barrio,
             foto: (a.fotos || [])[0] || null, activo: a.activo, motivo: a.motivo_baja, destacado_hasta: a.destacado_hasta,
             url: SITIO + '#/aviso/' + enc(id) },
    visitas: filas, total: sumar(filas),
    planes: { 7: precio(7), 15: precio(15), 30: precio(30) }
  };
}

function accionMiAviso(d) {
  if (!d.id || d.t !== firma('mi', d.id)) return { ok: false, error: 'Este link no es válido.' };
  limitar('mi:' + d.id, 20);
  var a = (sb('get', 'avisos?id=eq.' + enc(d.id) + '&select=activo,motivo_baja') || [])[0];
  if (!a) return { ok: false, error: 'No encontramos este aviso.' };
  if (a.motivo_baja === 'en revisión' || a.motivo_baja === 'rechazado') return { ok: false, error: 'Tu aviso todavía no está publicado.' };
  var cambios = {
    pausar: { activo: false, motivo_baja: 'pausado' },
    reactivar: { activo: true, motivo_baja: null },
    alquilado: { activo: false, motivo_baja: 'alquilado' },
    vendido: { activo: false, motivo_baja: 'vendido' },
    baja_correos: null, alta_correos: null
  };
  if (!(d.op in cambios)) return { ok: false, error: 'Acción desconocida.' };
  if (d.op === 'baja_correos' || d.op === 'alta_correos') { sb('patch', 'propios?id=eq.' + enc(d.id), { baja: d.op === 'baja_correos' }); return { ok: true }; }
  sb('patch', 'avisos?id=eq.' + enc(d.id), cambios[d.op]);
  return { ok: true };
}

/* si alguien perdió su link, se lo mandamos de nuevo al correo con el que publicó */
function reenviarLinks(d) {
  var mail = String(d.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, error: 'Revisá tu correo.' };
  limitar('link:' + mail, 3);
  var filas = sb('get', 'propios?email=eq.' + enc(mail) + '&select=id,numero&order=creado.desc') || [];
  if (filas.length) {
    var avisos = sb('get', 'avisos?id=in.(' + filas.map(function (f) { return '"' + f.id + '"'; }).join(',') + ')&select=id,titulo') || [];
    var tit = {}; avisos.forEach(function (x) { tit[x.id] = x.titulo; });
    var lista = filas.map(function (f) {
      return '<p style="margin:10px 0"><a href="' + miLink(f.id) + '" style="font-weight:700;color:#1F4FE0">' + esc(tit[f.id] || 'Tu aviso') + '</a>' +
        (f.numero ? ' <span style="color:#667085">· #' + f.numero + '</span>' : '') + '</p>';
    }).join('');
    MailApp.sendEmail({ to: mail, subject: 'Tus avisos en DóndeVivo', name: 'DóndeVivo',
      htmlBody: '<div style="font-family:Arial,sans-serif;color:#101828;font-size:16px;max-width:600px"><p>Acá tenés el link de cada uno de tus avisos:</p>' + lista + '</div>' });
  }
  return { ok: true };   // misma respuesta exista o no, para no revelar qué correos publicaron
}

/* ---------------- correos automáticos (corre cada hora) ---------------- */

function informeHtml(id, p, titulo, desdeIso, etiqueta) {
  var tot = sumar(visitasDe(id)), parcial = sumar(visitasDe(id, desdeIso));
  return '<p>' + etiqueta + ' tu aviso <b>' + esc(titulo) + '</b> tuvo <b>' + parcial.vistas + ' visitas</b> y <b>' + parcial.contactos +
    (parcial.contactos === 1 ? ' persona tocó' : ' personas tocaron') + ' contactar</b>.</p>' +
    '<p style="color:#475467">Desde que lo publicaste suma ' + tot.vistas + ' visitas y ' + tot.contactos + ' contactos.</p>';
}

function tarea() {
  var ahora = new Date(), hora = Number(Utilities.formatDate(ahora, 'America/Asuncion', 'H'));
  if (hora < 9 || hora > 20) return;                         // no escribimos de noche
  var propios = sb('get', 'propios?estado=eq.publicado&baja=is.false&select=*') || [];
  if (!propios.length) return;
  var avisos = sb('get', 'avisos?id=in.(' + propios.map(function (f) { return '"' + f.id + '"'; }).join(',') + ')&select=id,titulo,activo,destacado_hasta') || [];
  var porId = {}; avisos.forEach(function (a) { porId[a.id] = a; });
  var hoy = Utilities.formatDate(ahora, 'America/Asuncion', 'yyyy-MM-dd');

  // 1) cuenta regresiva del destacado (lo más importante: es plata)
  propios.forEach(function (p) {
    var a = porId[p.id];
    if (!a || !a.destacado_hasta || quedanCorreos() < 5) return;
    var hasta = new Date(a.destacado_hasta);
    var diaFin = Utilities.formatDate(hasta, 'America/Asuncion', 'yyyy-MM-dd');
    var faltan = Math.round((new Date(diaFin + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 864e5);
    if ([3, 2, 1, 0].indexOf(faltan) < 0) return;
    var marcas = p.avisos_destacado || {}, clave = diaFin + ':' + faltan;
    if (marcas[clave]) return;
    var asunto = faltan === 0 ? 'Hoy termina tu destacado en DóndeVivo' : faltan === 1 ? 'Falta 1 día para que termine tu destacado' : 'Faltan ' + faltan + ' días para que termine tu destacado';
    var texto = (faltan === 0 ? '<p>Hoy termina el destacado de <b>' + esc(a.titulo) + '</b>. Desde mañana tu aviso deja de aparecer primero.</p>'
                              : '<p>Tu aviso <b>' + esc(a.titulo) + '</b> sigue destacado hasta el ' + fecha(hasta) + '.</p>') +
      '<p>Si lo renovás antes de que termine, los días nuevos se suman a los que te quedan.</p>';
    if (avisarAnunciante(p.id, asunto, texto)) { marcas[clave] = true; sb('patch', 'propios?id=eq.' + enc(p.id), { avisos_destacado: marcas }); }
  });

  // 2) informe de visitas: a las 24 h de publicado y después cada 2 días
  propios.forEach(function (p) {
    var a = porId[p.id];
    if (!a || !a.activo || !p.informe || !p.publicado || quedanCorreos() < 15) return;
    var desde = p.ultimo_informe ? new Date(p.ultimo_informe) : new Date(p.publicado);
    var espera = p.ultimo_informe ? 48 : 24;
    if ((ahora - desde) / 36e5 < espera) return;
    var etiqueta = p.ultimo_informe ? 'En los últimos 2 días' : 'En su primer día';
    var destacado = a.destacado_hasta && new Date(a.destacado_hasta) > ahora;
    var texto = informeHtml(p.id, p, a.titulo, desde.toISOString(), etiqueta) +
      (destacado ? '' : '<p>Si lo destacás, aparece primero en las búsquedas que coinciden con tu inmueble y lo ve más gente.</p>');
    if (avisarAnunciante(p.id, p.ultimo_informe ? 'Tus visitas de los últimos 2 días en DóndeVivo' : 'Tus primeras visitas en DóndeVivo', texto)) {
      sb('patch', 'propios?id=eq.' + enc(p.id), { ultimo_informe: ahora.toISOString() });
    }
  });
}

/* Correr una vez a mano para dar permisos y crear el secreto. */
function configurar() {
  secreto();
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tarea'; });
  if (!hay) ScriptApp.newTrigger('tarea').timeBased().everyHours(1).create();

  Logger.log('Listo. URL de la web app: ' + urlScript());
}
