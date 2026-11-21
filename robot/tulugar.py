"""Tu Lugar (tulugar.com). Su robots.txt deja leer los avisos; salen de su mapa del sitio de Paraguay.
Por ahora solo alquileres de casas, deptos y dúplex."""
import re
from .ldjson import pedir, listing, num, armar

BASE = "https://tulugar.com"
FUENTE = "tulugar"
TIPOS = {"departamento": "departamento", "casa": "casa", "duplex": "duplex"}


def id_de(url):
    m = re.search(r"/([0-9a-f]{8})-", url)
    return f"{FUENTE}:{m.group(1) if m else url}"


def nuevos():
    r = pedir(f"{BASE}/sitemap/properties-paraguay.xml")
    r.raise_for_status()
    urls = re.findall(r"<loc>(https://tulugar\.com/es/propiedades/paraguay/[0-9a-f]{8}-(?:departamento|casa|duplex)[a-z0-9-]*-en-alquiler-[^<]+)</loc>", r.text)
    return list(dict.fromkeys(urls))


def leer_aviso(url):
    r = pedir(url)
    if r.status_code == 404:
        return None, "ya no existe"
    j = listing(r.text)
    if not j:
        return None, "ya no existe"
    of = j.get("offers") or {}
    if "InStock" not in str(of.get("availability", "InStock")):
        return None, "vendido/alquilado/reservado"
    props = {p.get("name"): p.get("value") for p in (j.get("additionalProperty") or []) if isinstance(p, dict)}
    if props.get("Listing Type") and "rent" not in str(props.get("Listing Type")).lower():
        return None, "no es alquiler"
    slug = url.rstrip("/").split("/")[-1]
    tipo = TIPOS.get(slug.split("-")[1])
    if not tipo:
        return None, "no es casa, depto ni dúplex"
    ad, geo = j.get("address") or {}, j.get("geo") or {}
    fotos = [(f.get("url") if isinstance(f, dict) else f) for f in (j.get("image") or [])]
    fotos = [f for f in fotos if isinstance(f, str) and f.startswith("http")]
    m2 = num((j.get("floorSize") or {}).get("value"))
    return armar(FUENTE, id_de(url), url, j.get("name"), j.get("description"), "alquiler", tipo,
                 num(of.get("price")), of.get("priceCurrency"), num(j.get("numberOfBedrooms")),
                 num(j.get("numberOfBathroomsTotal")), m2, ad.get("addressLocality"), ad.get("addressRegion"), None,
                 num(geo.get("latitude")), num(geo.get("longitude")), fotos, j.get("datePosted"),
                 cochera=bool(num(j.get("numberOfParkingSpaces"))))
