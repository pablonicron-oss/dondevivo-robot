import re, time, random, unicodedata
import requests
from .config import USER_AGENT, PAUSA_SEG, CENTRAL, CDE

S = requests.Session()
S.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "es-PY,es;q=0.9"})


class Bloqueado(Exception):
    """La página pidió un control antibots: frenamos esa fuente por hoy."""


def pedir(url, **kw):
    time.sleep(PAUSA_SEG + random.uniform(0, 1.5))
    r = S.get(url, timeout=30, allow_redirects=True, **kw)
    if r.status_code in (202, 403, 429) or r.headers.get("x-amzn-waf-action"):
        raise Bloqueado(f"{r.status_code} en {url}")
    return r


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()


def region(ciudad, departamento):
    c, d = norm(ciudad), norm(departamento)
    if c == "asuncion" or (not c and d == "asuncion"):
        return "asuncion"
    if c in CDE:
        return "cde"
    if d == "central" or c in CENTRAL:
        return "central"
    return "resto"


VENDIDO = re.compile(r"\b(vendid[oa]s?|alquilad[oa]s?|reservad[oa]s?|ya no disponible|no disponible)\b", re.I)
POZO = re.compile(r"\b(en pozo|preventa|pre-venta|entrega (en|prevista|estimada)|lanzamiento|en construcci[oó]n)\b", re.I)
ESTRENAR = re.compile(r"\b(a estrenar|para estrenar|sin estrenar|nuev[oa] a estrenar)\b", re.I)
MASCOTA_SI = re.compile(r"\b(acepta(n)? mascotas?|pet ?friendly|se aceptan mascotas|mascotas permitidas)\b", re.I)
MASCOTA_NO = re.compile(r"\b(no (se )?aceptan? mascotas|sin mascotas|no mascotas|no pet)\b", re.I)


def estado_obra(texto, es_proyecto=False):
    if es_proyecto or POZO.search(texto or ""):
        return "en_pozo"
    if ESTRENAR.search(texto or ""):
        return "a_estrenar"
    return None   # si no lo dice, no adivinamos


def mascotas(texto):
    if MASCOTA_NO.search(texto or ""):
        return "no"
    if MASCOTA_SI.search(texto or ""):
        return "si"
    return None
