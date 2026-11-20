"""Clasipar (clasipar.paraguay.com). Su robots.txt permite leer las categorías y los avisos.
Leemos las páginas de Inmuebles (casas, departamentos, dúplex y terrenos) y cada aviso por separado."""
import re, json, html
from .util import pedir, norm, region, estado_obra, mascotas, VENDIDO

BASE = "https://clasipar.paraguay.com"
FUENTE = "clasipar"
CATEGORIAS = {"departamentos": "departamento", "casas": "casa", "duplex": "duplex", "terrenos": "terreno"}
PAGINAS = 8   # páginas por categoría en cada corrida (las más nuevas primero)


def id_de(url):
    m = re.search(r"-(\d+)/?$", url)
    return f"{FUENTE}:{m.group(1) if m else url}"


def _op_de_url(u):
    s = norm(u)
    if re.search(r"alquil|alquiler|renta", s):
        return "alquiler"
    if re.search(r"vend|venta", s):
        return "venta"
    return None


def nuevos():
    urls = []
    for cat in CATEGORIAS:
        for p in range(1, PAGINAS + 1):
            r = pedir(f"{BASE}/inmuebles/{cat}/" + (f"page-{p}" if p > 1 else ""))
            if r.status_code != 200:
                break
            hallados = re.findall(rf'href="(https://clasipar\.paraguay\.com/inmuebles/{cat}/[a-z0-9-]+-\d{5,})"', r.text)
            if not hallados:
                break
            urls += [u for u in hallados if not re.search(r"/(busco|compro|necesito)-", u)]
    urls = list(dict.fromkeys(urls))
    return sorted(urls, key=lambda u: 0 if _op_de_url(u) == "alquiler" else 1)   # alquileres primero


def _num(t):
    t = re.sub(r"[^\d,\.]", "", t or "")
    if not t:
        return None
    t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def _texto(h):
    return html.unescape(re.sub(r"<[^>]+>", " ", h or "")).strip()


def leer_aviso(url):
    r = pedir(url)
    if r.status_code == 404 or id_de(url).split(":")[1] not in r.url:
        return None, "ya no existe"
    h = r.text
    pid = id_de(url).split(":")[1]
    ld = {}
    for bloque in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        try:
            j = json.loads(bloque, strict=False)
        except ValueError:
            continue
        if j.get("@type") not in ("BreadcrumbList",):
            ld = j
    titulo = (ld.get("name") or _texto((re.search(r'<meta property="og:title" content="([^"]*)"', h) or [None, ""])[1])).strip()
    if not titulo:
        return None, "ya no existe"
    desc = (ld.get("description") or "").strip()
    modo = norm(_texto((re.search(r'<h6 class="pull-left">(.*?)</h6>', h, re.S) or [None, ""])[1]))
    if "busco" in modo or "compro" in modo:
        return None, "es un pedido, no una oferta"
    op = "alquiler" if "alquiler" in modo else "venta" if "venta" in modo or "vendo" in modo else _op_de_url(url) or "venta"
    if VENDIDO.search(titulo):
        return None, "vendido/alquilado/reservado"
    precio_txt = _texto((re.search(r'<h3 class="user-price">(.*?)</h3>', h, re.S) or [None, ""])[1])
    precio = _num(precio_txt)
    moneda = "USD" if re.search(r"US\$|USD|U\$S", precio_txt) else "PYG"
    if not precio or (moneda == "USD" and precio < 50) or (moneda == "PYG" and precio < 100000):
        return None, "sin precio"

    def dato(etiqueta):
        m = re.search(rf"<span>\s*{etiqueta}:?\s*</span>\s*<h6>(.*?)</h6>", h, re.S | re.I)
        return _texto(m.group(1)) if m else None
    ciudad, zona = dato("Ciudad"), dato("Zona")
    fotos = []
    for f in re.findall(r'"large":"(//clasicdn\.paraguay\.com/pictures/[^"]+)"', h):
        if f"/{pid}/" in f and ("https:" + f) not in fotos:
            fotos.append("https:" + f)
    if not fotos and ld.get("photo"):
        fotos = [ld["photo"].replace("http://", "https://")]
    cat = re.search(r"/inmuebles/([a-z-]+)/", url)
    tipo = CATEGORIAS.get(cat.group(1) if cat else "", "otro")
    texto = f"{titulo}\n{desc}"
    m2 = re.search(r"(\d{2,6}(?:[\.,]\d+)?)\s*(m2|m²|mts2?|metros cuadrados)", norm(texto))
    try:
        dorm = int(ld.get("numberOfRooms") or 0) or None
        banos = int(ld.get("numberOfBathroomsTotal") or 0) or None
    except ValueError:
        dorm = banos = None
    try:
        lat, lng = float(ld.get("latitude") or 0) or None, float(ld.get("longitude") or 0) or None
    except ValueError:
        lat = lng = None
    from .infocasas import barrio_en_texto
    fecha = re.search(r"Publicado el:\s*</span>\s*<h6>(\d{2})/(\d{2})/(\d{4})", h)
    return {
        "id": id_de(url), "fuente": FUENTE, "url": url,
        "titulo": titulo, "descripcion": desc[:4000],
        "operacion": op, "tipo": tipo,
        "estado_obra": estado_obra(texto, operacion=op, titulo=titulo),
        "precio": precio, "moneda": moneda,
        "dormitorios": dorm if tipo != "terreno" else None, "banos": banos if tipo != "terreno" else None,
        "m2": _num(m2.group(1).replace(",", ".")) if m2 else None,
        "ciudad": ciudad, "barrio": zona or barrio_en_texto(texto, ciudad), "departamento": None,
        "region": region(ciudad, None),
        "lat": lat, "lng": lng,
        "fotos": fotos[:20], "fotos_total": len(fotos),
        "comodidades": [],
        "garantia": None,
        "mascotas": mascotas(texto),
        "publicado_en": f"{fecha.group(3)}-{fecha.group(2)}-{fecha.group(1)}" if fecha else None,
    }, None
