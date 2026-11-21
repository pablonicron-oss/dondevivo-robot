"""Homy (homy.com.py). Su robots.txt deja leer los avisos; salen de su mapa del sitio.
Por ahora solo alquileres de casas, deptos y dúplex."""
import re
from .ldjson import pedir, listing, num, ciudad_en, armar

BASE = "https://homy.com.py"
FUENTE = "homy"
TIPOS = {"departamento": "departamento", "casa": "casa", "duplex": "duplex"}


def id_de(url):
    return f"{FUENTE}:{url.rstrip('/').split('/')[-1][:120]}"


def nuevos():
    r = pedir(f"{BASE}/sitemap.xml")
    r.raise_for_status()
    urls = re.findall(r"<loc>(https://homy\.com\.py/propiedades/alquiler-(?:departamento|casa|duplex)-[^<]+)</loc>", r.text)
    return list(dict.fromkeys(urls))


def leer_aviso(url):
    r = pedir(url)
    if r.status_code == 404:
        return None, "ya no existe"
    j = listing(r.text)
    if not j:
        return None, "ya no existe"
    of, ent = j.get("offers") or {}, j.get("mainEntity") or {}
    if "InStock" not in str(of.get("availability", "InStock")):
        return None, "vendido/alquilado/reservado"
    slug = url.rstrip("/").split("/")[-1]
    tipo = TIPOS.get(slug.split("-")[1])
    if not tipo:
        return None, "no es casa, depto ni dúplex"
    titulo = j.get("name") or ""
    ad = ent.get("address") or {}
    geo = ent.get("geo") or {}
    lat, lng = num(geo.get("latitude")), num(geo.get("longitude"))
    ciudad = ad.get("addressLocality") or ciudad_en(slug) or ciudad_en(titulo)
    if not ciudad and lat and lng and -25.36 < lat < -25.22 and -57.68 < lng < -57.53:
        ciudad = "Asunción"   # sin ciudad en el aviso, pero el punto del mapa cae en Asunción
    ap = ent.get("additionalProperty") or {}
    barrio = (ap.get("value") if isinstance(ap, dict) and ap.get("name") == "Barrio" else None) or ad.get("streetAddress")
    barrio = barrio.title() if barrio else None
    m = re.search(r"(\d)\s*(?:d\b|dorm|hab|pieza)", titulo.lower())
    dorm = int(m.group(1)) if m else num(ent.get("numberOfBedrooms"))
    fotos = [f for f in (j.get("image") or []) if isinstance(f, str) and f.startswith("http")]
    return armar(FUENTE, id_de(url), url, titulo, j.get("description"), "alquiler", tipo,
                 num(of.get("price")), of.get("priceCurrency"), dorm, num(ent.get("numberOfBathroomsTotal")), None,
                 ciudad, barrio, None, lat, lng, fotos, j.get("datePosted"),
                 cochera=bool(re.search(r"coch", titulo.lower())))
