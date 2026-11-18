"""InfoCasas Paraguay.
Respeta su robots.txt: no entra a listados combinados (-y-), descubre avisos
por su feed RSS y por las páginas de ciudad/barrio de su mapa del sitio."""
import json, re
from .util import pedir, norm, region, estado_obra, mascotas, VENDIDO

BASE = "https://www.infocasas.com.py"
FUENTE = "infocasas"
RE_AVISO = re.compile(r'href="(/[a-z0-9-]+/(\d{8,9}))"')
OPS = {"alquiler", "venta", "proyectos"}
TIPOS = {"casas", "departamentos", "duplex", "casas-en-condominio"}


def _prioridad(url, metas_cumplidas):
    u = norm(url)
    if "/asuncion" in u and "asuncion" not in metas_cumplidas:
        return 1
    if any(c.replace(" ", "-") in u for c in ["ciudad-del-este", "hernandarias", "minga-guazu", "presidente-franco"]):
        return 2 if "cde" not in metas_cumplidas else 6
    if "/central" in u or any(c in u for c in ["luque", "san-lorenzo", "lambare", "fernando-de-la-mora",
                                                "mariano-roque-alonso", "capiata", "nemby", "limpio",
                                                "villa-elisa", "itaugua", "aregua", "san-antonio"]):
        return 2 if "central" not in metas_cumplidas else 6
    return 4


def listados_del_sitemap(metas_cumplidas=()):
    """Devuelve [(url, prioridad)] de páginas por ciudad/barrio permitidas."""
    r = pedir(f"{BASE}/sitemap_py_1.xml")
    out = []
    for loc in re.findall(r"<loc>([^<]+)</loc>", r.text):
        path = loc.replace(BASE, "")
        partes = path.strip("/").split("/")
        if len(partes) < 3 or partes[0] not in OPS or "-y-" in path:
            continue
        if partes[0] != "proyectos" and partes[1] not in TIPOS:
            continue
        out.append((loc, _prioridad(loc, metas_cumplidas)))
    return out


def avisos_del_rss():
    r = pedir(f"{BASE}/rss-listings")
    return [u for u in re.findall(r"<link>([^<]+/\d{8,9})</link>", r.text)]


def avisos_de_listado(url):
    r = pedir(url)
    return [BASE + p for p, _ in dict.fromkeys(RE_AVISO.findall(r.text))]


RE_BARRIO = re.compile(r"\bbarrio\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][\wÁÉÍÓÚÑáéíóúñ ]{2,30}?)(?=[,.;:\n)\-]|\s+(?:de|en|a|cerca|sobre|zona)\b|$)", re.I)


def barrio_en_texto(texto, ciudad):
    """Busca 'barrio X' en el aviso. Si no aparece, devuelve None (no adivinamos)."""
    m = RE_BARRIO.search(texto or "")
    if not m:
        return None
    b = m.group(1).strip().title()
    if norm(b) in ("cerrado", "privado", "residencial", "tranquilo", "seguro") or norm(b) == norm(ciudad):
        return None
    return b


def id_de(url):
    return f"{FUENTE}:{url.rstrip('/').split('/')[-1]}"


def leer_aviso(url):
    """Devuelve (dict_aviso | None, motivo_si_no). None = el aviso ya no existe."""
    r = pedir(url)
    if r.status_code == 404 or not re.search(r"/\d{8,9}/?$", r.url):
        return None, "ya no existe"
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
    if not m:
        return None, "sin datos"
    d = json.loads(m.group(1))["props"]["pageProps"].get("data") or {}
    if not d or d.get("active") is False:
        return None, "inactivo en la fuente"

    titulo = d.get("title") or ""
    desc = d.get("description") or ""
    if VENDIDO.search(titulo):
        return None, "vendido/alquilado/reservado"

    L = d.get("locations") or {}
    nombres = lambda k: [x.get("name") for x in (L.get(k) or []) if isinstance(x, dict)]
    # En InfoCasas PY: state = departamento (Asunción cuenta como uno).
    # En Asunción, neighbourhood es el barrio; en el resto, neighbourhood es la ciudad.
    dpto = (nombres("state") or [None])[0]
    vecindario = (nombres("neighbourhood") or [None])[0]
    if norm(dpto) == "asuncion":
        ciudad, barrio = "Asunción", vecindario
    else:
        ciudad = (nombres("city") or [None])[0] or vecindario
        extra = [v.get("name") for k in ("zone", "locality", "commune")
                 for v in ([L.get(k)] if isinstance(L.get(k), dict) else (L.get(k) or []))
                 if isinstance(v, dict) and v.get("name")]
        barrio = extra[0] if extra else None
    if not barrio:
        barrio = barrio_en_texto(f"{d.get('title') or ''}\n{d.get('description') or ''}", ciudad)

    op = norm((d.get("operation_type") or {}).get("name"))
    ptype = norm((d.get("property_type") or {}).get("name"))
    tipo = "departamento" if "depart" in ptype else "casa" if "casa" in ptype else \
           "duplex" if "duplex" in ptype else "terreno" if "terreno" in ptype else (ptype or "otro")
    precio = d.get("price") or {}
    mon = ((precio.get("currency") or {}).get("name") or "")
    fotos = [i.get("image") for i in (d.get("images") or []) if i.get("image")]
    texto = f"{titulo}\n{desc}"

    return {
        "id": id_de(url), "fuente": FUENTE, "url": BASE + (d.get("link") or url.replace(BASE, "")),
        "titulo": titulo, "descripcion": desc[:4000],
        "operacion": "alquiler" if "alquiler" in op else "venta" if "venta" in op else op,
        "tipo": tipo,
        "estado_obra": estado_obra(texto, es_proyecto="/proyecto" in r.url),
        "precio": None if precio.get("hidePrice") else precio.get("amount"),
        "moneda": "USD" if "U" in mon else "PYG" if mon else None,
        "dormitorios": d.get("bedrooms"), "banos": d.get("bathrooms"),
        "m2": d.get("m2Built") or d.get("m2") or None,
        "ciudad": ciudad, "barrio": barrio, "departamento": dpto,
        "region": region(ciudad, dpto),
        "lat": d.get("latitude"), "lng": d.get("longitude"),
        "fotos": fotos, "fotos_total": len(fotos),
        "comodidades": [f.get("name") for f in (d.get("facilities") or []) if f.get("name")],
        "garantia": d.get("guarantee") if isinstance(d.get("guarantee"), str) else None,
        "mascotas": mascotas(texto),
        "publicado_en": d.get("created_at"),
    }, None
