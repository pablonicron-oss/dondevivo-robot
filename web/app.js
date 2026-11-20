/* DóndeVivo · web estática. Lee data/avisos.json (lo genera el robot) y no usa claves. */
(function () {
  "use strict";
  var $app = document.getElementById("app");
  var DATA = [], ACT = "";
  var FUENTES = { infocasas: "InfoCasas", remax: "RE/MAX", buscodepto: "BuscoDepto", century21: "Century 21", dondevivo: "DóndeVivo" };
  function destacado(a) { return !!(a.dh && Date.parse(a.dh) > Date.now()); }
  var EJ = {
    alquiler: ["Tengo un gato y busco un depto en Luque", "Dos habitaciones, una para mi oficina", "Algo para compartir con mi roomie cerca de la facu",
      "Monoambiente amoblado cerca de una parada", "Que acepte perros grandes y tenga patio", "Una casa quinta en San Bernardino para el verano",
      "Depto con balcón y vista al río en Asunción", "Sin garantía para entrar, en Fernando de la Mora"],
    venta: ["Mi primera casa en Luque, con patio", "Un terreno de 360 m² en San Lorenzo", "Depto en pozo en Villa Morra para invertir",
      "Tengo 2 hijos, cerca de un buen colegio privado", "Dúplex con quincho y lugar para pileta", "Una casa quinta cerca de un arroyo",
      "Terreno con salida al lago en Areguá", "Casa en Encarnación cerca de la costanera"]
  };
  var PH = {   /* ejemplos cortos para el buscador, entran enteros */
    alquiler: ["Depto con patio en Luque", "Monoambiente amoblado", "Casa que acepte perros", "Dos dormitorios en Asunción",
      "Depto cerca de la facu", "Sin garantía en San Lorenzo", "Depto con balcón y cochera"],
    venta: ["Casa con patio en Luque", "Terreno en San Lorenzo", "Depto en pozo para invertir", "Dúplex con quincho",
      "Casa quinta en Areguá", "Casa en Encarnación"]
  };
  var estado = { op: "alquiler" };
  /* ciudades del país, para entender la búsqueda aunque todavía no tengamos avisos ahí */
  var PY = ["Asunción", "San Lorenzo", "Luque", "Lambaré", "Fernando de la Mora", "Mariano Roque Alonso", "Capiatá", "Ñemby", "Limpio",
    "Villa Elisa", "San Antonio", "Itauguá", "Areguá", "Ypané", "Guarambaré", "Itá", "J. Augusto Saldívar", "Villeta", "Nueva Italia",
    "Ypacaraí", "San Bernardino", "Altos", "Caacupé", "Tobatí", "Atyrá", "Emboscada", "Piribebuy", "Eusebio Ayala", "Arroyos y Esteros",
    "Ciudad del Este", "Hernandarias", "Minga Guazú", "Presidente Franco", "Santa Rita", "Naranjal", "Juan E. O'Leary", "Itakyry",
    "Encarnación", "Cambyretá", "Hohenau", "Obligado", "Bella Vista", "Capitán Miranda", "Coronel Bogado", "San Pedro del Paraná", "Fram",
    "Coronel Oviedo", "Caaguazú", "Juan Manuel Frutos", "Repatriación", "J. Eulogio Estigarribia", "Villarrica", "Paraguarí", "Carapeguá",
    "Yaguarón", "Pirayú", "Sapucai", "Ybycuí", "Quiindy", "Pilar", "San Juan Bautista", "San Ignacio", "Ayolas", "Concepción", "Horqueta",
    "Pedro Juan Caballero", "Capitán Bado", "Salto del Guairá", "Curuguaty", "Katueté", "La Paloma", "San Estanislao", "San Pedro de Ycuamandiyú",
    "Santa Rosa del Aguaray", "Caazapá", "Yuty", "San Juan Nepomuceno", "Filadelfia", "Loma Plata", "Villa Hayes", "Benjamín Aceval",
    "Nanawa", "Puerto Casado", "Fuerte Olimpo", "Mariscal Estigarribia", "Natalicio Talavera", "Iturbe", "Independencia", "Colonia Independencia"];
  function palabra(t, n) { var x = norm(n); return x.length > 2 && new RegExp("(^|[^a-z0-9])" + x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(t); }
  function masLargo(t, lista) { var m = ""; lista.forEach(function (n) { if (n.length > m.length && palabra(t, n)) m = n; }); return m; }

  /* ---------- utilidades ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function seguro(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
  /* Las fotos de las inmobiliarias vienen enormes y tardan en cargar: las pedimos achicadas a wsrv.nl
     (gratis, con caché). Si eso falla usamos la original, y si tampoco carga escondemos la tarjeta. */
  function mini(u, w) { u = seguro(u); return u === "#" ? u : "https://wsrv.nl/?url=" + encodeURIComponent(u) + "&w=" + w + "&output=webp&q=72"; }
  window.DVfoto = function (img) {
    var o = img.getAttribute("data-o");
    if (o) { img.removeAttribute("data-o"); img.src = o; return; }
    var t = img.closest(".tarjeta"); if (t) t.style.display = "none";
  };
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function precio(a) {
    if (!a.p) return "Consultar precio";
    var n = Math.round(a.p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (a.m === "USD" ? "USD " : "₲ ") + n;
  }
  function limpio(d) {
    return String(d || "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function expensas(a) {
    var m = norm(a.d).match(/expensas?[^0-9]{0,30}?(usd|us\$|u\$s|\$)?\s*([0-9][0-9.,]{2,})/);
    if (!m) return null;
    var n = parseInt(m[2].replace(/[.,]/g, ""), 10);
    if (!n || n < 10) return null;
    var usd = !!m[1] || (n < 5000 && a.m === "USD");
    if (!usd && n < 10000) return null;
    return (usd ? "USD " : "₲ ") + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  function extras(a) {
    var t = norm(a.t + " " + a.d), o = [];
    if (/negociable|conversable|a convenir|a tratar/.test(t)) o.push("Precio negociable");
    if (/amoblad|amueblad/.test(t) && !/(sin|no) (amoblar|amoblad|amueblad)/.test(t)) o.push("Amoblado");
    return o;
  }
  function porMes(a) { return a.op === "alquiler" && a.p ? " <small>por mes</small>" : ""; }
  function lugar(a) { return a.b && a.b !== a.c ? esc(a.b) + ", " + esc(a.c || "") : esc(a.c || "Paraguay") + ' <span title="El anunciante no menciona el barrio">· barrio sin especificar</span>'; }
  function tipoTxt(t) { return { departamento: "Depto", casa: "Casa", duplex: "Dúplex", terreno: "Terreno" }[t] || "Inmueble"; }
  function q(params) { return Object.keys(params).filter(function (k) { return params[k] !== "" && params[k] != null; }).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&"); }
  function leerQ(s) { var o = {}; (s || "").split("&").forEach(function (p) { if (!p) return; var i = p.indexOf("="); o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }); return o; }
  function setOp(op) { estado.op = op; document.body.classList.toggle("compra", op === "venta"); }
  var CENTRAL = ["san lorenzo", "luque", "lambare", "fernando de la mora", "mariano roque alonso", "capiata", "nemby", "limpio", "villa elisa",
    "san antonio", "itaugua", "aregua", "ypane", "guarambare", "ita", "j. augusto saldivar", "villeta", "nueva italia"];
  function esCentral(c) { return CENTRAL.indexOf(norm(c)) >= 0; }
  function enCiudad(a, c) { return !c || (c === "@central" ? esCentral(a.c) : a.c === c); }
  function nomCiudad(c) { return c === "@central" ? "Central" : c; }
  function ciudades() { var m = {}; DATA.forEach(function (a) { if (a.c) m[a.c] = (m[a.c] || 0) + 1; }); return Object.keys(m).sort(function (x, y) { return m[y] - m[x]; }); }
  function barrios(c) { var m = {}; DATA.forEach(function (a) { if (a.b && a.b !== a.c && enCiudad(a, c)) m[a.b] = 1; }); return Object.keys(m).sort(); }

  /* ---------- lo que el bot interpreta de cada aviso ---------- */
  function plano(s) { return " " + norm(s).replace(/[^a-z0-9]+/g, " ").trim() + " "; }
  function esMono(a) {
    var t = plano(a.t), d = plano(a.d);
    if (/ mono ?ambiente| monoamb| loft /.test(t)) return true;
    return / mono ?ambiente /.test(d) && (!a.dor || a.dor <= 1) && !/ (2|3|dos|tres) (dormitorios|habitaciones|piezas) /.test(t + d);
  }
  var BARRIOS_ASU = ["Bañado Cara Cara", "Bella Vista", "Bernardino Caballero", "Botánico", "Cañada del Ybyray", "Carmelitas", "Ciudad Nueva", "Dr. Francia", "Gral. Díaz",
    "Herrera", "Hipódromo", "Itá Enramada", "Itá Pytã Punta", "Jara", "Jukyty", "La Catedral", "La Encarnación", "Las Lomas", "Las Mercedes", "Loma Pytã", "Los Laureles",
    "Madame Lynch", "Manorá", "Mburicaó", "Mburucuyá", "Mbocayaty", "Mcal. Estigarribia", "Nazareth", "Ñu Guasú", "Obrero", "Pettirossi", "Pinozá", "Recoleta", "Republicano",
    "Ricardo Brugada", "Roberto L. Petit", "Sajonia", "San Blas", "San Cayetano", "San Cristóbal", "San Jorge", "San Pablo", "San Roque", "San Vicente", "Santa Ana",
    "Santa María", "Santa Rosa", "Santísima Trinidad", "Santo Domingo", "Tablada Nueva", "Tacumbú", "Tembetary", "Terminal", "Villa Aurelia", "Villa Morra",
    "Virgen de Fátima", "Virgen de la Asunción", "Virgen del Huerto", "Vista Alegre", "Ycuá Satí", "Ytay", "Zeballos Cué"];
  /* Si el aviso no dice el barrio, lo deducimos del título o la descripción, y si no, de los avisos vecinos en el mapa */
  function deducirBarrios() {
    var dic = {}, conB = [];
    function sumar(c, b) { var k = plano(b).trim(); if (k.length > 3 && k !== plano(c).trim()) { (dic[c] = dic[c] || {})[k] = (dic[c][k] || b); } }
    DATA.forEach(function (a) { if (a.b && a.b !== a.c) { sumar(a.c, a.b); if (a.lat && a.lng) conB.push(a); } });
    BARRIOS_ASU.forEach(function (b) { sumar("Asunción", b); });
    DATA.forEach(function (a) {
      if (a.b && a.b !== a.c) return;
      var d = dic[a.c], t = plano(a.t + " " + a.d), mejor = "";
      if (d) Object.keys(d).forEach(function (k) { if (t.indexOf(" " + k + " ") >= 0 && k.length > mejor.length) mejor = k; });
      if (mejor) { a.b = d[mejor]; return; }
      if (!a.lat || !a.lng) return;
      var votos = {}, km = 111;
      conB.forEach(function (x) {
        if (x.c !== a.c) return;
        var dist = Math.hypot((x.lat - a.lat) * km, (x.lng - a.lng) * km * 0.9);
        if (dist < 0.6) votos[x.b] = (votos[x.b] || 0) + 1 / (dist + 0.05);
      });
      var gana = Object.keys(votos).sort(function (p, q) { return votos[q] - votos[p]; })[0];
      if (gana) a.b = gana;
    });
  }

  /* comodidades: sí (verde), no (rojo) o no lo dice (gris) */
  var IC = {
    masc: '<path d="M8.5 13.5c1.6-2.1 5.4-2.1 7 0 1.3 1.7 2.5 3.4 2.5 4.6 0 1.6-1.4 2.4-3 2.1-1.2-.2-2-.7-3-.7s-1.8.5-3 .7c-1.6.3-3-.5-3-2.1 0-1.2 1.2-2.9 2.5-4.6z"/><ellipse cx="6" cy="9.5" rx="1.7" ry="2.2"/><ellipse cx="9.6" cy="5.8" rx="1.7" ry="2.3"/><ellipse cx="14.4" cy="5.8" rx="1.7" ry="2.3"/><ellipse cx="18" cy="9.5" rx="1.7" ry="2.2"/>',
    auto: '<path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><path d="M4 12h16v4.5H4z"/><path d="M6.5 16.5V19M17.5 16.5V19"/><circle cx="7.6" cy="14.2" r=".6"/><circle cx="16.4" cy="14.2" r=".6"/>',
    pile: '<path d="M8 15V5.5a2 2 0 0 1 4 0M14 15V5.5a2 2 0 0 1 4 0M8 9h6M8 12.5h6"/><path d="M3 17.5c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1"/>',
    aire: '<rect x="3" y="5" width="18" height="7" rx="2"/><path d="M6 9.5h12M8 15.5c0 1.2-1 1.5-1 2.8M12 15.5c0 1.2-1 1.5-1 2.8M16 15.5c0 1.2-1 1.5-1 2.8"/>',
    mueb: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3 12.5a1.5 1.5 0 0 1 3 0V14h12v-1.5a1.5 1.5 0 0 1 3 0V17H3z"/><path d="M5 17v2M19 17v2"/>',
    wifi: '<path d="M4 9.5a12 12 0 0 1 16 0M7 12.8a7.5 7.5 0 0 1 10 0M10 16a3 3 0 0 1 4 0"/><circle cx="12" cy="19" r=".9"/>',
    balc: '<path d="M4 11h16M4 11v9M20 11v9M4 20h16M8 11v9M12 11v9M16 11v9"/><path d="M7 11V5h10v6"/>',
    quin: '<path d="M5 9h14a7 7 0 0 1-14 0z"/><path d="M8 16l-2 4M16 16l2 4M12 16v4M9 6c0-1 1-1 1-2M12 6c0-1 1-1 1-2M15 6c0-1 1-1 1-2"/>',
    patio: '<path d="M12 21v-6"/><path d="M12 15a4 4 0 0 1-4-4c0-3 4-7 4-7s4 4 4 7a4 4 0 0 1-4 4z"/><path d="M4 21h16"/>',
    gym: '<path d="M7 8v8M17 8v8M4.5 10v4M19.5 10v4M7 12h10"/>',
    segu: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    asce: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 3v18M8.5 10l1.5-2 1.5 2M12.5 14l1.5 2 1.5-2"/>',
    lava: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><path d="M7.5 6.5h.01M10.5 6.5h3"/>'
  };
  var COMOD = [
    { k: "masc", n: "Mascotas", si: "Acepta mascotas", no: "No acepta mascotas", nd: "El aviso no dice si acepta mascotas" },
    { k: "auto", n: "Estacionamiento", si: "Tiene lugar para el auto", no: "No tiene estacionamiento", nd: "El aviso no dice si tiene estacionamiento",
      re: / (cochera|cocheras|garaje|garage|estacionamiento|estacionamientos|parking) |lugar para (el |un )?auto/, nore: / (sin|no tiene|no cuenta con|no incluye|no posee) (cochera|garaje|garage|estacionamiento|lugar para)/ },
    { k: "pile", n: "Piscina", si: "Tiene piscina", no: "No tiene piscina", nd: "El aviso no menciona piscina", re: /piscina|pileta/, nore: / (sin|no tiene|no cuenta con|no posee) (piscina|pileta)/ },
    { k: "aire", n: "Aire acondicionado", si: "Tiene aire acondicionado", no: "No tiene aire acondicionado", nd: "El aviso no menciona aire acondicionado",
      re: /aire acondicionado|aires acondicionados| a a | split|climatizad/, nore: / (sin|no tiene|no cuenta con|no incluye) aire/ },
    { k: "mueb", n: "Amoblado", si: "Viene amoblado", no: "Se entrega sin muebles", nd: "El aviso no dice si viene amoblado",
      re: /amoblad|amueblad|equipad/, nore: / (sin|no) (amoblar|amoblad|amueblad|muebles)/ },
    { k: "wifi", n: "Wifi", si: "Tiene wifi o internet", no: "No incluye internet", nd: "El aviso no menciona internet", re: / wi ?fi |internet|fibra optica/, nore: / (sin|no incluye) (wifi|internet)/ },
    { k: "balc", n: "Balcón", si: "Tiene balcón o terraza", no: "No tiene balcón", nd: "", re: /balcon|terraza/, nore: / sin balcon/ },
    { k: "patio", n: "Patio o jardín", si: "Tiene patio o jardín", no: "No tiene patio", nd: "", re: / (patio|patios|jardin|jardines) /, nore: / sin (patio|jardin)/ },
    { k: "quin", n: "Quincho o parrilla", si: "Tiene quincho o parrilla", no: "", nd: "", re: /quincho|parrilla|asador|barbacoa/ },
    { k: "gym", n: "Gimnasio", si: "Tiene gimnasio", no: "", nd: "", re: /gimnasio| gym |fitness/ },
    { k: "segu", n: "Seguridad", si: "Tiene seguridad o portería", no: "", nd: "", re: /seguridad 24|guardia|vigilancia|porteria|portero|barrio cerrado|condominio cerrado|circuito cerrado/ },
    { k: "asce", n: "Ascensor", si: "Tiene ascensor", no: "No tiene ascensor", nd: "", re: /ascensor/, nore: / sin ascensor/ },
    { k: "lava", n: "Lavadero", si: "Tiene lavadero", no: "", nd: "", re: /lavadero|lavanderia/ }
  ];
  var NUM = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4 };
  function comodidades(a) {
    var t = plano(a.t + " " + a.d), out = [];
    COMOD.forEach(function (c) {
      var v = "nd", extra = "";
      if (c.k === "masc") v = a.ms === "si" ? "si" : a.ms === "no" ? "no" : "nd";
      else if (c.nore && c.nore.test(t)) v = "no";
      else if (c.re.test(t)) v = "si";
      if (c.k === "auto" && v === "si") {
        var m = t.match(/ (\d|dos|tres|cuatro) (cocheras|lugares|estacionamientos|autos|vehiculos)/);
        var n = m ? (NUM[m[1]] || +m[1]) : 0;
        if (n > 1) extra = ", para " + n + " autos";
      }
      if (v === "nd" && !c.nd) return;
      out.push({ k: c.k, v: v, n: c.n, txt: (v === "si" ? c.si + extra : v === "no" ? c.no : c.nd) });
    });
    return out.sort(function (x, y) { var o = { si: 0, no: 1, nd: 2 }; return o[x.v] - o[y.v]; });
  }
  function iconos(a) {
    return '<div class="comod" role="list">' + comodidades(a).map(function (c) {
      return '<span class="cm ' + c.v + '" role="listitem" tabindex="0" aria-label="' + esc(c.txt) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + IC[c.k] + "</svg>" +
        (c.v === "no" ? '<i class="x" aria-hidden="true"></i>' : "") + '<b class="tip">' + esc(c.txt) + "</b></span>";
    }).join("") + "</div>";
  }

  /* ---------- guardados: quedan en este celular o compu, sin crear cuenta ---------- */
  function guardados() { try { return JSON.parse(localStorage.getItem("dv:guardados") || "[]"); } catch (e) { return []; } }
  function esGuardado(id) { return guardados().some(function (g) { return g.id === id; }); }
  function alternarGuardado(id) {
    var l = guardados(), i = l.findIndex(function (g) { return g.id === id; });
    if (i >= 0) l.splice(i, 1);
    else { var a = DATA.find(function (x) { return x.id === id; }); if (!a) return false; l.unshift({ id: a.id, t: a.t, ph: [a.ph[0]], p: a.p, m: a.m, op: a.op, tp: a.tp, c: a.c, b: a.b, dor: a.dor, g: Date.now() }); }
    try { localStorage.setItem("dv:guardados", JSON.stringify(l.slice(0, 200))); } catch (e) {}
    contarGuardados();
    return i < 0;
  }
  function contarGuardados() {
    var n = guardados().length, el = document.getElementById("nGuard");
    if (el) { el.textContent = n ? n : ""; el.parentNode.classList.toggle("tiene", !!n); }
  }
  function corazon(id, grande) {
    var on = esGuardado(id);
    return '<button type="button" class="fav' + (grande ? " grande" : "") + (on ? " on" : "") + '" data-fav="' + esc(id) + '" aria-pressed="' + on + '" aria-label="' + (on ? "Sacar de guardados" : "Guardar este aviso") + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>' + (grande ? "<span>" + (on ? "Guardado" : "Guardar") + "</span>" : "") + "</button>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-fav]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var on = alternarGuardado(b.dataset.fav);
    document.querySelectorAll('[data-fav="' + CSS.escape(b.dataset.fav) + '"]').forEach(function (x) {
      x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); x.setAttribute("aria-label", on ? "Sacar de guardados" : "Guardar este aviso");
      var s = x.querySelector("span"); if (s) s.textContent = on ? "Guardado" : "Guardar";
    });
    if (location.hash.indexOf("#/guardados") === 0 && !on) verGuardados();
  }, true);
  function verGuardados() {
    var l = guardados();
    $app.innerHTML = '<div class="cabeza"><h1>Tus guardados</h1><a class="volver" href="#/buscar">← Seguir buscando</a></div>' +
      '<p class="nota-g">Quedan guardados en este celular o compu, sin crear cuenta. Si borrás los datos del navegador, se borran.</p>' +
      (l.length ? '<div class="lista">' + l.map(function (g) {
        var a = DATA.find(function (x) { return x.id === g.id; });
        if (a) return tarjeta(a);
        return '<a class="tarjeta baja-g" href="#/aviso/' + encodeURIComponent(g.id) + '"><div class="foto" style="background-image:url(\'' + esc(mini(g.ph[0], 640)) + '\')"><span class="tag nd">Ya no está disponible</span>' + corazon(g.id) + '</div><div class="info"><div class="tit">' + esc(g.t) + '</div><div class="lugar">' + lugar(g) + "</div></div></a>";
      }).join("") + "</div>" : '<div class="vacio"><b>Todavía no guardaste ningún aviso.</b><br>Tocá el corazón de un aviso para guardarlo y verlo más tarde.</div>');
    window.scrollTo(0, 0);
  }

  /* ---------- lo que escribe la persona → filtros ---------- */
  function entender(texto, base) {
    var t = norm(texto), f = Object.assign({}, base);
    if (/\b(comprar|compro|venta|invertir|mi primera casa)\b/.test(t)) f.op = "venta";
    if (/\b(alquil|alquiler|rentar)/.test(t)) f.op = "alquiler";
    if (/\b(depto|departamento)\b/.test(t)) f.tipo = "departamento";
    else if (/\bduplex\b/.test(t)) f.tipo = "duplex";
    else if (/\bcasa\b/.test(t)) f.tipo = "casa";
    else if (/\bterreno\b/.test(t)) f.tipo = "terreno";
    if (/\b(gato|perro|mascota|mascotas)\b/.test(t)) f.masc = "si";
    if (/\b(pozo|preventa|invertir)\b/.test(t)) f.estado = "en_pozo";
    if (/\b(estrenar|nuevo)\b/.test(t)) f.estado = "a_estrenar";
    var d = t.match(/(\d)\s*(dormitorio|habitacion|hab|cuarto|pieza)/) || (/\b(un|1) dormitorio\b/.test(t) ? [0, "1"] : null);
    if (d) f.dor = d[1];
    if (/mono ?ambiente|\bmono\b|\bloft\b/.test(t)) f.dor = "0";
    var enDatos = ciudades(), c = masLargo(t, enDatos.concat(PY));
    if (!c && /\b(central|gran asuncion)\b/.test(t)) f.ciudad = "@central";
    if (c) { var igual = enDatos.find(function (x) { return norm(x) === norm(c); }); f.ciudad = igual || c; }
    var b = masLargo(t, barrios(f.ciudad).filter(function (x) { return norm(x).length > 3 && norm(x) !== norm(f.ciudad || ""); }));
    if (b) { f.barrio = b; var a = DATA.find(function (x) { return x.b === b && enCiudad(x, f.ciudad); }); if (a && f.ciudad !== "@central") f.ciudad = a.c; }
    return f;
  }

  function filtrar(f) {
    return DATA.filter(function (a) {
      if (f.op && a.op !== f.op) return false;
      if (f.ciudad && !enCiudad(a, f.ciudad)) return false;
      if (f.barrio && a.b !== f.barrio) return false;
      if (f.tipo && a.tp !== f.tipo) return false;
      if (f.masc === "si" && a.ms === "no") return false;
      if (f.masc === "confirmado" && a.ms !== "si") return false;
      if (f.estado && a.eo !== f.estado) return false;
      if (f.dor === "0") { if (!a.mono) return false; }
      else if (f.dor && (a.mono || (a.dor || 0) < +f.dor)) return false;
      if (f.fuente && a.f !== f.fuente) return false;
      if (f.max && a.p && a.m === (f.mon || "PYG") && a.p > +f.max) return false;
      return true;
    }).map(function (a, i) { return [a, i]; })
      .sort(function (x, y) { return (destacado(y[0]) - destacado(x[0])) || (x[1] - y[1]); })
      .map(function (x) { return x[0]; });
  }

  /* ---------- tarjeta ---------- */
  function tarjeta(a) {
    var tags = [];
    if (a.mono) tags.push("<span>Monoambiente</span>"); else if (a.dor) tags.push("<span>" + a.dor + " dorm.</span>");
    if (a.m2 >= 10) tags.push("<span>" + Math.round(a.m2) + " m²</span>");
    if (a.ms === "si") tags.push('<span class="si">Acepta mascotas</span>');
    if (a.ms === "no") tags.push('<span class="no">Sin mascotas</span>');
    if (a.eo === "en_pozo") tags.push("<span>En pozo</span>");
    if (a.eo === "a_estrenar") tags.push("<span>A estrenar</span>");
    extras(a).forEach(function (x) { tags.push("<span>" + x + "</span>"); });
    var ex = a.op === "alquiler" ? expensas(a) : null;
    var dest = destacado(a);
    return '<a class="tarjeta' + (dest ? " dest" : "") + '" href="#/aviso/' + encodeURIComponent(a.id) + '">' +
      '<div class="foto"><img class="fimg" alt="" loading="lazy" src="' + esc(mini(a.ph[0], 640)) + '" data-o="' + esc(seguro(a.ph[0])) + '" onerror="DVfoto(this)"><span class="tag">' + tipoTxt(a.tp) + '</span>' +
      (dest ? '<span class="tag destacado">Destacado</span>' : "") + corazon(a.id) +
      '<span class="src">' + (a.f === "dondevivo" ? "Publicado en DóndeVivo" : "Aviso de " + esc(FUENTES[a.f] || a.f)) + "</span></div>" +
      '<div class="info"><div class="precio">' + precio(a) + porMes(a) + '</div>' + (ex ? '<div class="expensas">+ ' + esc(ex) + ' de expensas</div>' : "") + '<div class="tit">' + esc(a.t) + '</div><div class="lugar">' + lugar(a) + '</div><div class="datos">' + tags.join("") + "</div></div></a>";
  }

  /* ---------- contador ----------
     Cada aviso nuevo se suma al contador en algún momento de las 24 horas siguientes a que el robot
     lo encontró. Así sube de a uno, parejo durante el día, y nunca muestra más de lo que hay. */
  var REVELA = null, tic = null;
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  function preparar() {
    if (REVELA) return;
    REVELA = DATA.map(function (a) { var p = Date.parse((a.n || "").length > 10 ? a.n + "Z" : "") || 0; return p ? p + hash(a.id) * 864e5 : 0; }).sort(function (x, y) { return x - y; });
  }
  function hasta(t) { var lo = 0, hi = REVELA.length; while (lo < hi) { var m = (lo + hi) >> 1; if (REVELA[m] <= t) lo = m + 1; else hi = m; } return lo; }
  function medianoche() { var d = new Date(Date.now() - 3 * 36e5); d.setUTCHours(0, 0, 0, 0); return d.getTime() + 3 * 36e5; }
  function digitos(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".").split("").map(function (c) {
      return c === "." ? '<span class="pt">.</span>' : '<span class="dg"><i style="transform:translateY(-' + (+c * 10) + '%)">0 1 2 3 4 5 6 7 8 9</i></span>';
    }).join("");
  }
  function pintarNumero(el, n) {
    if (!el) return;
    if (el.dataset.n === String(n)) return;
    var antes = el.dataset.n;
    if (antes && String(antes).length === String(n).length) {
      var d = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".").split("").filter(function (c) { return c !== "."; });
      el.querySelectorAll(".dg i").forEach(function (i, k) { i.style.transform = "translateY(-" + (+d[k] * 10) + "%)"; });
    } else el.innerHTML = digitos(n);
    el.dataset.n = n;
  }
  function contador() {
    var el = document.getElementById("contador");
    if (!el || !DATA.length) return;
    preparar();
    el.innerHTML = '<span class="cnum"><b>+</b><span class="num" id="cTot"></span></span> inmuebles en DóndeVivo';
    var meta = hasta(Date.now()), n = Math.max(0, meta - Math.min(meta, 18 + Math.floor(Math.random() * 14)));
    var caja = document.getElementById("cTot"); caja.classList.add("rapido");
    pintarNumero(caja, n);
    if (tic) clearInterval(tic);
    tic = setInterval(function () {        // al entrar, el número sube de a uno, suave, hasta el total
      var c = document.getElementById("cTot");
      if (!c) { clearInterval(tic); tic = null; return; }
      if (n < meta) { n++; pintarNumero(c, n); return; }
      c.classList.remove("rapido"); clearInterval(tic);
      tic = setInterval(function () {      // después sigue sumando a medida que entran avisos
        var d = document.getElementById("cTot");
        if (!d) { clearInterval(tic); tic = null; return; }
        pintarNumero(d, hasta(Date.now()));
      }, 3000);
    }, 90);
  }

  /* ejemplo del buscador: uno distinto en cada visita, fijo hasta recargar */
  var FIJO = {};
  function ejemploFijo() {
    var op = estado.op;
    if (!FIJO[op]) { var l = PH[op]; FIJO[op] = l[Math.floor(Math.random() * l.length)]; }
    return FIJO[op];
  }

  /* ---------- pantallas ---------- */
  /* maqueta 3D de la tarjeta Armá tu lugar (igual que en el diseño) */
  function shade(hex, a) {
    var n = parseInt(hex.slice(1), 16), t = a < 0 ? 0 : 255, p = Math.abs(a);
    var m = function (c) { return Math.round(c + (t - c) * p); };
    return "rgb(" + m((n >> 16) & 255) + "," + m((n >> 8) & 255) + "," + m(n & 255) + ")";
  }
  function caras(boxes, ox, oy) {
    var h = "";
    boxes.forEach(function (b) {
      var x = b[0] + ox, y = b[1] + oy, z = b[2], w = b[3], d = b[4], al = b[5], c = b[6];
      h += '<span style="left:' + x + "px;top:" + (y + d - al) + "px;width:" + w + "px;height:" + al + "px;background:" + shade(c, -0.06) + ";transform-origin:50% 100%;transform:translateZ(" + z + 'px) rotateX(-90deg)"></span>';
      h += '<span style="left:' + (x + w - al) + "px;top:" + y + "px;width:" + al + "px;height:" + d + "px;background:" + shade(c, -0.22) + ";transform-origin:100% 50%;transform:translateZ(" + z + 'px) rotateY(90deg)"></span>';
      h += '<span style="left:' + x + "px;top:" + y + "px;width:" + w + "px;height:" + d + "px;background:" + shade(c, 0.1) + ";transform-origin:50% 50%;transform:translateZ(" + (z + al) + 'px)"></span>';
    });
    return h;
  }
  var W = "#F4F5F7";
  var PREVIEW = caras([
    [0, 0, 0, 160, 130, 6, "#EFE2CF"], [0, 0, 6, 160, 5, 22, "#475467"], [0, 5, 6, 5, 125, 22, "#475467"],
    [20, 14, 6, 70, 6, 34, "#7A5230"], [20, 20, 6, 70, 92, 13, "#9C6B3F"], [23, 22, 19, 64, 88, 8, W], [23, 56, 27, 64, 54, 3, "#1F4FE0"],
    [112, 70, 6, 6, 6, 10, "#B9772E"], [128, 70, 6, 6, 6, 10, "#B9772E"], [112, 96, 6, 6, 6, 10, "#B9772E"], [128, 96, 6, 6, 6, 10, "#B9772E"],
    [112, 68, 16, 22, 36, 16, "#D99A4E"], [111, 96, 26, 24, 20, 20, "#D99A4E"], [117, 116, 27, 12, 9, 9, "#F3DDB7"], [111, 97, 46, 6, 7, 9, "#8A5A22"], [129, 97, 46, 6, 7, 9, "#8A5A22"],
    [131, 12, 6, 14, 14, 12, "#C8553D"], [129, 10, 18, 18, 18, 10, "#12B76A"], [132, 13, 28, 12, 12, 10, "#32D583"], [135, 16, 38, 6, 6, 6, "#12B76A"],
    [178, 0, 0, 76, 136, 4, "#667085"], [184, 4, 4, 4, 128, 1, "#FDE68A"], [244, 4, 4, 4, 128, 1, "#FDE68A"],
    [186, 24, 4, 6, 22, 14, "#0B0F17"], [244, 24, 4, 6, 22, 14, "#0B0F17"], [186, 92, 4, 6, 22, 14, "#0B0F17"], [244, 92, 4, 6, 22, 14, "#0B0F17"],
    [188, 8, 11, 60, 120, 17, "#E5484D"], [193, 38, 28, 50, 58, 15, "#C7D7FE"], [193, 38, 43, 50, 58, 2, "#E5484D"], [196, 126, 16, 10, 3, 6, "#FDE68A"], [230, 126, 16, 10, 3, 6, "#FDE68A"]
  ], -127, -68);

  /* ---------- pantallas ---------- */
  function inicio() {
    var cs = ciudades(), ej = EJ[estado.op], rent = estado.op === "alquiler";
    $app.innerHTML =
      '<section class="hero"><div class="card-hero">' +
      '<div class="toggle" role="group" aria-label="Qué buscás"><button data-op="alquiler" aria-pressed="' + rent + '">Busco alquilar</button><button data-op="venta" aria-pressed="' + !rent + '">Busco comprar</button></div>' +
      '<h1>Contanos qué buscás. <span class="ac">Nosotros lo encontramos.</span></h1>' +
      '<div style="display:flex;flex-direction:column;gap:14px">' +
      '<form class="buscador" id="fb"><label for="qB" style="position:absolute;left:-9999px">Describí lo que buscás</label><input id="qB" placeholder="' + esc(ejemploFijo()) + '" autocomplete="off">' +
      '<label for="cB" style="position:absolute;left:-9999px">Ciudad</label><select id="cB"><option value="">Todo Paraguay</option>' + cs.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("") + "</select>" +
      '<button class="btn">Buscar</button></form>' +
      '<div class="proba"><b>Probá con</b><div class="rot">' + ej.map(function (t) { return '<button type="button">' + esc(t) + "</button>"; }).join("") + "</div></div></div>" +
      '<div class="contador" id="contador"></div>' +
      '<div class="chips"><button class="chip" data-chip="masc">Amigos de las mascotas</button><button class="chip" data-chip="office">Home office friendly</button><button class="chip" data-chip="1dorm">Para arrancar solo</button><button class="chip" data-chip="pozo">En pozo, para invertir</button><button class="chip" data-chip="estrenar">A estrenar</button></div>' +
      "</div>" +
      '<div class="lado"><div style="display:flex;flex-direction:column;gap:8px"><div class="mini">O buscá de otra forma</div><div class="grande">Armá tu lugar desde cero</div><div style="font-size:15px;line-height:1.5;color:#D0D5DD">Personalizá tu lugar con habitaciones, tu perro, el sofá o el auto. Te buscamos lo más parecido.</div></div>' +
      '<div class="float" aria-hidden="true"><div class="iso">' + PREVIEW + '</div></div>' +
      '<a class="cta" href="armar.html">Empezar a armar</a></div></section>' +
      seccionMapa(cs) +
      '<section class="sec"><h2>Lo que otras plataformas esconden, acá se ve</h2><div class="grid4">' +
      '<div class="caja"><h3>El costo real de mudarte</h3><p>El alquiler es solo una parte. Te mostramos el total para entrar, con garantía y comisión incluidas cuando el aviso las menciona.</p></div>' +
      '<div class="caja"><h3>Los detalles importantes</h3><p>Si acepta mascotas, si el precio es negociable, si hay expensas aparte o si está amoblado. Todo bien arriba y sin letra chica.</p></div>' +
      '<div class="caja"><h3>Todas las páginas juntas</h3><p>InfoCasas, RE/MAX, BuscoDepto y más, en un solo lugar. Cada aviso te lleva a su página original.</p></div>' +
      "</div></section>" +
      '<section class="banda"><div>¿Tenés un inmueble? Publicá sin costo.</div><a href="publicar.html">Agregar mi inmueble</a></section>';
    contador();
    prepararMapa();
    $app.querySelectorAll("[data-op]").forEach(function (b) { b.onclick = function () { setOp(b.dataset.op); inicio(); }; });
    $app.querySelectorAll(".rot button").forEach(function (b) { b.onclick = function () { document.getElementById("qB").value = b.textContent; document.getElementById("fb").requestSubmit(); }; });
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
        if (k === "office") f.dor = "2";
        location.hash = "#/buscar?" + q(f);
      };
    });
  }

  /* ---------- mapa con precios ---------- */
  var TITULO_MAPA = "Precios cerca tuyo";
  var VER_MAPA = !!TITULO_MAPA || /[?&]mapa=1/.test(location.search);
  var mapa = null, capa = null, yo = null, mOp = "", mCiudad = "";
  function cargarMapaLib(listo) {
    if (window.L && L.markerClusterGroup) return listo();
    [["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"], ["https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"]].forEach(function (h) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = h[0]; document.head.appendChild(l);
    });
    var a = document.createElement("script"); a.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    a.onload = function () { var b = document.createElement("script"); b.src = "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"; b.onload = listo; document.head.appendChild(b); };
    document.head.appendChild(a);
  }
  function enPY(a) { return a.lat && a.lng && a.lat > -27.7 && a.lat < -19.2 && a.lng > -62.7 && a.lng < -54.2; }   // descarta ubicaciones mal cargadas
  function corto(a) {
    if (!a.p) return "Consultar";
    var n = a.p, f = function (x) { return (Math.round(x * 10) / 10).toString().replace(".", ","); };
    var t = n >= 1e9 ? f(n / 1e9) + " mil M" : n >= 1e6 ? f(n / 1e6) + " M" : n >= 1e3 ? Math.round(n / 1e3) + " mil" : String(n);
    return (a.m === "USD" ? "USD " : "₲ ") + t;
  }
  function seccionMapa(cs) {
    if (!VER_MAPA) return "";
    var conLugar = {}; DATA.forEach(function (a) { if (enPY(a) && a.c) conLugar[a.c] = 1; });
    return '<section class="sec mapa-sec" id="mapaSec"><div class="mapa-cab"><h2>' + esc(TITULO_MAPA || "Mapa (prueba)") + "</h2>" +
      '<div class="mapa-ctrl"><div class="seg" role="group" aria-label="Qué mostrar">' +
      ['["", "Todo"]', '["alquiler", "Alquiler"]', '["venta", "Venta"]'].map(function (j) { var x = JSON.parse(j); return '<button data-mop="' + x[0] + '" aria-pressed="' + (mOp === x[0]) + '">' + x[1] + "</button>"; }).join("") +
      '</div><label class="sr" for="mCiudad">Ciudad del mapa</label><select id="mCiudad"><option value="">Todo Paraguay</option>' +
      cs.filter(function (c) { return conLugar[c]; }).map(function (c) { return "<option" + (c === mCiudad ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") +
      '</select><button id="mCerca" class="cerca"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>Cerca mío</button></div></div>' +
      '<div class="mapa-caja" id="mapaCaja"><div id="mapa" aria-label="Mapa de avisos"></div>' +
      '<button id="mFull" class="mfull" aria-label="Pantalla completa"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg></button>' +
      '<div class="mmsg" id="mMsg" hidden></div></div></section>';
  }
  function tarjetaMapa(a) {
    var ex = expensas(a), dest = destacado(a);
    return '<a class="mtarj" href="#/aviso/' + encodeURIComponent(a.id) + '">' +
      (a.ph && a.ph[0] ? '<span class="mfoto" style="background-image:url(\'' + esc(mini(a.ph[0], 360)) + '\')">' + (dest ? '<b class="mdest">Destacado</b>' : "") + "</span>" : "") +
      '<span class="mtx"><b class="mprecio">' + precio(a) + porMes(a) + "</b>" +
      (ex ? '<span class="mex">+ ' + esc(ex) + " de expensas</span>" : "") +
      '<span class="mtit">' + esc(a.t) + "</span>" +
      '<span class="mlug">' + esc([a.b && a.b !== a.c ? a.b : "", a.c].filter(Boolean).join(", ")) + "</span>" +
      (a.op === "alquiler" && a.g ? '<span class="mlug">Garantía: ' + esc(a.g) + "</span>" : "") +
      '<span class="mver">Ver aviso →</span></span></a>';
  }
  function pintarMapa(ajustar) {
    if (!mapa) return;
    if (capa) mapa.removeLayer(capa);
    capa = L.markerClusterGroup({ maxClusterRadius: 48, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
      iconCreateFunction: function (c) { return L.divIcon({ className: "mgrupo", html: "<span>" + c.getChildCount() + "</span>", iconSize: [44, 44] }); } });
    var lista = DATA.filter(function (a) { return enPY(a) && (!mOp || a.op === mOp) && enCiudad(a, mCiudad); });
    lista.sort(function (x, y) { return destacado(x) - destacado(y); });
    lista.forEach(function (a) {
      var cls = destacado(a) ? "dest" : a.op === "venta" ? "venta" : "alq";
      var m = L.marker([a.lat, a.lng], { icon: L.divIcon({ className: "mpin", html: '<span class="' + cls + '">' + esc(corto(a)) + "</span>", iconSize: null }),
        zIndexOffset: destacado(a) ? 1000 : 0, title: a.t });
      m.bindPopup(tarjetaMapa(a), { maxWidth: 280, minWidth: 240, className: "mpop" });
      capa.addLayer(m);
    });
    mapa.addLayer(capa);
    if (ajustar && lista.length) mapa.fitBounds(L.latLngBounds(lista.map(function (a) { return [a.lat, a.lng]; })).pad(0.08), { maxZoom: 14 });
    var msg = document.getElementById("mMsg");
    if (msg) { msg.hidden = !!lista.length; msg.textContent = "Todavía no hay avisos con ubicación para este filtro."; }
  }
  function prepararMapa() {
    var sec = document.getElementById("mapaSec"); if (!sec) return;
    mapa = null; capa = null; yo = null;
    function iniciar() {
      cargarMapaLib(function () {
        if (!document.getElementById("mapa") || mapa) return;
        mapa = L.map("mapa", { scrollWheelZoom: true, zoomControl: true }).setView([-25.3, -57.6], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap", referrerPolicy: "strict-origin-when-cross-origin" }).addTo(mapa);
        pintarMapa(false);   // arranca en Asunción, donde están la mayoría de los avisos
        mapa.setView([-25.295, -57.58], 12);
      });
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { io.disconnect(); iniciar(); } }, { rootMargin: "300px" });
      io.observe(sec);
    } else iniciar();
    sec.querySelectorAll("[data-mop]").forEach(function (b) {
      b.onclick = function () { mOp = b.dataset.mop; sec.querySelectorAll("[data-mop]").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); pintarMapa(true); };
    });
    document.getElementById("mCiudad").onchange = function (e) { mCiudad = e.target.value; pintarMapa(true); };
    document.getElementById("mCerca").onclick = function () {
      var msg = document.getElementById("mMsg"), btn = this;
      if (!navigator.geolocation) { msg.hidden = false; msg.textContent = "Tu navegador no comparte la ubicación."; return; }
      btn.disabled = true; btn.classList.add("cargando");
      navigator.geolocation.getCurrentPosition(function (pos) {
        btn.disabled = false; btn.classList.remove("cargando");
        if (!mapa) return;
        var ll = [pos.coords.latitude, pos.coords.longitude];
        if (yo) mapa.removeLayer(yo);
        yo = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#1F4FE0", fillOpacity: 1 }).addTo(mapa);
        if (mCiudad) { mCiudad = ""; document.getElementById("mCiudad").value = ""; pintarMapa(false); }
        mapa.setView(ll, 14);
      }, function () {
        btn.disabled = false; btn.classList.remove("cargando");
        msg.hidden = false; msg.textContent = "No pudimos ver tu ubicación. Revisá el permiso en tu navegador o elegí una ciudad.";
        setTimeout(function () { msg.hidden = true; }, 5000);
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    };
    var caja = document.getElementById("mapaCaja");
    function salir(e) { if (e.key === "Escape") alternar(false); }
    function alternar(on) {
      caja.classList.toggle("full", on); document.body.classList.toggle("sin-scroll", on);
      document.getElementById("mFull").setAttribute("aria-label", on ? "Salir de pantalla completa" : "Pantalla completa");
      if (on) document.addEventListener("keydown", salir); else document.removeEventListener("keydown", salir);
      if (mapa) setTimeout(function () { mapa.invalidateSize(); }, 60);
    }
    document.getElementById("mFull").onclick = function () { alternar(!caja.classList.contains("full")); };
  }

  var mostrados = 24;
  function buscar(f) {
    if (f.barrio && f.barrio === f.ciudad) delete f.barrio;
    setOp(f.op || "alquiler");
    var lista = filtrar(f), cs = ciudades(), bs = barrios(f.ciudad);
    if (f.ciudad && f.ciudad !== "@central" && cs.indexOf(f.ciudad) < 0) cs = [f.ciudad].concat(cs);
    var sinCiudad = f.ciudad && !DATA.some(function (a) { return enCiudad(a, f.ciudad); });
    var csCen = cs.filter(esCentral), csOtras = cs.filter(function (c) { return !esCentral(c); });
    function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (String(sel || "") === String(v) ? " selected" : "") + ">" + esc(t) + "</option>"; }
    $app.innerHTML =
      '<div class="res"><form class="filtros" id="ff" aria-label="Filtros">' +
      '<div class="toggle" role="group"><button type="button" data-op="alquiler" aria-pressed="' + (f.op !== "venta") + '">Alquilar</button><button type="button" data-op="venta" aria-pressed="' + (f.op === "venta") + '">Comprar</button></div>' +
      '<label>Ciudad<select name="ciudad">' + opt("", "Todo Paraguay", f.ciudad) + opt("@central", "Central (todas sus ciudades)", f.ciudad) +
        (csCen.length ? '<optgroup label="Ciudades de Central">' + csCen.map(function (c) { return opt(c, c, f.ciudad); }).join("") + "</optgroup>" : "") +
        '<optgroup label="Asunción y resto del país">' + csOtras.map(function (c) { return opt(c, c, f.ciudad); }).join("") + "</optgroup></select></label>" +
      '<label>Barrio<select name="barrio">' + opt("", "Todos los barrios", f.barrio) + bs.map(function (b) { return opt(b, b, f.barrio); }).join("") + "</select></label>" +
      '<label>Tipo<select name="tipo">' + opt("", "Todos", f.tipo) + opt("departamento", "Departamento", f.tipo) + opt("casa", "Casa", f.tipo) + opt("duplex", "Dúplex", f.tipo) + opt("terreno", "Terreno", f.tipo) + "</select></label>" +
      '<label>Mascotas<select name="masc">' + opt("", "Me da igual", f.masc) + opt("si", "Tengo mascota (oculta los que no aceptan)", f.masc) + opt("confirmado", "Solo los que dicen que aceptan", f.masc) + "</select></label>" +
      '<label>Estado<select name="estado">' + opt("", "Cualquiera", f.estado) + opt("en_pozo", "En pozo", f.estado) + opt("a_estrenar", "A estrenar", f.estado) + "</select></label>" +
      '<label>Dormitorios<select name="dor">' + opt("", "Cualquiera", f.dor) + opt("0", "Monoambiente", f.dor) + opt("1", "1 o más", f.dor) + opt("2", "2 o más", f.dor) + opt("3", "3 o más", f.dor) + opt("4", "4 o más", f.dor) + "</select></label>" +
      '<label>Precio máximo<input name="max" inputmode="numeric" placeholder="Ej. 3500000" value="' + esc(f.max || "") + '"></label>' +
      '<label>Moneda del precio<select name="mon">' + opt("PYG", "Guaraníes", f.mon) + opt("USD", "Dólares", f.mon) + "</select></label>" +
      '<label>Página de origen<select name="fuente">' + opt("", "Todas", f.fuente) + Object.keys(FUENTES).map(function (k) { return opt(k, FUENTES[k], f.fuente); }).join("") + "</select></label>" +
      '<button class="btn" type="submit">Aplicar</button></form>' +
      '<section><div class="cabeza"><h1>' + lista.length.toLocaleString("es-PY") + (f.op === "venta" ? " en venta" : " en alquiler") + (f.ciudad ? " en " + esc(nomCiudad(f.ciudad)) : "") + (f.barrio ? ", " + esc(f.barrio) : "") + '</h1><a class="volver" href="#/">← Nueva búsqueda</a></div>' +
      (lista.length ? '<div class="lista">' + lista.slice(0, mostrados).map(tarjeta).join("") + "</div>" + (lista.length > mostrados ? '<button class="mas" id="mas">Ver más</button>' : "")
        : '<div class="vacio">' + (sinCiudad ? "<b>Todavía no tenemos avisos en " + esc(f.ciudad) + ".</b><br>Sumamos avisos nuevos todos los días, volvé a mirar pronto."
          : "<b>Todavía no tenemos avisos con esos filtros.</b><br>Probá sacar alguno. Sumamos avisos nuevos todos los días.") + "</div>") +
      "</section></div>";
    var ff = document.getElementById("ff");
    function aplicar() { var o = { op: f.op }; new FormData(ff).forEach(function (v, k) { o[k] = v; }); if (o.ciudad !== f.ciudad) o.barrio = ""; mostrados = 24; location.hash = "#/buscar?" + q(o); }
    ff.onsubmit = function (e) { e.preventDefault(); aplicar(); };
    ff.querySelectorAll("select").forEach(function (s) { s.onchange = aplicar; });
    ff.querySelectorAll("[data-op]").forEach(function (b) { b.onclick = function () { f.op = b.dataset.op; aplicar(); }; });
    var m = document.getElementById("mas"); if (m) m.onclick = function () { mostrados += 24; buscar(f); };
  }

  /* cuenta visitas y clics de contacto por aviso (privado, solo se puede sumar) */
  var SUPA = "https://kjfsbcwedkofuxdybstq.supabase.co", SUPA_PUB = "sb_publishable_ZwjLEoR4XU46N71mNqyHCg_eLkcDURO";
  function sumarVisita(id, tipo) {
    var k = "dv:" + tipo + ":" + id;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch (e) {}
    try {
      fetch(SUPA + "/rest/v1/rpc/sumar_visita", { method: "POST", keepalive: true,
        headers: { apikey: SUPA_PUB, "Content-Type": "application/json" },
        body: JSON.stringify({ p_id: id, p_tipo: tipo }) }).catch(function () {});
    } catch (e) {}
  }

  function ficha(id) {
    var a = DATA.find(function (x) { return x.id === id; });
    if (!a) return fichaBaja(id);
    setOp(a.op);
    var fu = FUENTES[a.f] || a.f, ex = expensas(a);
    var costo = a.op === "alquiler"
      ? (a.g ? "<p>Garantía que pide el anunciante: <b>" + esc(a.g) + "</b>. Consultale si además cobra comisión.</p>"
        : "<p>Este anunciante no menciona costos de garantía ni comisión, conviene consultarle antes de visitar.</p>")
      : "<p>Consultale al anunciante si hay gastos de escritura o comisión aparte del precio.</p>";
    if (ex) costo += "<p>Además del " + (a.op === "alquiler" ? "alquiler" : "precio") + ", el aviso menciona <b>" + esc(ex) + " de expensas</b>" + (a.op === "alquiler" ? " por mes." : ".") + "</p>";
    var _masc = a.ms === "si" ? "<p><b>Sí, acepta mascotas</b> según el aviso.</p>" : a.ms === "no" ? "<p><b>No acepta mascotas</b> según el aviso.</p>" : "<p>El aviso no dice si acepta mascotas, conviene preguntar.</p>";
    var mapa = a.lat && a.lng ? '<iframe class="mapa" loading="lazy" title="Ubicación aproximada" src="https://www.openstreetmap.org/export/embed.html?bbox=' + (a.lng - 0.012) + "," + (a.lat - 0.008) + "," + (a.lng + 0.012) + "," + (a.lat + 0.008) + "&layer=mapnik&marker=" + a.lat + "," + a.lng + '"></iframe>' : "<p>El anunciante no compartió la ubicación exacta.</p>";
    $app.innerHTML =
      '<a class="volver" href="javascript:history.back()">← Volver a los resultados</a><div class="ficha">' +
      '<div class="galeria">' + corazon(a.id, true) + '<div class="grande" id="gr" style="background-image:url(\'' + esc(mini(a.ph[0], 1200)) + '\')"></div><div class="miniaturas">' +
      a.ph.map(function (u, i) { return '<button aria-label="Foto ' + (i + 1) + '" aria-current="' + (i === 0) + '" data-u="' + esc(mini(u, 1200)) + '" style="background-image:url(\'' + esc(mini(u, 200)) + '\')"></button>'; }).join("") + "</div></div>" +
      '<div class="panel"><div class="precio" style="font-size:30px">' + precio(a) + porMes(a) + "</div>" + (ex ? '<div class="expensas grande">+ ' + esc(ex) + " de expensas" + (a.op === "alquiler" ? " por mes, se pagan aparte" : "") + "</div>" : "") + "<h1>" + esc(a.t) + '</h1><div class="lugar" style="font-size:15px">' + lugar(a) + '</div>' + iconos(a) +
      '<div class="datos">' + [tipoTxt(a.tp), a.mono ? "Monoambiente" : a.dor ? a.dor + " dormitorios" : "", a.ban ? a.ban + " baños" : "", a.m2 >= 10 ? Math.round(a.m2) + " m²" : "", a.eo === "en_pozo" ? "En pozo" : a.eo === "a_estrenar" ? "A estrenar" : ""].concat(extras(a)).filter(Boolean).map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>" +
      (a.f === "dondevivo" && a.wa
        ? '<a class="ir" href="https://wa.me/' + esc(String(a.wa).replace(/\D/g, "")) + "?text=" + encodeURIComponent("Hola, vi tu aviso " + a.t + " en DóndeVivo") + '" target="_blank" rel="noopener" id="ir">Escribir por WhatsApp</a>'
        : '<a class="ir" href="' + esc(seguro(a.u)) + '" target="_blank" rel="noopener nofollow" id="ir">Escribir al anunciante <small>· en ' + esc(fu) + "</small></a>") +
      '<div class="bloque"><h2>Lo que cuesta entrar</h2>' + costo + "</div>" +
      
      '<div class="bloque"><h2>Ubicación</h2>' + mapa + "</div>" +
      (a.d ? '<div class="bloque"><h2>Lo que dice el aviso</h2><p class="desc">' + esc(limpio(a.d)) + "</p></div>" : "") +
      '<div class="bloque"><p style="font-size:13px">' + (a.f === "dondevivo" ? "Publicado directamente en DóndeVivo por su anunciante." : "Aviso de " + esc(fu) + ". DóndeVivo lo encontró y lo revisa todos los días.") + "</p></div></div></div>";
    sumarVisita(a.id, "vista");
    var ir = document.getElementById("ir"); if (ir) ir.addEventListener("click", function () { sumarVisita(a.id, "contacto"); });
    $app.querySelectorAll(".miniaturas button").forEach(function (b) {
      b.onclick = function () { document.getElementById("gr").style.backgroundImage = "url('" + b.dataset.u + "')"; $app.querySelectorAll(".miniaturas button").forEach(function (x) { x.setAttribute("aria-current", x === b); }); };
    });
    window.scrollTo(0, 0);
  }

  /* ---------- avisos que ya no están: el link guardado sigue andando, con un cartel ---------- */
  var BAJAS = null;
  var CARTEL = { alquilado: ["Ya se alquiló", "Este inmueble ya se alquiló."], vendido: ["Ya se vendió", "Este inmueble ya se vendió."],
    pausado: ["No disponible por ahora", "El anunciante pausó este aviso."], no_disponible: ["Ya no está disponible", "Este aviso ya no está publicado. Puede que se haya alquilado o vendido."] };
  function parecidos(b) {
    var lista = DATA.filter(function (x) { return x.op === b.op && x.c === b.c && x.id !== b.id; });
    lista.forEach(function (x) {
      var pts = (x.b && x.b === b.b ? 0 : 2) + (x.tp === b.tp ? 0 : 1);
      if (b.p && x.p && x.m === b.m) pts += Math.min(3, Math.abs(x.p - b.p) / b.p * 4); else pts += 3;
      x._pp = pts;
    });
    return lista.sort(function (x, y) { return x._pp - y._pp; }).slice(0, 6);
  }
  function fichaBaja(id) {
    var pintar = function () {
      var b = (BAJAS || []).find(function (x) { return x.id === id; });
      if (!b) { $app.innerHTML = '<div class="vacio"><b>Este aviso ya no está disponible.</b><br>Puede que se haya alquilado o vendido. <a href="#/">Volver a buscar</a></div>'; return; }
      setOp(b.op);
      var c = CARTEL[b.e] || CARTEL.no_disponible, par = parecidos(b);
      $app.innerHTML = '<a class="volver" href="#/">← Buscar otros inmuebles</a>' +
        '<div class="baja"><div class="baja-cartel ' + esc(b.e) + '"><b>' + c[0] + '</b><span>' + c[1] + "</span></div>" +
        '<div class="baja-cuerpo"><div class="baja-foto" style="background-image:url(\'' + esc(mini((b.ph || [])[0], 800)) + '\')"><span>' + c[0] + "</span></div>" +
        '<div><div class="precio" style="font-size:26px;text-decoration:line-through;opacity:.6">' + precio(b) + porMes(b) + "</div><h1>" + esc(b.t) + '</h1><div class="lugar">' + lugar(b) + "</div>" +
        '<div class="datos">' + [tipoTxt(b.tp), b.dor ? b.dor + " dormitorios" : "", b.m2 >= 10 ? Math.round(b.m2) + " m²" : ""].filter(Boolean).map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div></div></div></div>" +
        (par.length ? '<h2 class="baja-tit">Parecidos y disponibles en ' + esc(b.c || "la zona") + "</h2><div class=\"lista\">" + par.map(tarjeta).join("") + "</div>" : "") +
        '<p style="text-align:center;margin:26px 0"><a class="baja-btn" href="#/buscar">Ver todos los inmuebles</a></p>';
      window.scrollTo(0, 0);
    };
    if (BAJAS) return pintar();
    $app.innerHTML = '<div class="vacio">Cargando…</div>';
    fetch("data/bajas.json?v=" + Date.now()).then(function (r) { return r.json(); }).then(function (j) { BAJAS = j.bajas || []; pintar(); })
      .catch(function () { BAJAS = []; pintar(); });
  }

  function ruta() {
    document.body.classList.remove("sin-scroll");
    var h = location.hash.replace(/^#/, "") || "/";
    if (h.indexOf("/aviso/") === 0) return ficha(decodeURIComponent(h.slice(7)));
    if (h.indexOf("/guardados") === 0) return verGuardados();
    if (h.indexOf("/buscar") === 0) {
      var f = leerQ(h.split("?")[1]);
      if (f.q) { var t = f.q; delete f.q; f = entender(t, f); if (leerQ(h.split("?")[1]).ciudad) f.ciudad = leerQ(h.split("?")[1]).ciudad; history.replaceState(null, "", "#/buscar?" + q(f)); }
      return buscar(f);
    }
    if (h.indexOf("/publicar") === 0) { location.replace("publicar.html"); return; }
    mostrados = 24; inicio();
  }

  $app.innerHTML = '<div class="vacio">Cargando avisos…</div>';
  fetch("data/avisos.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (j) {
    DATA = (j.avisos || []).filter(function (a) { return a.ph && a.ph.length >= 2; });
    DATA.forEach(function (a) { a.mono = esMono(a); });
    deducirBarrios(); contarGuardados();
    ACT = j.actualizado;
    var d = new Date(ACT); document.getElementById("actualizado").textContent = "Actualizado " + d.toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
    window.addEventListener("hashchange", ruta); ruta();
  }).catch(function () { $app.innerHTML = '<div class="vacio">No pudimos cargar los avisos. Probá recargar la página.</div>'; });
})();
