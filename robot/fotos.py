"""Revisa las fotos con Gemini: solo pasan fotos 100% fotográficas.
Se aceptan croquis/planos con poco texto útil. Se rechazan marcos, logos,
teléfonos, sellos de agencia, collages o fotos con mucho texto encima."""
import base64, json
import requests
from .config import GEMINI_KEY, GEMINI_MODEL, MIN_FOTOS
from .util import S

MAX_FOTOS_REVISAR = 8

PROMPT = """Sos el editor de fotos de un portal inmobiliario. Para cada imagen, en orden,
decidí si se puede publicar. Reglas:
- OK: foto real de la propiedad, sin nada agregado encima. Una marca de agua muy chica y
  transparente en una esquina también es OK.
- OK: croquis o plano con pocos textos útiles (medidas, ambientes).
- NO: marcos o bandas de diseño, logos grandes (RE/MAX, Century 21, inmobiliarias),
  teléfonos o WhatsApp sobre la foto, sellos, flyers, collages, renders con texto publicitario,
  capturas de pantalla, fotos borrosas o que no muestran la propiedad.
Respondé solo JSON: {"fotos":[{"ok":true|false,"motivo":"..."}]} con una entrada por imagen."""


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
    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        params={"key": GEMINI_KEY}, timeout=90,
        json={"contents": [{"parts": partes}],
              "generationConfig": {"responseMimeType": "application/json", "temperature": 0}})
    resp.raise_for_status()
    texto = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    veredictos = json.loads(texto).get("fotos", [])
    return [u for u, v in zip(validas, veredictos) if v.get("ok")]
