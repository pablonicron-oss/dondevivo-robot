"""BuscoDepto (buscodepto.net). No publica robots.txt.
Usa la misma lista de datos que carga su propia página de resultados."""
import re, html
from .util import pedir, norm, region, estado_obra, mascotas, VENDIDO

BASE = "https://buscodepto.net"
FUENTE = "buscodepto"
_cache = None


def _todas():
    """Trae todas las propiedades visibles (es un sitio chico: pocas páginas)."""
    global _cache
    if _cache is not None:
        return _cache
    _cache = {}
    for tipo in (1, 2, 3):
        pagina, total = 1, 1
        while pagina <= total and pagina <= 30:
            j = pedir(f"{BASE}/api/obtener_propiedades_paginado.php", params={"pagina": pagina, "tipo": tipo}).json()
            total = int(j.get("total_paginas") or 0)
            for p in j.get("propiedades") or []:
                _cache[str(p.get("propiedadid"))] = p
            pagina += 1
    return _cache


def id_de(url):
    m = re.search(r"/propiedad/(\d+)", url)
    return f"{FUENTE}:{m.group(1) if m else url}"


def nuevos():
    return [f"{BASE}/{p['url'].lstrip('/')}" for p in _todas().values() if p.get("url")]


def _limpiar(t):
    t = re.sub(r"<br\s*/?>|</p>|</div>", "\n", t or "", flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", t)).strip()


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def leer_aviso(url):
    pid = id_de(url).split(":")[1]
    p = _todas().get(pid)
    if not p or str(p.get("propiedadvisible")) == "0" or p.get("motivo_ocultar"):
        return None, "ya no existe"
    titulo = (p.get("propiedadtitulo") or "").strip()
    desc = _limpiar(p.get("descripcion") or p.get("propiedaddescripcion"))
    if VENDIDO.search(titulo):
        return None, "vendido/alquilado/reservado"
    fotos = [f"{BASE}/public/{f}" for f in (p.get("propiedadgaleria") or "").split(";") if f.strip()]
    if p.get("imgdestacada") and f"{BASE}/public/{p['imgdestacada']}" not in fotos:
        fotos.insert(0, f"{BASE}/public/{p['imgdestacada']}")
    ciudad = p.get("ciudad_nombre") or p.get("propiedadciudad")
    texto = f"{titulo}\n{desc}"
    from .infocasas import barrio_en_texto
    op = norm(p.get("propiedadtipo"))
    garantia = None
    if p.get("garantia_monto") or p.get("caucion_monto"):
        garantia = f"{p.get('garantia_monto') or p.get('caucion_monto')} {p.get('moneda') or ''}".strip()
    return {
        "id": id_de(url), "fuente": FUENTE, "url": url,
        "titulo": titulo, "descripcion": desc[:4000],
        "operacion": "alquiler" if "alquiler" in op else "venta",
        "tipo": "departamento" if re.search(r"depto|departamento|monoambiente", norm(texto)) else
                "duplex" if "duplex" in norm(texto) else "casa" if "casa" in norm(texto) else "otro",
        "estado_obra": estado_obra(texto, es_proyecto=str(p.get("enconstruccion")) == "1",
                                   operacion="alquiler" if "alquiler" in op else "venta", titulo=titulo),
        "precio": p.get("propiedadprecio_raw"), "moneda": "USD" if "USD" in str(p.get("moneda")) else "PYG",
        "dormitorios": int(_num(p.get("propiedaddormitorios")) or 0) or None,
        "banos": int(_num(p.get("propiedadbanos")) or 0) or None,
        "m2": _num(p.get("mts_cuadrados")),
        "ciudad": ciudad, "barrio": barrio_en_texto(texto, ciudad), "departamento": None,
        "region": region(ciudad, None),
        "lat": _num(p.get("propiedadlat")), "lng": _num(p.get("propiedadlon")),
        "fotos": fotos, "fotos_total": len(fotos),
        "comodidades": [],
        "garantia": garantia,
        "mascotas": mascotas(texto),
        "publicado_en": (p.get("fecha_publicacion") or "")[:10] or None,
    }, None
