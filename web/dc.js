/* DóndeVivo · motor mínimo para las pantallas armadas en el diseño (Armá tu lugar, Publicá).
   Lee la plantilla de <template id="dc">, completa los {{valores}} y repite <sc-for>/<sc-if>.
   Al cambiar el estado actualiza solo lo que cambió, así no se pierde el foco de los campos. */
(function () {
  "use strict";
  var RE = /\{\{\s*([^}]+?)\s*\}\}/g;

  function valor(scope, path) {
    if (path === "true") return true;
    if (path === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    var parts = path.split("."), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function texto(str, scope) {
    return str.replace(RE, function (_, p) { var v = valor(scope, p); return v == null ? "" : String(v); });
  }
  function soloExpr(str) { var m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(str); return m ? m[1] : null; }

  function render(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(texto(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === "sc-for") {
      var list = valor(scope, soloExpr(node.getAttribute("list")) || "") || [], as = node.getAttribute("as");
      list.forEach(function (it, i) {
        var s = Object.create(scope); s[as] = it; s.$index = i;
        node.childNodes.forEach(function (c) { render(c, s, out); });
      });
      return;
    }
    if (tag === "sc-if") {
      var ex = soloExpr(node.getAttribute("value")) || "", desde = out.length;
      if (valor(scope, ex)) node.childNodes.forEach(function (c) { render(c, scope, out); });
      for (var j = desde; j < out.length; j++) out[j].__k = ex + "|" + (out[j].__k || "");
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== "http://www.w3.org/1999/xhtml"
      ? document.createElementNS(node.namespaceURI, node.tagName) : document.createElement(tag);
    el.__h = {};
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], n = a.name;
      if (n.indexOf("hint-") === 0) continue;
      if (n.length > 2 && n.slice(0, 2) === "on") { var fx = soloExpr(a.value); if (fx) { el.__h[n.slice(2)] = valor(scope, fx); continue; } }
      el.setAttribute(n, texto(a.value, scope));
    }
    var kids = [];
    node.childNodes.forEach(function (c) { render(c, scope, kids); });
    kids.forEach(function (k) { el.appendChild(k); });
    if (el.hasAttribute("value") && "value" in el) el.value = el.getAttribute("value");   // campos de texto, áreas y listas
    out.push(el);
  }

  function enganchar(el) {
    if (!el.__h || el.__on) return;
    el.__on = {};
    Object.keys(el.__h).forEach(function (ev) { escuchar(el, ev); });
  }
  function escuchar(el, ev) {
    if (el.__on[ev]) return;
    el.__on[ev] = true;
    el.addEventListener(ev, function (e) { var f = el.__h && el.__h[ev]; if (typeof f === "function") f(e); });
  }

  function morph(viejo, nuevo) {
    if (viejo.nodeType !== nuevo.nodeType || viejo.__k !== nuevo.__k ||
        (viejo.nodeType === 1 && (viejo.tagName !== nuevo.tagName || (viejo.id || "") !== (nuevo.getAttribute("id") || "")))) {
      viejo.parentNode.replaceChild(nuevo, viejo); conectar(nuevo); return;
    }
    if (viejo.nodeType === 3) { if (viejo.nodeValue !== nuevo.nodeValue) viejo.nodeValue = nuevo.nodeValue; return; }
    var i, a;
    for (i = viejo.attributes.length - 1; i >= 0; i--) { a = viejo.attributes[i].name; if (!nuevo.hasAttribute(a)) viejo.removeAttribute(a); }
    for (i = 0; i < nuevo.attributes.length; i++) {
      a = nuevo.attributes[i];
      if (viejo.getAttribute(a.name) !== a.value) viejo.setAttribute(a.name, a.value);
    }
    if (nuevo.hasAttribute("value") && "value" in viejo && viejo.value !== nuevo.getAttribute("value") && viejo.type !== "file") viejo.value = nuevo.getAttribute("value");
    viejo.__h = nuevo.__h; viejo.__k = nuevo.__k;
    if (!viejo.__on) viejo.__on = {};
    Object.keys(viejo.__h || {}).forEach(function (ev) { escuchar(viejo, ev); });
    hijos(viejo, Array.prototype.slice.call(nuevo.childNodes));
  }
  function hijos(padre, nuevos) {
    var viejos = Array.prototype.slice.call(padre.childNodes), i;
    for (i = 0; i < nuevos.length; i++) {
      if (i < viejos.length) morph(viejos[i], nuevos[i]);
      else { padre.appendChild(nuevos[i]); conectar(nuevos[i]); }
    }
    for (i = nuevos.length; i < viejos.length; i++) padre.removeChild(viejos[i]);
  }
  function conectar(el) {
    if (el.nodeType !== 1) return;
    enganchar(el);
    el.querySelectorAll("*").forEach(enganchar);
  }

  function DCLogic() { this.state = {}; }
  DCLogic.prototype.setState = function (o) {
    this.state = Object.assign({}, this.state || {}, o);
    var self = this;
    if (!this.__pend) { this.__pend = true; Promise.resolve().then(function () { self.__pend = false; self.__pintar(); }); }
  };
  DCLogic.prototype.__pintar = function () {
    var scope = this.renderVals(), out = [];
    this.__tpl.content.childNodes.forEach(function (c) { render(c, scope, out); });
    hijos(this.__root, out);
  };

  window.DCLogic = DCLogic;
  window.DC = {
    montar: function (Componente, raiz) {
      var c = new Componente();
      c.__tpl = document.getElementById("dc");
      c.__root = raiz || document.getElementById("raiz");
      c.__pintar();
      if (c.componentDidMount) c.componentDidMount();
      return c;
    }
  };
})();
