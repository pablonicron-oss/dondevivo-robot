/* DóndeVivo · medición de visitas con Google Analytics (G-BY59KQ5XFF).
   Cuenta cada pantalla (también las de la web de una sola página, que cambian con #)
   y las acciones que importan: buscar alquiler, venta o terrenos, abrir un aviso,
   tocar WhatsApp, ir a publicar, comparar y publicar un aviso. */
(function () {
  var ID = "G-BY59KQ5XFF";
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", ID, { send_page_view: false });

  function evento(nombre, datos) { try { gtag("event", nombre, datos || {}); } catch (e) {} }
  window.dvMedir = evento;

  var ultima = "";
  function pantalla() {
    var dir = location.pathname + location.hash;
    if (dir === ultima) return;
    ultima = dir;
    evento("page_view", { page_location: location.href, page_title: document.title });
    var h = location.hash.replace(/^#/, "");
    if (h.indexOf("/terrenos") === 0) evento("busqueda_terreno");
    else if (h.indexOf("/buscar") === 0) {
      var op = (h.split("?")[1] || "").match(/(?:^|&)op=([^&]*)/);
      evento(op && decodeURIComponent(op[1]) === "venta" ? "busqueda_venta" : "busqueda_alquiler");
    }
    else if (h.indexOf("/aviso/") === 0) evento("ver_aviso");
    else if (h.indexOf("/comparar") === 0) evento("ver_comparar");
  }
  window.addEventListener("hashchange", pantalla);
  pantalla();

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("a,button") : null;
    if (!el) return;
    var href = el.getAttribute("href") || "";
    if (el.hasAttribute("data-anuncio")) evento("click_anunciar");
    else if (/wa\.me|api\.whatsapp|whatsapp\.com/.test(href)) evento("whatsapp", { donde: location.hash.indexOf("/aviso/") >= 0 ? "aviso" : "otro" });
    else if (/publicar\.html|#\/publicar/.test(href)) evento("ir_publicar");
    else if (el.classList && el.classList.contains("cmpb")) evento("agregar_comparar");
  }, true);
})();
