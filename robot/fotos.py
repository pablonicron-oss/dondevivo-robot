"""Revisa las fotos con Gemini: solo pasan fotos 100% fotográficas.
Se aceptan croquis/planos con poco texto útil. Se rechazan marcos, logos,
teléfonos, sellos de agencia, collages o fotos con mucho texto encima."""
import base64, json, time
import requests
from .config import GEMINI_KEY, GEMINI_MODEL, MIN_FOTOS
from .util import S

MAX_FOTOS_REVISAR = 8

PROMPT = """Sos el editor de fotos de un portal inmobiliario. Para cada imagen, en orden,
decidí si se puede publicar. Reglas:
- OK: foto real de la propiedad, sin nada agregado encima. Una marca de agua chica y
  semitransparente (por ejemplo el globito de RE/MAX, suave) también es OK si no tapa la foto.
- OK: croquis o plano con pocos textos útiles (medidas, ambientes).
- NO: marcos o bandas de diseño, logos grandes u opacos (RE/MAX, Century 21, inmobiliarias),
  teléfonos o WhatsApp sobre la foto, sellos, flyers, collages, renders con texto publicitario,
  capturas de pantalla, fotos borrosas o que no muestran la propiedad.
Respondé solo JSON: {"fotos":[{"ok":true|false,"motivo":"..."}]} con una entrada por imagen."""


_modelo = None
API = "https://generativelanguage.googleapis.com/v1beta"


def _headers():
    return {"x-goog-api-key": GEMINI_KEY}   # la clave va en el encabezado, nunca en la URL


_descartados = set()   # modelos que fallaron una y otra vez en esta corrida


def _candidatos():
    r = requests.get(f"{API}/models", headers=_headers(), params={"pageSize": 200}, timeout=30)
    r.raise_for_status()
    nombres = [m["name"].split("/")[-1] for m in r.json().get("models", [])
               if "generateContent" in (m.get("supportedGenerationMethods") or [])]
    estables = [n for n in nombres if "gemini" in n and not any(x in n for x in ("preview", "exp", "tts", "image", "live", "embedding"))]
    def rango(n):
        pref = 0 if GEMINI_MODEL and n == GEMINI_MODEL else 1 if "flash-lite" in n else 2 if "flash" in n else 3
        return (pref, [-int(x) for x in __import__("re").findall(r"\d+", n)])
    return sorted(estables or nombres, key=rango)


def modelo():
    """Elige un modelo de visión disponible para esta clave (los nombres cambian con el tiempo)."""
    global _modelo
    if _modelo:
        return _modelo
    candidatos = [n for n in _candidatos() if n not in _descartados]
    if not candidatos:
        raise RuntimeError("la clave de Gemini no tiene modelos disponibles")
    _modelo = candidatos[0]
    return _modelo


class Agotado(Exception):
    """Gemini no tiene más cupo por hoy con esta clave."""


_sin_cupo = False      # una vez que se agota, no insistimos en esta corrida


def _pedir_gemini(cuerpo):
    """Si un modelo no tiene cupo (429) probamos el siguiente; si ninguno tiene, avisamos con Agotado
    para que el robot guarde el aviso igual y revise las fotos en otra corrida."""
    global _modelo, _sin_cupo
    if _sin_cupo:
        raise Agotado("Gemini sin cupo")
    ultimo, timeouts = "", 0
    for intento in range(8):
        try:
            m = modelo()
        except RuntimeError:
            _sin_cupo = True
            raise Agotado("ningún modelo de Gemini tiene cupo")
        try:
            resp = requests.post(f"{API}/models/{m}:generateContent", headers=_headers(), json=cuerpo, timeout=60)
        except requests.RequestException as e:
            resp, ultimo = None, f"sin respuesta ({type(e).__name__})"
            timeouts += 1
            if timeouts >= 2:                 # dos demoras seguidas: esta vez no se revisa
                raise RuntimeError(f"Gemini {ultimo} con el modelo {m}")
            time.sleep(10); continue
        if resp.status_code < 400:
            return resp
        ultimo = str(resp.status_code)
        if resp.status_code in (404, 429):    # modelo inexistente o sin cupo: probamos el siguiente
            _descartados.add(m); _modelo = None; continue
        if resp.status_code in (500, 502, 503, 504):
            time.sleep(15); continue
        break
    raise RuntimeError(f"Gemini respondió {ultimo} con el modelo {_modelo}")


def revisar(urls):
    """Devuelve la lista de URLs aprobadas (en el mismo orden)."""
    urls = urls[:MAX_FOTOS_REVISAR]
    partes, validas = [{"text": PROMPT}], []
    for u in urls:
        try:
            r = S.get(u, timeout=20)
            if r.status_code != 200 or len(r.content) < 8000:
                continue
            mime = r.headers.get("content-type", "image/jpeg").split(";")[0]
            partes.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(r.content).decode()}})
            validas.append(u)
        except requests.RequestException:
            continue
    if len(validas) < MIN_FOTOS:
        return []
    cuerpo = {"contents": [{"parts": partes}],
              "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    resp = _pedir_gemini(cuerpo)
    texto = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    veredictos = json.loads(texto).get("fotos", [])
    return [u for u, v in zip(validas, veredictos) if v.get("ok")]
