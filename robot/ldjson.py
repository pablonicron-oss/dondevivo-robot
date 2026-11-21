"""Ayudas para fuentes que publican sus avisos con datos estructurados (schema.org RealEstateListing)."""
import re, json, time, random, html
from .util import S, norm, region, estado_obra, mascotas, VENDIDO, Bloqueado

CIUDADES = ["asuncion", "luque", "san lorenzo", "fernando de la mora", "lambare", "capiata", "nemby", "limpio",
            "mariano roque alonso", "villa elisa", "san antonio", "itaugua", "aregua", "ypane", "guarambare",
            "villeta", "encarnacion", "ciudad del este", "hernandarias", "presidente franco", "minga guazu",
            "san bernardino", "caacupe", "coronel oviedo", "pedro juan caballero", "concepcion", "villarrica", "pilar"]


def pedir(url):
    time.sleep(3 + random.uniform(0, 3))
    r = S.get(url, timeout=40, allow_redirects=True)
    if r.status_code in (202, 403, 429):
        raise Bloqueado(f"{r.status_code} en {url}")
    if r.status_code >= 500:
        time.sleep(random.uniform(20, 40))
    return r


def listing(texto):
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', texto, re.S):
        try:
            j = json.loads(m.group(1), strict=False)
        except ValueError:
            continue
        for x in (j if isinstance(j, list) else j.get("@graph", [j])):
            if isinstance(x, dict) and x.get("@type") == "RealEstateListing":
                return x
    return None


def num(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def ciudad_en(texto):
    t = norm(texto).replace("-", " ")
    for c in CIUDADES:
        if re.search(rf"\b{c}\b", t):
            return c.title().replace("Asuncion", "Asunción").replace("Lambare", "Lambaré").replace("Nemby", "Ñemby").replace("Capiata", "Capiatá").replace("Itaugua", "Itauguá").replace("Aregua", "Areguá").replace("Ypane", "Ypané").replace("Guarambare", "Guarambaré").replace("Encarnacion", "Encarnación").replace("Caacupe", "Caacupé").replace("Concepcion", "Concepción")
    return None


def armar(fuente, id_, url, titulo, desc, op, tipo, precio, moneda, dorm, banos, m2, ciudad, barrio, dpto, lat, lng, fotos, fecha, cochera=False):
    titulo = html.unescape(re.sub(r"<[^>]+>", " ", titulo or "")).strip()[:150]
    desc = html.unescape(re.sub(r"<[^>]+>", " ", desc or "")).strip()
    if not titulo or VENDIDO.search(titulo):
        return None, "vendido/alquilado/reservado"
    if not precio:
        return None, "sin precio"
    texto = f"{titulo}\n{desc}"
    return {
        "id": id_, "fuente": fuente, "url": url, "titulo": titulo, "descripcion": desc[:4000],
        "operacion": op, "tipo": tipo, "estado_obra": estado_obra(texto, operacion=op, titulo=titulo),
        "precio": precio, "moneda": "USD" if str(moneda).upper() == "USD" else "PYG",
        "dormitorios": int(dorm) if dorm and tipo != "terreno" else None,
        "banos": int(banos) if banos and tipo != "terreno" else None, "m2": m2,
        "ciudad": ciudad, "barrio": barrio, "departamento": dpto, "region": region(ciudad, dpto),
        "lat": lat, "lng": lng, "fotos": fotos[:20], "fotos_total": len(fotos),
        "comodidades": ["Cochera"] if cochera else [], "garantia": None,
        "mascotas": mascotas(texto), "publicado_en": fecha,
    }, None
