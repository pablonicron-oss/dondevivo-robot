import os

USER_AGENT = "DondeVivoBot/1.0 (buscador de inmuebles de Paraguay; contacto: hola@dondevivo.com)"
PAUSA_SEG = 3.0            # pausa entre pedidos a una misma página
MINUTOS_MAX = 330          # tope por noche (repo público: minutos ilimitados, máx. 6 h por corrida)
MAX_NUEVOS = 1200          # avisos nuevos a procesar por noche
MAX_REVISAR = 4000         # avisos activos a re-verificar por noche (todos, a diario)
MAX_LISTADOS = 250         # páginas de ciudad/barrio a recorrer por noche
MIN_FOTOS = 2

META = {"asuncion": 1000, "central": 1100, "cde": 500, "resto": 400}  # 3.000 en total

CENTRAL = ["san lorenzo", "luque", "lambare", "fernando de la mora", "mariano roque alonso",
           "capiata", "nemby", "limpio", "villa elisa", "san antonio", "itaugua", "aregua",
           "ypane", "guarambare", "ita", "j. augusto saldivar", "villeta", "nueva italia"]
CDE = ["ciudad del este", "hernandarias", "minga guazu", "presidente franco"]

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "")   # vacío = el robot elige solo un modelo disponible
