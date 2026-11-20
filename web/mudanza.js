/* DóndeVivo · mudanza en miniatura.
   Un camión llega a una casa, los muñequitos bajan cajas y muebles, se suben y se van.
   Después viene otro camión desde el otro lado a otra casa. Cuando ya se mudó todo el barrio, empieza de nuevo.
   Uso: Mudanza(canvas, { modo: "auto" | "dia" | "noche" }) */
(function () {
  "use strict";
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(l) { return l[Math.floor(Math.random() * l.length)]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    var r = Math.round(lerp(a >> 16, b >> 16, t)), g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t)), bl = Math.round(lerp(a & 255, b & 255, t));
    return "rgb(" + r + "," + g + "," + bl + ")";
  }

  var PARED = ["#F3E6D3", "#E8EEF5", "#F6DCCB", "#E4EBDD", "#EDE4F1", "#F4EBC9", "#DDE7EE"];
  var TECHO = ["#C8553D", "#7A5230", "#5B6B7F", "#9C6B3F", "#46566A"];
  var ROPA = ["#F79009", "#1F4FE0", "#0B7A5E", "#E5484D", "#7A5AF8"];
  var COSAS = [
    { k: "caja", n: 1, w: 12, h: 10, c: "#C69C6D" }, { k: "caja", n: 1, w: 10, h: 9, c: "#B98B5A" }, { k: "caja", n: 1, w: 14, h: 11, c: "#D2A774" },
    { k: "caja", n: 1, w: 11, h: 10, c: "#C69C6D" }, { k: "silla", n: 1, w: 10, h: 14, c: "#8A5A35" }, { k: "planta", n: 1, w: 9, h: 15, c: "#12B76A" },
    { k: "lampara", n: 1, w: 8, h: 16, c: "#F4F5F7" }, { k: "sofa", n: 2, w: 34, h: 13, c: "#3E6FB0" }, { k: "mesa", n: 2, w: 30, h: 12, c: "#9C6B3F" },
    { k: "cama", n: 2, w: 32, h: 10, c: "#F4F5F7" }, { k: "heladera", n: 2, w: 14, h: 24, c: "#E4E7EC" }, { k: "tele", n: 1, w: 16, h: 11, c: "#1D2939" }
  ];

  window.Mudanza = function (cv, op) {
    op = op || {};
    var ctx = cv.getContext("2d"), W = 0, H = 0, dpr = 1, casas = [], fondo = [], faroles = [], estrellas = [], camion = null, obreros = [], cola = [];
    var ultima = 0, reloj = 0, dir = 1, fundido = 0, reinicio = false, modo = op.modo || "auto", vivo = true;
    var BASE, VEREDA, CALLE;

    var anchoArmado = 0;
    function medir() {
      var r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(300, r.width); H = Math.max(200, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      BASE = H - 12; VEREDA = BASE; CALLE = H;
      if (Math.abs(W - anchoArmado) > 40) { anchoArmado = W; camion = null; obreros = []; armarBarrio(); }
    }
    function armarBarrio() {
      casas = []; var x = rnd(10, 30);
      while (x < W - 70) {
        var t = pick(["casa", "casa", "duplex", "edificio", "edificio"]), w, h, pisos = 1;
        if (t === "casa") { w = rnd(70, 92); h = rnd(46, 56); }
        else if (t === "duplex") { w = rnd(84, 104); h = rnd(76, 88); pisos = 2; }
        else { pisos = Math.floor(rnd(4, 7.99)); w = rnd(60, 78); h = Math.min(BASE - 40, pisos * 24 + 18); }
        if (x + w > W - 8) break;
        casas.push({ t: t, x: x, w: w, h: h, pisos: pisos, pared: pick(PARED), techo: pick(TECHO), mudada: false, luces: [] , maceta: false });
        x += w + rnd(14, 34);
      }
      casas.forEach(function (c) { var n = 40; c.luces = []; for (var i = 0; i < n; i++) c.luces.push(Math.random()); });
      faroles = []; for (var f = 60; f < W; f += 170) faroles.push(f + rnd(-10, 10));
      fondo = []; var fx = rnd(-20, 10); while (fx < W) { var fw = rnd(34, 70); fondo.push({ x: fx, w: fw, h: rnd(60, Math.max(70, BASE - 30)), t: pick([0, 0, 1, 2]) }); fx += fw + rnd(-6, 16); }
      estrellas = []; for (var s = 0; s < 14; s++) estrellas.push({ x: Math.random() * W, y: rnd(10, BASE * 0.45), r: rnd(0.4, 1.3), p: Math.random() * 6 });
    }

    /* ---------- día y noche ---------- */
    function noche() {
      if (modo === "dia") return 0; if (modo === "noche") return 1;
      var c = (reloj % 90) / 90, v = Math.cos(c * Math.PI * 2);           // 90 s por día completo
      return Math.max(0, Math.min(1, 0.5 - v * 0.9));
    }

    /* ---------- dibujos ---------- */
    function sombra(x, y, w) { ctx.fillStyle = "rgba(16,24,40,.06)"; ctx.beginPath(); ctx.ellipse(x, y, w / 2, w / 7, 0, 0, Math.PI * 2); ctx.fill(); }
    function cielo(n) {
      var lx = W * 0.88, ly = 34;
      ctx.lineWidth = 1.6;
      if (n < 0.5) { ctx.globalAlpha = 1 - n * 2; ctx.strokeStyle = "#FDB022"; ctx.beginPath(); ctx.arc(lx, ly, 11, 0, Math.PI * 2); ctx.stroke();
        for (var r = 0; r < 8; r++) { var a = r * Math.PI / 4; ctx.beginPath(); ctx.moveTo(lx + Math.cos(a) * 15, ly + Math.sin(a) * 15); ctx.lineTo(lx + Math.cos(a) * 19, ly + Math.sin(a) * 19); ctx.stroke(); } }
      else { ctx.globalAlpha = n * 2 - 1; ctx.strokeStyle = "#98A2B3"; ctx.beginPath(); ctx.arc(lx, ly, 11, 0.9, Math.PI * 2 - 0.9 + Math.PI * 0.0, false); ctx.arc(lx + 6, ly - 3, 9, Math.PI * 2 - 1.25, 1.25, true); ctx.closePath(); ctx.stroke();
        ctx.strokeStyle = "#B2BAC6"; estrellas.forEach(function (st) { var k = 2 + st.r * 1.5, tw = 0.5 + 0.5 * Math.sin(reloj * 1.3 + st.p); ctx.globalAlpha = (n * 2 - 1) * (0.4 + 0.6 * tw);
          ctx.beginPath(); ctx.moveTo(st.x - k, st.y); ctx.lineTo(st.x + k, st.y); ctx.moveTo(st.x, st.y - k); ctx.lineTo(st.x, st.y + k); ctx.stroke(); }); }
      ctx.globalAlpha = 1;
    }
    function skyline(n) {                                                    // ciudad de fondo, en línea muy suave
      ctx.strokeStyle = "#EAECF0"; ctx.lineWidth = 1.2; ctx.fillStyle = "#FFFFFF";
      fondo.forEach(function (b) {
        var y = BASE - b.h; ctx.beginPath(); ctx.rect(b.x, y, b.w, b.h); ctx.fill(); ctx.stroke();
        if (b.t === 1) { ctx.beginPath(); ctx.moveTo(b.x + b.w / 2, y); ctx.lineTo(b.x + b.w / 2, y - 14); ctx.stroke(); }
        if (b.t === 2) { ctx.beginPath(); ctx.rect(b.x + b.w * 0.25, y - 10, b.w * 0.5, 10); ctx.fill(); ctx.stroke(); }
        for (var yy = y + 10; yy < BASE - 12; yy += 14) for (var xx = b.x + 7; xx < b.x + b.w - 9; xx += 12) {
          var on = n > 0.4 && ((xx * 7 + yy * 3) % 23) < 3;
          if (on) { ctx.fillStyle = "rgba(255,206,110," + Math.min(0.75, (n - 0.4) * 2) + ")"; ctx.fillRect(xx, yy, 4, 5); ctx.fillStyle = "#FFFFFF"; }
          else ctx.strokeRect(xx, yy, 4, 5);
        }
      });
    }
    function suelo(n) {
      ctx.strokeStyle = "#D0D5DD"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, BASE + 0.5); ctx.lineTo(W, BASE + 0.5); ctx.stroke();
    }
    var LINEA = "#C3CAD5", AZUL = "#1F4FE0";
    function casa(c, n) {
      var x = c.x, y = BASE - c.h;
      ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.strokeStyle = LINEA; ctx.fillStyle = "#FFFFFF";
      if (c.t !== "edificio") {
        ctx.beginPath(); ctx.moveTo(x, BASE); ctx.lineTo(x, y); ctx.lineTo(x - 5, y); ctx.lineTo(x + c.w / 2, y - (c.t === "casa" ? 24 : 20)); ctx.lineTo(x + c.w + 5, y); ctx.lineTo(x + c.w, y); ctx.lineTo(x + c.w, BASE); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + c.w, y); ctx.stroke();
        if (c.t === "duplex") { ctx.beginPath(); ctx.moveTo(x, y + c.h / 2); ctx.lineTo(x + c.w, y + c.h / 2); ctx.stroke(); }
      } else {
        ctx.beginPath(); ctx.rect(x, y, c.w, c.h); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + c.w + 3, y); ctx.stroke();
      }
      var cols = c.t === "edificio" ? 3 : 2, filas = c.pisos, k = 0;
      var ww = c.t === "edificio" ? 9 : 11, wh = c.t === "edificio" ? 10 : 11;
      for (var f = 0; f < filas; f++) for (var i = 0; i < cols; i++) {
        var wx = x + (c.w / (cols + 1)) * (i + 1) - ww / 2, wy = y + 10 + f * ((c.h - 30) / Math.max(1, filas)) + (c.t === "casa" ? 4 : 0);
        if (c.t !== "edificio" && f === filas - 1 && i === 0) { k++; continue; }
        if (c.t === "edificio" && f === filas - 1 && i === 1) { k++; continue; }
        var prende = n > 0.35 && c.luces[k % c.luces.length] < (c.mudada ? 0.75 : 0.18);
        if (prende) {
          var a = Math.min(1, (n - 0.35) * 2.5);
          var g = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 1, wx + ww / 2, wy + wh / 2, ww * 1.4);
          g.addColorStop(0, "rgba(255,200,90," + 0.35 * a + ")"); g.addColorStop(1, "rgba(255,200,90,0)");
          ctx.fillStyle = g; ctx.fillRect(wx - ww, wy - wh, ww * 3, wh * 3);
          ctx.fillStyle = "rgba(255,196,84," + a + ")"; ctx.fillRect(wx, wy, ww, wh);
        }
        ctx.strokeStyle = LINEA; ctx.lineWidth = 1.2; ctx.strokeRect(wx, wy, ww, wh);
        k++;
      }
      var dx = puerta(c);
      ctx.lineWidth = 1.6;
      if (c.mudada) { ctx.fillStyle = AZUL; ctx.fillRect(dx - 6, BASE - 18, 12, 18); }
      else { ctx.strokeStyle = LINEA; ctx.strokeRect(dx - 6, BASE - 18, 12, 18); }
      if (c.mudada && c.maceta) { ctx.fillStyle = "#E4E7EC"; ctx.fillRect(dx + 10, BASE - 6, 6, 6); ctx.fillStyle = "#12B76A"; ctx.beginPath(); ctx.arc(dx + 13, BASE - 9, 4.5, 0, Math.PI * 2); ctx.fill(); }
    }
    function puerta(c) { return c.t === "edificio" ? c.x + c.w / 2 : c.x + c.w / (c.t === "edificio" ? 4 : 3); }
    function farol(x, n) {
      var y = BASE;
      ctx.strokeStyle = LINEA; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 46); ctx.lineTo(x + 8, y - 48); ctx.stroke();
      ctx.fillStyle = n > 0.4 ? "#FFD27A" : "#D0D5DD"; ctx.fillRect(x + 6, y - 48, 7, 3);
      if (n > 0.4) {
        var a = Math.min(1, (n - 0.4) * 2);
        var g = ctx.createRadialGradient(x + 9, y - 46, 1, x + 9, y - 46, 16);
        g.addColorStop(0, "rgba(255,220,130," + 0.7 * a + ")"); g.addColorStop(1, "rgba(255,220,130,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + 9, y - 46, 16, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(x + 9, y); ctx.scale(1, 0.25);
        var p = ctx.createRadialGradient(0, 0, 2, 0, 0, 52); p.addColorStop(0, "rgba(255,214,120," + 0.3 * a + ")"); p.addColorStop(1, "rgba(255,214,120,0)");
        ctx.fillStyle = p; ctx.beginPath(); ctx.arc(0, 0, 52, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    function dibujarCamion(n) {
      if (!camion) return;
      var x = camion.x, y = BASE, d = camion.d;
      ctx.save(); ctx.translate(x, y); ctx.scale(d, 1);
      
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(-100, -54, 86, 46); ctx.strokeStyle = AZUL; ctx.lineWidth = 1.8; ctx.strokeRect(-100, -54, 86, 46);   // caja del camión
      
      ctx.fillStyle = "#F79009"; ctx.fillRect(-92, -34, 70, 3);
      ctx.fillStyle = AZUL; // cabina
      ctx.beginPath(); ctx.moveTo(-14, -40); ctx.lineTo(8, -40); ctx.lineTo(16, -26); ctx.lineTo(16, -8); ctx.lineTo(-14, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = n > 0.4 ? "#FFE7A3" : "#DCE7FF"; ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(12, -26); ctx.lineTo(-6, -26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#344054";
      [-84, -60, 2].forEach(function (wx) { ctx.beginPath(); ctx.arc(wx, -7, 7, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = "#FFFFFF"; [-84, -60, 2].forEach(function (wx) { ctx.beginPath(); ctx.arc(wx, -7, 2.5, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = n > 0.3 ? "#FFF3C4" : "#FDE68A"; ctx.fillRect(14, -16, 3, 4);       // farol delantero
      ctx.fillStyle = "#E5484D"; ctx.fillRect(-102, -16, 3, 5);                            // luz trasera
      if (n > 0.3) {
        var g = ctx.createLinearGradient(16, 0, 120, 0); g.addColorStop(0, "rgba(255,214,120," + 0.45 * n + ")"); g.addColorStop(1, "rgba(255,240,180,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(17, -15); ctx.lineTo(120, -30); ctx.lineTo(120, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(229,72,77," + 0.35 * n + ")"; ctx.beginPath(); ctx.arc(-102, -13, 7, 0, Math.PI * 2); ctx.fill();
      }
      if (camion.abierto) { ctx.fillStyle = "#EAECF0"; ctx.fillRect(-99, -53, 4, 44); }
      ctx.restore();
    }
    function cosa(it, x, y) {                                                // y = parte de abajo del objeto
      var w = it.w, h = it.h; ctx.save(); ctx.translate(x, y);
      if (it.k === "caja") { ctx.fillStyle = it.c; ctx.fillRect(-w / 2, -h, w, h); ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(-w / 2, -h + h / 2 - 1, w, 2); }
      else if (it.k === "sofa") { ctx.fillStyle = it.c; ctx.fillRect(-w / 2, -h, w, h); ctx.fillRect(-w / 2, -h - 6, w, 6); ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(-w / 2 + 3, -h + 2, w - 6, 3); }
      else if (it.k === "mesa") { ctx.fillStyle = it.c; ctx.fillRect(-w / 2, -h, w, 3); ctx.fillRect(-w / 2 + 2, -h, 3, h); ctx.fillRect(w / 2 - 5, -h, 3, h); }
      else if (it.k === "cama") { ctx.fillStyle = "#9C6B3F"; ctx.fillRect(-w / 2, -h, w, h); ctx.fillStyle = it.c; ctx.fillRect(-w / 2 + 2, -h - 3, w - 4, 5); ctx.fillStyle = "#C7D7FE"; ctx.fillRect(-w / 2 + 3, -h - 5, 8, 3); }
      else if (it.k === "silla") { ctx.fillStyle = it.c; ctx.fillRect(-w / 2, -h, 3, h); ctx.fillRect(-w / 2, -h / 2, w, 3); ctx.fillRect(w / 2 - 3, -h / 2, 3, h / 2); }
      else if (it.k === "planta") { ctx.fillStyle = "#C8553D"; ctx.fillRect(-4, -6, 8, 6); ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(0, -10, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(-3, -13, 3, 0, Math.PI * 2); ctx.fill(); }
      else if (it.k === "lampara") { ctx.fillStyle = "#475467"; ctx.fillRect(-1, -h, 2, h); ctx.fillStyle = "#FDE68A"; ctx.beginPath(); ctx.moveTo(-5, -h + 6); ctx.lineTo(5, -h + 6); ctx.lineTo(3, -h); ctx.lineTo(-3, -h); ctx.fill(); }
      else if (it.k === "heladera") { ctx.fillStyle = it.c; ctx.fillRect(-w / 2, -h, w, h); ctx.fillStyle = "#98A2B3"; ctx.fillRect(-w / 2, -h + 9, w, 1); ctx.fillRect(w / 2 - 3, -h + 3, 1, 4); }
      else if (it.k === "tele") { ctx.fillStyle = it.c; ctx.fillRect(-w / 2, -h, w, h - 2); ctx.fillStyle = "#2E90FA"; ctx.fillRect(-w / 2 + 1, -h + 1, w - 2, h - 4); }
      ctx.restore();
    }
    var ESC = 1.45;
    function muneco(o) {
      if (!o.ve) return;
      ctx.save(); ctx.translate(o.x, o.y); ctx.scale(ESC, ESC); ctx.translate(-o.x, -o.y);
      var x = o.x, y = o.y, paso = o.mueve ? Math.sin(o.fase) * 3 : 0;
      sombra(x, y, 10);
      ctx.strokeStyle = "#344054"; ctx.lineWidth = 2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x - 1, y - 8); ctx.lineTo(x - 1 + paso, y); ctx.moveTo(x + 1, y - 8); ctx.lineTo(x + 1 - paso, y); ctx.stroke();
      ctx.fillStyle = o.ropa; ctx.fillRect(x - 3.5, y - 17, 7, 10);
      ctx.strokeStyle = o.ropa; ctx.lineWidth = 2;
      ctx.beginPath(); if (o.carga) { ctx.moveTo(x - 3, y - 15); ctx.lineTo(x - 3, y - 21); ctx.moveTo(x + 3, y - 15); ctx.lineTo(x + 3, y - 21); }
      else { ctx.moveTo(x - 4, y - 15); ctx.lineTo(x - 5 - paso / 2, y - 9); ctx.moveTo(x + 4, y - 15); ctx.lineTo(x + 5 + paso / 2, y - 9); }
      ctx.stroke();
      ctx.fillStyle = "#F3C9A0"; ctx.beginPath(); ctx.arc(x, y - 20, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = o.casco; ctx.beginPath(); ctx.arc(x, y - 21, 3.6, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 4.5, y - 21.4, 9, 1.4);
      if (o.carga && o.lider) {
        var cx = o.socio ? (o.x + o.socio.x) / 2 : x;
        cosa(o.carga, o.socio ? x + (cx - x) / ESC : x, y - 20);
      }
      ctx.restore();
    }

    /* ---------- la mudanza ---------- */
    function nuevaMudanza() {
      var libres = casas.filter(function (c) { return !c.mudada; });
      if (!libres.length) { reinicio = true; return; }
      var c = pick(libres), px = puerta(c);
      dir = -dir;
      if (px - 150 < 0) dir = 1; else if (px + 150 > W) dir = -1;
      var parque = dir === 1 ? px + 112 : px - 112;
      camion = { c: c, d: dir, x: dir === 1 ? -170 : W + 170, park: parque, fase: "llega", abierto: false, v: 0, espera: 0 };
      cola = []; var n = Math.floor(rnd(7, 11));
      for (var i = 0; i < n; i++) { var it = pick(COSAS); cola.push(Object.assign({}, it)); }
      if (!cola.some(function (z) { return z.n === 2; })) cola.splice(2, 0, Object.assign({}, COSAS[7]));
      obreros = []; var cant = Math.floor(rnd(3, 4.99));
      for (var k = 0; k < cant; k++) obreros.push({ i: k, x: 0, y: 0, ve: false, st: "camion", t: 0, fase: rnd(0, 6), ropa: pick(ROPA), casco: pick(["#F79009", "#FDB022", "#F04438", "#FFFFFF"]), carga: null, lider: false, socio: null, mueve: false });
    }
    function trasera() { return camion.x - camion.d * 104; }
    function caminar(o, tx, ty, vel, dt) {
      var dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy);
      o.mueve = d > 0.5; o.fase += dt * vel * 0.45;
      if (d <= vel * dt) { o.x = tx; o.y = ty; return true; }
      o.x += dx / d * vel * dt; o.y += dy / d * vel * dt; return false;
    }
    function paso(dt) {
      reloj += dt;
      if (reinicio) { fundido += dt; if (fundido > 1.2) { armarBarrio(); reinicio = false; fundido = -1.2; } return; }
      if (fundido < 0) fundido = Math.min(0, fundido + dt);
      if (!camion) { nuevaMudanza(); return; }
      var cm = camion, rx = trasera(), ry = BASE, c = cm.c, dx = puerta(c), dy = BASE;
      if (cm.fase === "llega") {
        var falta = (cm.park - cm.x) * cm.d, v = Math.min(70, Math.max(8, falta * 0.9));
        cm.x += cm.d * v * dt;
        if (falta <= 1) { cm.x = cm.park; cm.fase = "baja"; cm.abierto = true; cm.espera = 0; }
      } else if (cm.fase === "baja") {
        cm.espera += dt;
        obreros.forEach(function (o, i) { if (!o.ve && cm.espera > 0.4 + i * 0.5) { o.ve = true; o.st = "vuelve"; o.x = rx; o.y = ry; } });
        if (obreros.every(function (o) { return o.ve; })) cm.fase = "trabaja";
      } else if (cm.fase === "trabaja") {
        obreros.forEach(function (o) {
          if (o.st === "libre" && cola.length) {
            var it = cola[0];
            if (it.n === 1) { cola.shift(); o.carga = it; o.lider = true; o.socio = null; o.st = "lleva"; }
            else {
              var otro = obreros.find(function (p) { return p !== o && p.st === "libre"; });
              if (otro) { cola.shift(); o.carga = it; otro.carga = it; o.lider = true; otro.lider = false; o.socio = otro; otro.socio = o; o.st = otro.st = "lleva"; otro.x = o.x + cm.d * -0; }
            }
          }
        });
        obreros.forEach(function (o) {
          var vel = o.carga ? (o.socio ? 15 : 19) : 27;
          if (o.st === "lleva") {
            var off = o.socio ? (o.lider ? -10 : 10) : 0;
            if (caminar(o, dx + off, dy, vel, dt)) { o.st = "adentro"; o.t = rnd(0.8, 1.8); }
          } else if (o.st === "adentro") {
            o.ve = false; o.carga = null; o.t -= dt;
            if (o.t <= 0) { o.ve = true; o.st = "vuelve"; o.socio = null; o.lider = false; }
          } else if (o.st === "vuelve") {
            if (caminar(o, rx - cm.d * (8 + o.i * 17), ry, 27, dt)) o.st = "libre";
          } else o.mueve = false;
        });
        if (!cola.length && obreros.every(function (o) { return o.st === "libre"; })) { cm.fase = "sube"; cm.espera = 0; c.mudada = true; c.maceta = Math.random() < 0.6; }
      } else if (cm.fase === "sube") {
        cm.espera += dt;
        obreros.forEach(function (o, i) { if (cm.espera > 0.3 + i * 0.4) o.ve = false; });
        if (obreros.every(function (o) { return !o.ve; })) { cm.abierto = false; cm.fase = "sevan"; cm.v = 0; }
      } else if (cm.fase === "sevan") {
        cm.v = Math.min(80, cm.v + 40 * dt); cm.x += cm.d * cm.v * dt;
        if (cm.x < -200 || cm.x > W + 200) camion = null;
      }
    }
    function dibujar() {
      var n = noche();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      cielo(n); skyline(n); casas.forEach(function (c) { casa(c, n); }); suelo(n);
      faroles.forEach(function (f) { farol(f, n); });
      var orden = obreros.filter(function (o) { return o.ve; }).sort(function (a, b) { return a.x - b.x; });
      dibujarCamion(n);
      orden.forEach(muneco);
      ctx.globalCompositeOperation = "destination-out";                     // que se funda con el blanco a los costados
      var e = Math.min(90, W * 0.12), g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(e / W, "rgba(0,0,0,0)"); g.addColorStop(1 - e / W, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (fundido !== 0) { ctx.fillStyle = "rgba(0,0,0," + Math.min(1, Math.abs(fundido) / 1.2) + ")"; ctx.fillRect(0, 0, W, H); }
      ctx.globalCompositeOperation = "source-over";
    }
    function frame(t) {
      if (!vivo) return;
      if (!cv.isConnected) { vivo = false; return; }                        // se fue de la ficha
      var dt = Math.min(0.05, (t - (ultima || t)) / 1000); ultima = t;
      paso(dt); dibujar(); requestAnimationFrame(frame);
    }
    medir();
    if (window.ResizeObserver) new ResizeObserver(function () { medir(); }).observe(cv);
    requestAnimationFrame(frame);
    return { modo: function (m) { modo = m; }, parar: function () { vivo = false; } };
  };
})();
