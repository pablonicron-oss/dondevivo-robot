/* DóndeVivo · web estática. Lee data/avisos.json (lo genera el robot) y no usa claves. */
(function () {
  "use strict";
  var $app = document.getElementById("app");
  var DATA = [], ACT = "";
  var FUENTES = { infocasas: "InfoCasas", remax: "RE/MAX", buscodepto: "BuscoDepto", century21: "Century 21" };
  var EJ = {
    alquiler: ["Tengo un gato y busco un depto en Luque", "Dos habitaciones en Asunción, una para mi oficina", "Monoambiente amoblado en Asunción",
      "Que acepte perros y tenga patio en San Lorenzo", "Casa de 3 dormitorios en Lambaré", "Depto de 1 dormitorio en Fernando de la Mora"],
    venta: ["Mi primera casa en Luque", "Depto en pozo en Asunción para invertir", "Dúplex a estrenar en San Lorenzo",
      "Casa de 3 dormitorios en Ciudad del Este", "Depto a estrenar en Villa Morra", "Casa con patio en Encarnación"]
  };
  var estado = { op: "alquiler" };

  /* ---------- utilidades ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function seguro(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function precio(a) {
    if (!a.p) return "Consultar precio";
    var n = Math.round(a.p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (a.m === "USD" ? "USD " : "₲ ") + n;
  }
  function porMes(a) { return a.op === "alquiler" && a.p ? " <small>por mes</small>" : ""; }
  function lugar(a) { return a.b ? esc(a.b) + ", " + esc(a.c || "") : esc(a.c || "Paraguay") + ' <span title="El anunciante no menciona el barrio">· barrio sin especificar</span>'; }
  function tipoTxt(t) { return { departamento: "Depto", casa: "Casa", duplex: "Dúplex", terreno: "Terreno" }[t] || "Inmueble"; }
  function q(params) { return Object.keys(params).filter(function (k) { return params[k] !== "" && params[k] != null; }).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&"); }
  function leerQ(s) { var o = {}; (s || "").split("&").forEach(function (p) { if (!p) return; var i = p.indexOf("="); o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }); return o; }
  function setOp(op) { estado.op = op; document.body.classList.toggle("compra", op === "venta"); }
  function ciudades() { var m = {}; DATA.forEach(function (a) { if (a.c) m[a.c] = (m[a.c] || 0) + 1; }); return Object.keys(m).sort(function (x, y) { return m[y] - m[x]; }); }
  function barrios(c) { var m = {}; DATA.forEach(function (a) { if (a.b && (!c || a.c === c)) m[a.b] = 1; }); return Object.keys(m).sort(); }

  /* ---------- lo que escribe la persona → filtros ---------- */
  function entender(texto, base) {
    var t = norm(texto), f = Object.assign({}, base);
    if (/\b(comprar|compro|venta|invertir|mi primera casa)\b/.test(t)) f.op = "venta";
    if (/\b(alquil|alquiler|rentar)/.test(t)) f.op = "alquiler";
    if (/\b(depto|departamento|monoambiente)\b/.test(t)) f.tipo = "departamento";
    else if (/\bduplex\b/.test(t)) f.tipo = "duplex";
    else if (/\bcasa\b/.test(t)) f.tipo = "casa";
    else if (/\bterreno\b/.test(t)) f.tipo = "terreno";
    if (/\b(gato|perro|mascota|mascotas)\b/.test(t)) f.masc = "si";
    if (/\b(pozo|preventa|invertir)\b/.test(t)) f.estado = "en_pozo";
    if (/\b(estrenar|nuevo)\b/.test(t)) f.estado = "a_estrenar";
    var d = t.match(/(\d)\s*(dormitorio|habitacion|hab|cuarto|pieza)/) || (/\b(un|1) dormitorio\b/.test(t) ? [0, "1"] : null);
    if (d) f.dor = d[1];
    if (/monoambiente/.test(t)) f.dor = "";
    ciudades().forEach(function (c) { if (t.indexOf(norm(c)) >= 0) f.ciudad = c; });
    barrios().forEach(function (b) { if (norm(b).length > 3 && t.indexOf(norm(b)) >= 0) { f.barrio = b; var a = DATA.find(function (x) { return x.b === b; }); if (a) f.ciudad = a.c; } });
    return f;
  }

  function filtrar(f) {
    return DATA.filter(function (a) {
      if (f.op && a.op !== f.op) return false;
      if (f.ciudad && a.c !== f.ciudad) return false;
      if (f.barrio && a.b !== f.barrio) return false;
      if (f.tipo && a.tp !== f.tipo) return false;
      if (f.masc === "si" && a.ms === "no") return false;
      if (f.masc === "confirmado" && a.ms !== "si") return false;
      if (f.estado && a.eo !== f.estado) return false;
      if (f.dor && (a.dor || 0) < +f.dor) return false;
      if (f.fuente && a.f !== f.fuente) return false;
      if (f.max && a.p && a.m === (f.mon || "PYG") && a.p > +f.max) return false;
      return true;
    });
  }

  /* ---------- tarjeta ---------- */
  function tarjeta(a) {
    var tags = [];
    if (a.dor) tags.push("<span>" + a.dor + " dorm.</span>");
    if (a.m2) tags.push("<span>" + Math.round(a.m2) + " m²</span>");
    if (a.ms === "si") tags.push('<span class="si">Acepta mascotas</span>');
    if (a.ms === "no") tags.push('<span class="no">Sin mascotas</span>');
    if (a.eo === "en_pozo") tags.push("<span>En pozo</span>");
    if (a.eo === "a_estrenar") tags.push("<span>A estrenar</span>");
    return '<a class="tarjeta" href="#/aviso/' + encodeURIComponent(a.id) + '">' +
      '<div class="foto" style="background-image:url(\'' + esc(seguro(a.ph[0])) + '\')"><span class="tag">' + tipoTxt(a.tp) + '</span><span class="src">Aviso de ' + esc(FUENTES[a.f] || a.f) + "</span></div>" +
      '<div class="info"><div class="precio">' + precio(a) + porMes(a) + '</div><div class="tit">' + esc(a.t) + '</div><div class="lugar">' + lugar(a) + '</div><div class="datos">' + tags.join("") + "</div></div></a>";
  }

  /* ---------- pantallas ---------- */
  function inicio() {
    var cs = ciudades(), ej = EJ[estado.op];
    var porFuente = {}; DATA.forEach(function (a) { porFuente[a.f] = 1; });
    $app.innerHTML =
      '<section class="hero"><div class="card-hero">' +
      '<div class="toggle" role="group" aria-label="Qué buscás"><button data-op="alquiler" aria-pressed="' + (estado.op === "alquiler") + '">Busco alquilar</button><button data-op="venta" aria-pressed="' + (estado.op === "venta") + '">Busco comprar</button></div>' +
      '<h1>Contanos qué buscás. <span class="ac">Nosotros lo encontramos.</span></h1>' +
      '<form class="buscador" id="fb"><label class="sr" for="qB" style="position:absolute;left:-9999px">Describí lo que buscás</label><input id="qB" placeholder="' + esc(ej[0]) + '" autocomplete="off">' +
      '<label for="cB" style="position:absolute;left:-9999px">Ciudad</label><select id="cB"><option value="">Todo Paraguay</option>' + cs.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("") + "</select>" +
      '<button class="btn">Buscar</button></form>' +
      '<div class="proba"><b>Probá con</b><button type="button" id="ej">' + esc(ej[Math.floor(Math.random() * ej.length)]) + "</button></div>" +
      '<div class="chips"><button class="chip" data-chip="masc">Amigos de las mascotas</button><button class="chip" data-chip="pozo">En pozo, para invertir</button><button class="chip" data-chip="estrenar">A estrenar</button><button class="chip" data-chip="1dorm">Para arrancar solo</button></div>' +
      "</div>" +
      '<div class="lado"><div class="mini">Hoy en DóndeVivo</div><div class="num">' + DATA.length.toLocaleString("es-PY") + '</div><div style="font-size:16px;color:#D0D5DD;line-height:1.5">casas y departamentos de varias páginas, revisados todos los días. Los vendidos y alquilados salen solos.</div>' +
      '<div class="fuentes">' + Object.keys(porFuente).map(function (f) { return "<span>" + esc(FUENTES[f] || f) + "</span>"; }).join("") + "</div></div></section>" +
      '<section class="sec"><h2>Lo que otras plataformas esconden, acá se ve</h2><div class="grid4">' +
      '<div class="caja"><h3>El costo real de mudarte</h3><p>El alquiler es solo una parte. Te mostramos la garantía y la comisión cuando el aviso las menciona, y te avisamos cuando conviene consultarlas.</p></div>' +
      '<div class="caja"><h3>Mascotas, sí o no</h3><p>Lo que está permitido y lo que no, bien arriba y sin letra chica.</p></div>' +
      '<div class="caja"><h3>Todas las páginas juntas</h3><p>InfoCasas, RE/MAX, BuscoDepto y más, en un solo lugar. Cada aviso te lleva a su página original.</p></div>' +
      '<div class="caja"><h3>Fotos de verdad</h3><p>Solo publicamos avisos con varias fotos reales, sin marcos ni teléfonos encima.</p></div>' +
      "</div></section>";
    $app.querySelectorAll("[data-op]").forEach(function (b) { b.onclick = function () { setOp(b.dataset.op); inicio(); }; });
    document.getElementById("ej").onclick = function () { document.getElementById("qB").value = this.textContent; document.getElementById("fb").requestSubmit(); };
    document.getElementById("fb").onsubmit = function (e) {
      e.preventDefault();
      var f = entender(document.getElementById("qB").value, { op: estado.op });
      var c = document.getElementById("cB").value; if (c) f.ciudad = c;
      location.hash = "#/buscar?" + q(f);
    };
    $app.querySelectorAll("[data-chip]").forEach(function (b) {
      b.onclick = function () {
        var f = { op: estado.op }, k = b.dataset.chip;
        if (k === "masc") f.masc = "confirmado"; if (k === "pozo") { f.op = "venta"; f.estado = "en_pozo"; }
        if (k === "estrenar") f.estado = "a_estrenar"; if (k === "1dorm") { f.tipo = "departamento"; f.dor = "1"; }
        location.hash = "#/buscar?" + q(f);
      };
    });
  }

  var mostrados = 24;
  function buscar(f) {
    setOp(f.op || "alquiler");
    var lista = filtrar(f), cs = ciudades(), bs = barrios(f.ciudad);
    function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (String(sel || "") === String(v) ? " selected" : "") + ">" + esc(t) + "</option>"; }
    $app.innerHTML =
      '<div class="res"><form class="filtros" id="ff" aria-label="Filtros">' +
      '<div class="toggle" role="group"><button type="button" data-op="alquiler" aria-pressed="' + (f.op !== "venta") + '">Alquilar</button><button type="button" data-op="venta" aria-pressed="' + (f.op === "venta") + '">Comprar</button></div>' +
      '<label>Ciudad<select name="ciudad">' + opt("", "Todo Paraguay", f.ciudad) + cs.map(function (c) { return opt(c, c, f.ciudad); }).join("") + "</select></label>" +
      '<label>Barrio<select name="barrio">' + opt("", "Todos los barrios", f.barrio) + bs.map(function (b) { return opt(b, b, f.barrio); }).join("") + "</select></label>" +
      '<label>Tipo<select name="tipo">' + opt("", "Todos", f.tipo) + opt("departamento", "Departamento", f.tipo) + opt("casa", "Casa", f.tipo) + opt("duplex", "Dúplex", f.tipo) + opt("terreno", "Terreno", f.tipo) + "</select></label>" +
      '<label>Mascotas<select name="masc">' + opt("", "Me da igual", f.masc) + opt("si", "Tengo mascota (oculta los que no aceptan)", f.masc) + opt("confirmado", "Solo los que dicen que aceptan", f.masc) + "</select></label>" +
      '<label>Estado<select name="estado">' + opt("", "Cualquiera", f.estado) + opt("en_pozo", "En pozo", f.estado) + opt("a_estrenar", "A estrenar", f.estado) + "</select></label>" +
      '<label>Dormitorios<select name="dor">' + opt("", "Cualquiera", f.dor) + opt("1", "1 o más", f.dor) + opt("2", "2 o más", f.dor) + opt("3", "3 o más", f.dor) + opt("4", "4 o más", f.dor) + "</select></label>" +
      '<label>Precio máximo<input name="max" inputmode="numeric" placeholder="Ej. 3500000" value="' + esc(f.max || "") + '"></label>' +
      '<label>Moneda del precio<select name="mon">' + opt("PYG", "Guaraníes", f.mon) + opt("USD", "Dólares", f.mon) + "</select></label>" +
      '<label>Página de origen<select name="fuente">' + opt("", "Todas", f.fuente) + Object.keys(FUENTES).map(function (k) { return opt(k, FUENTES[k], f.fuente); }).join("") + "</select></label>" +
      '<button class="btn" type="submit">Aplicar</button></form>' +
      '<section><div class="cabeza"><h1>' + lista.length.toLocaleString("es-PY") + (f.op === "venta" ? " en venta" : " en alquiler") + (f.ciudad ? " en " + esc(f.ciudad) : "") + (f.barrio ? ", " + esc(f.barrio) : "") + '</h1><a class="volver" href="#/">← Nueva búsqueda</a></div>' +
      (lista.length ? '<div class="lista">' + lista.slice(0, mostrados).map(tarjeta).join("") + "</div>" + (lista.length > mostrados ? '<button class="mas" id="mas">Ver más</button>' : "")
        : '<div class="vacio"><b>Todavía no tenemos avisos con esos filtros.</b><br>Probá sacar alguno. Sumamos avisos nuevos todos los días.</div>') +
      "</section></div>";
    var ff = document.getElementById("ff");
    function aplicar() { var o = { op: f.op }; new FormData(ff).forEach(function (v, k) { o[k] = v; }); if (o.ciudad !== f.ciudad) o.barrio = ""; mostrados = 24; location.hash = "#/buscar?" + q(o); }
    ff.onsubmit = function (e) { e.preventDefault(); aplicar(); };
    ff.querySelectorAll("select").forEach(function (s) { s.onchange = aplicar; });
    ff.querySelectorAll("[data-op]").forEach(function (b) { b.onclick = function () { f.op = b.dataset.op; aplicar(); }; });
    var m = document.getElementById("mas"); if (m) m.onclick = function () { mostrados += 24; buscar(f); };
  }

  function ficha(id) {
    var a = DATA.find(function (x) { return x.id === id; });
    if (!a) { $app.innerHTML = '<div class="vacio"><b>Este aviso ya no está disponible.</b><br>Puede que se haya alquilado o vendido. <a href="#/">Volver a buscar</a></div>'; return; }
    setOp(a.op);
    var fu = FUENTES[a.f] || a.f;
    var costo = a.op === "alquiler"
      ? (a.g ? "<p>Garantía que pide el anunciante: <b>" + esc(a.g) + "</b>. Consultale si además cobra comisión.</p>"
        : "<p>Este anunciante no menciona costos de garantía ni comisión, conviene consultarle antes de visitar.</p>")
      : "<p>Consultale al anunciante si hay gastos de escritura o comisión aparte del precio.</p>";
    var masc = a.ms === "si" ? "<p><b>Sí, acepta mascotas</b> según el aviso.</p>" : a.ms === "no" ? "<p><b>No acepta mascotas</b> según el aviso.</p>" : "<p>El aviso no dice si acepta mascotas, conviene preguntar.</p>";
    var mapa = a.lat && a.lng ? '<iframe class="mapa" loading="lazy" title="Ubicación aproximada" src="https://www.openstreetmap.org/export/embed.html?bbox=' + (a.lng - 0.012) + "," + (a.lat - 0.008) + "," + (a.lng + 0.012) + "," + (a.lat + 0.008) + "&layer=mapnik&marker=" + a.lat + "," + a.lng + '"></iframe>' : "<p>El anunciante no compartió la ubicación exacta.</p>";
    $app.innerHTML =
      '<a class="volver" href="javascript:history.back()">← Volver a los resultados</a><div class="ficha">' +
      '<div class="galeria"><div class="grande" id="gr" style="background-image:url(\'' + esc(seguro(a.ph[0])) + '\')"></div><div class="miniaturas">' +
      a.ph.map(function (u, i) { return '<button aria-label="Foto ' + (i + 1) + '" aria-current="' + (i === 0) + '" data-u="' + esc(seguro(u)) + '" style="background-image:url(\'' + esc(seguro(u)) + '\')"></button>'; }).join("") + "</div></div>" +
      '<div class="panel"><div class="precio" style="font-size:30px">' + precio(a) + porMes(a) + "</div><h1>" + esc(a.t) + '</h1><div class="lugar" style="font-size:15px">' + lugar(a) + '</div>' +
      '<div class="datos">' + [tipoTxt(a.tp), a.dor ? a.dor + " dormitorios" : "", a.ban ? a.ban + " baños" : "", a.m2 ? Math.round(a.m2) + " m²" : "", a.eo === "en_pozo" ? "En pozo" : a.eo === "a_estrenar" ? "A estrenar" : ""].filter(Boolean).map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" +
      '<a class="ir" href="' + esc(seguro(a.u)) + '" target="_blank" rel="noopener nofollow" id="ir">Escribir al anunciante <small>· en ' + esc(fu) + "</small></a>" +
      '<div class="bloque"><h2>Lo que cuesta entrar</h2>' + costo + "</div>" +
      '<div class="bloque"><h2>Mascotas</h2>' + masc + "</div>" +
      '<div class="bloque"><h2>Ubicación</h2>' + mapa + "</div>" +
      (a.d ? '<div class="bloque"><h2>Lo que dice el aviso</h2><p class="desc">' + esc(a.d) + "</p></div>" : "") +
      '<div class="bloque"><p style="font-size:13px">Aviso de ' + esc(fu) + ". DóndeVivo lo encontró y lo revisa todos los días.</p></div></div></div>";
    $app.querySelectorAll(".miniaturas button").forEach(function (b) {
      b.onclick = function () { document.getElementById("gr").style.backgroundImage = "url('" + b.dataset.u + "')"; $app.querySelectorAll(".miniaturas button").forEach(function (x) { x.setAttribute("aria-current", x === b); }); };
    });
    window.scrollTo(0, 0);
  }

  function publicar() {
    $app.innerHTML = '<div class="vacio" style="text-align:left;max-width:640px;margin:24px auto"><h1 style="font-size:36px">Publicá sin costo</h1><p style="font-size:17px;line-height:1.6">Muy pronto vas a poder cargar tu casa o departamento en DóndeVivo, gratis y con contacto directo por WhatsApp. Estamos terminando los últimos detalles.</p><a class="volver" href="#/">← Volver al inicio</a></div>';
  }

  function ruta() {
    var h = location.hash.replace(/^#/, "") || "/";
    if (h.indexOf("/aviso/") === 0) return ficha(decodeURIComponent(h.slice(7)));
    if (h.indexOf("/buscar") === 0) return buscar(leerQ(h.split("?")[1]));
    if (h.indexOf("/publicar") === 0) return publicar();
    mostrados = 24; inicio();
  }

  $app.innerHTML = '<div class="vacio">Cargando avisos…</div>';
  fetch("data/avisos.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (j) {
    DATA = (j.avisos || []).filter(function (a) { return a.ph && a.ph.length >= 2; });
    ACT = j.actualizado;
    var d = new Date(ACT); document.getElementById("actualizado").textContent = "Actualizado " + d.toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
    window.addEventListener("hashchange", ruta); ruta();
  }).catch(function () { $app.innerHTML = '<div class="vacio">No pudimos cargar los avisos. Probá recargar la página.</div>'; });
})();
