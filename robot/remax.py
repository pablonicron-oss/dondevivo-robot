"""RE/MAX Paraguay (remax.com.py). Su robots.txt permite el sitio a robots en general
(bloquea nombres con 'AI'; el nuestro es DondeVivoBot). Los avisos salen de su mapa
del sitio; los datos de cada aviso, de la misma búsqueda que usa su página."""
import re, time, random
from .util import pedir, S, norm, region, estado_obra, mascotas, VENDIDO, Bloqueado
from .config import PAUSA_SEG

BASE = "https://www.remax.com.py"
FUENTE = "remax"
TIPOS = {"casa": "casa", "departamento": "departamento", "duplex": "duplex", "dúplex": "duplex"}
VENDIDOS = {161, 162, 167, 169, 1616}
FOTO = "https://cdn.gryphtech.com/userimages/114/LargeWM/{}"   # la versión pública, con su marca de agua


def id_de(url):
    return f"{FUENTE}:{url.rstrip('/').split('/')[-1]}"


def _partes(url):
    # /es-py/propiedades/<tipo>/<operacion>/<ciudad>/.../<MLSID>
    p = url.split("/propiedades/")[-1].split("/")
    return (p + ["", "", ""])[:3]


def _prioridad(url):
    ciudad = _partes(url)[2]
    if ciudad in ("asuncion",) or "asuncion" in url:
        return 1
    return 2


def nuevos():
    r = pedir(f"{BASE}/sitemap_listings_1.xml")
    urls = re.findall(r"<loc>([^<]+)</loc>", r.text)
    out = [u for u in urls if "/es-py/" in u and _partes(u)[0] in TIPOS and _partes(u)[1] in ("alquiler", "venta")]
    random.shuffle(out)
    return sorted(out, key=_prioridad)


def _buscar(mlsid):
    time.sleep(PAUSA_SEG + random.uniform(0, 1.5))
    r = S.post(f"{BASE}/search/listing-search/docs/search", timeout=30, json={
        "skip": 0, "top": 1, "searchMode": "any", "queryType": "simple", "search": "*",
        "filter": f"content/TenantId eq 6 and content/MLSID eq '{mlsid}'"})
    if r.status_code in (202, 403, 429):
        raise Bloqueado(f"{r.status_code} en búsqueda RE/MAX")
    r.raise_for_status()
    v = r.json().get("value") or []
    return v[0]["content"] if v else None


def leer_aviso(url):
    mlsid = url.rstrip("/").split("/")[-1]
    c = _buscar(mlsid)
    if not c or not c.get("IsViewable") or c.get("OnHoldListing"):
        return None, "ya no existe"
    if c.get("ListingStatusUID") in VENDIDOS or c.get("SoldDate"):
        return None, "vendido/alquilado/reservado"
    descs = [d for d in (c.get("ListingDescriptions") or []) if str(d.get("LanguageCode", "")).startswith("es")]
    largas = sorted(descs, key=lambda d: len(d.get("Description") or ""), reverse=True)
    desc = re.sub(r"<br\s*/?>", "\n", (largas[0].get("Description") if largas else "") or "")
    desc = re.sub(r"https?://\S+", "", re.sub(r"<[^>]+>", " ", desc)).strip()
    titulo = (largas[-1].get("Description") if len(largas) > 1 else "") or desc.split("\n")[0]
    titulo = re.sub(r"[*_]", "", titulo).strip()[:150]
    if VENDIDO.search(titulo):
        return None, "vendido/alquilado/reservado"
    tipo_url, op_url, _ = _partes(url)
    imgs = sorted(c.get("ListingImages") or [], key=lambda i: int(i.get("Order") or 99))
    fotos = [FOTO.format(i["FileName"]) for i in imgs if i.get("FileName")]
    feats = [str(f.get("FeatureName", "")).replace("PropertyFeatures_", "") for f in (c.get("ListingFeatures") or [])]
    texto = f"{titulo}\n{desc}\n{' '.join(feats)}"
    masc = "no" if any("No pets" in f for f in feats) else "si" if any("Pets allowed" in f or "Pet friendly" in f for f in feats) else mascotas(texto)
    loc = c.get("Location") or ""
    m = re.search(r"\[(-?[\d.]+),\s*(-?[\d.]+)\]", loc if isinstance(loc, str) else str(loc))
    ciudad, dpto = c.get("City"), c.get("Province")
    return {
        "id": id_de(url), "fuente": FUENTE, "url": url,
        "titulo": titulo, "descripcion": desc[:4000],
        "operacion": op_url, "tipo": TIPOS.get(tipo_url, tipo_url),
        "estado_obra": estado_obra(texto, operacion=op_url, titulo=titulo),
        "precio": None if c.get("HidePricePublic") else c.get("ListingPrice"),
        "moneda": "USD" if c.get("ListingCurrency") == "USD" else "PYG",
        "dormitorios": c.get("NumberOfBedrooms"), "banos": c.get("NumberOfBathrooms"),
        "m2": c.get("BuiltArea") or c.get("TotalArea"),
        "ciudad": ciudad, "barrio": c.get("LocalZone") or None, "departamento": dpto,
        "region": region(ciudad, dpto),
        "lat": float(m.group(2)) if m else None, "lng": float(m.group(1)) if m else None,
        "fotos": fotos, "fotos_total": len(fotos),
        "comodidades": [f for f in feats if f and "pets" not in f.lower()],
        "garantia": None,
        "mascotas": masc,
        "publicado_en": None,
    }, None
