"""asuncion.estate (City Estate). Su robots.txt permite leer los avisos a cualquier robot
(solo cierra /api, /go/ y /*/zx-). Los avisos salen de su mapa del sitio de avisos recientes;
los datos de cada aviso, del bloque RealEstateListing (schema.org) de su página."""
import re, json, time, random, html
from .util import S, norm, region, estado_obra, mascotas, VENDIDO, Bloqueado

BASE = "https://asuncion.estate"
FUENTE = "estate"
CATEGORIAS = {"apartamento": "departamento", "departamento": "departamento", "casa": "casa",
              "duplex": "duplex", "dúplex": "duplex", "terreno": "terreno", "lote": "terreno"}
NO_VIVIENDA = re.compile(r"\b(deposito|galpon|tinglado|local|oficina|cochera|garaje|salon|edificio|hotel|chacra|campo|estancia)\b")


def id_de(url):
    m = re.search(r"-(\d{4,})/?$", url)
    return f"{FUENTE}:{m.group(1) if m else url}"


def _pedir(url):
    """Pausa corta y al azar entre pedidos (su robots.txt no pide demora)."""
    time.sleep(2.5 + random.uniform(0, 2.5))
    r = S.get(url, timeout=40, allow_redirects=True)
    if r.status_code in (202, 403, 429):
        raise Bloqueado(f"{r.status_code} en {url}")
    if r.status_code >= 500:
        time.sleep(random.uniform(20, 40))
    return r


def _slug(u):
    return norm(u.rstrip("/").split("/")[-1])


def nuevos():
    r = _pedir(f"{BASE}/map.xml?part=fresh-es-1")
    r.raise_for_status()
    urls = [u for u in re.findall(r"<loc>([^<]+)</loc>", r.text) if "/es/" in u and id_de(u) != f"{FUENTE}:{u}"]
    urls = [u for u in urls if not NO_VIVIENDA.search(_slug(u).replace("-", " "))]
    alq = [u for u in urls if re.search(r"alquil|renta", _slug(u))]
    resto = [u for u in urls if u not in set(alq) and "/es/asuncion/" in u]
    return alq + resto   # alquileres primero; ventas solo de Asunción, que todavía tiene lugar


def leer_aviso(url):
    r = _pedir(url)
    if r.status_code == 404 or id_de(url).split(":")[1] not in r.url:
        return None, "ya no existe"
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', r.text, re.S)
    try:
        j = json.loads(m.group(1), strict=False) if m else {}
    except ValueError:
        j = {}
    if j.get("@type") != "RealEstateListing":
        return None, "ya no existe"
    of, ab = j.get("offers") or {}, j.get("about") or {}
    if "InStock" not in str(of.get("availability", "InStock")):
        return None, "vendido/alquilado/reservado"
    agente = norm((of.get("offeredBy") or {}).get("name"))
    if re.search(r"re/?max", agente):
        return None, "ya lo traemos de RE/MAX"
    titulo = html.unescape(j.get("name") or "").strip()[:150]
    desc = html.unescape(j.get("description") or "").strip()
    if not titulo or VENDIDO.search(titulo):
        return None, "vendido/alquilado/reservado"
    cat = norm(of.get("category"))
    tipo = CATEGORIAS.get(cat)
    if not tipo:
        return None, "no es casa, depto, dúplex ni terreno"
    op = "alquiler" if "LeaseOut" in str(of.get("businessFunction")) else "venta"
    precio = of.get("price")
    try:
        precio = float(precio) if precio else None
    except (TypeError, ValueError):
        precio = None
    moneda = "USD" if str(of.get("priceCurrency")).upper() == "USD" else "PYG"
    if not precio:
        return None, "sin precio"
    ad = ab.get("address") or {}
    ciudad, dpto = ad.get("addressLocality"), ad.get("addressRegion")
    calle = [p.strip() for p in str(ad.get("streetAddress") or "").split(",") if p.strip()]
    barrio = calle[0] if calle and norm(calle[0]) not in (norm(ciudad), norm(dpto), "paraguay") else None
    geo = ab.get("geo") or {}
    fotos = [f for f in (j.get("image") or []) if isinstance(f, str) and f.startswith("http")]

    def num(v):
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
    m2 = num((ab.get("floorSize") or {}).get("value"))
    dorm, banos = num(ab.get("numberOfBedrooms")), num(ab.get("numberOfBathroomsTotal"))
    extras = [f"{p.get('name')}: {p.get('value')}" for p in (ab.get("additionalProperty") or []) if isinstance(p, dict)]
    if num(ab.get("numberOfParkingSpaces")):
        extras.append("Cochera")
    texto = f"{titulo}\n{desc}\n{' '.join(extras)}"
    return {
        "id": id_de(url), "fuente": FUENTE, "url": url,
        "titulo": titulo, "descripcion": desc[:4000],
        "operacion": op, "tipo": tipo,
        "estado_obra": estado_obra(texto, operacion=op, titulo=titulo),
        "precio": precio, "moneda": moneda,
        "dormitorios": int(dorm) if dorm and tipo != "terreno" else None,
        "banos": int(banos) if banos and tipo != "terreno" else None,
        "m2": m2,
        "ciudad": ciudad, "barrio": barrio, "departamento": dpto,
        "region": region(ciudad, dpto),
        "lat": num(geo.get("latitude")), "lng": num(geo.get("longitude")),
        "fotos": fotos[:20], "fotos_total": len(fotos),
        "comodidades": [e for e in extras if e == "Cochera"],
        "garantia": None,
        "mascotas": mascotas(texto),
        "publicado_en": j.get("datePosted"),
    }, None
