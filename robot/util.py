import re, time, random, unicodedata
import requests
from .config import USER_AGENT, PAUSA_SEG, CENTRAL, CDE

S = requests.Session()
S.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "es-PY,es;q=0.9"})


class Bloqueado(Exception):
    """La página pidió un control antibots: frenamos esa fuente por hoy."""


def pedir(url, **kw):
    """Va despacio, como una persona mirando avisos. Si la página tarda o falla, espera más."""
    time.sleep(PAUSA_SEG + random.uniform(0, PAUSA_SEG))
    inicio = time.time()
    try:
        r = S.get(url, timeout=40, allow_redirects=True, **kw)
    except requests.RequestException:
        time.sleep(random.uniform(45, 90))
        raise
    if r.status_code in (202, 403, 429) or r.headers.get("x-amzn-waf-action"):
        raise Bloqueado(f"{r.status_code} en {url}")
    if r.status_code >= 500 or time.time() - inicio > 8:
        time.sleep(random.uniform(30, 60))   # la página está lenta: le damos aire
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
POZO = re.compile(r"\b(en pozo|pre-?venta|en construcci[oó]n)\b", re.I)   # solo obras que todavía no se terminaron
ESTRENAR = re.compile(r"\b(a estrenar|para estrenar|sin estrenar|nuev[oa] a estrenar)\b", re.I)
MASCOTA_SI = re.compile(r"\b(acepta(n)? mascotas?|pet ?friendly|se aceptan mascotas|mascotas permitidas)\b", re.I)
MASCOTA_NO = re.compile(r"\b(no (se )?aceptan? mascotas|sin mascotas|no mascotas|no pet)\b", re.I)


def estado_obra(texto, es_proyecto=False, operacion=None, titulo=""):
    """En pozo es una obra que todavía no se construyó o está a medio hacer, casi siempre en venta.
    Un alquiler nunca va en pozo: si es nuevo, va a estrenar. Si el título dice a estrenar, gana eso."""
    texto, titulo = texto or "", titulo or ""
    pozo = es_proyecto or bool(POZO.search(texto))
    estrenar = bool(ESTRENAR.search(texto))
    if operacion == "alquiler":
        nuevo = pozo or estrenar or re.search(r"\b(entrega (prevista|estimada)|lanzamiento)\b", texto, re.I)
        return "a_estrenar" if nuevo else None
    if ESTRENAR.search(titulo):
        return "a_estrenar"
    if pozo:
        return "en_pozo"
    return "a_estrenar" if estrenar else None   # si no lo dice, no adivinamos


def mascotas(texto):
    if MASCOTA_NO.search(texto or ""):
        return "no"
    if MASCOTA_SI.search(texto or ""):
        return "si"
    return None
