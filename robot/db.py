import requests
from .config import SUPABASE_URL, SUPABASE_KEY

H = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


def _u(tabla):
    return f"{SUPABASE_URL}/rest/v1/{tabla}"


def upsert(tabla, filas):
    if not filas:
        return
    filas = filas if isinstance(filas, list) else [filas]
    r = requests.post(_u(tabla), json=filas, timeout=60,
                      headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"})
    r.raise_for_status()


def actualizar(tabla, filtro, cambios):
    r = requests.patch(_u(tabla), params=filtro, json=cambios, timeout=60,
                       headers={**H, "Prefer": "return=minimal"})
    r.raise_for_status()


def leer(tabla, **params):
    r = requests.get(_u(tabla), params=params, timeout=60, headers=H)
    r.raise_for_status()
    return r.json()


def contar(tabla, **params):
    r = requests.get(_u(tabla), params={**params, "limit": 1}, timeout=60,
                     headers={**H, "Prefer": "count=exact", "Range": "0-0"})
    r.raise_for_status()
    return int(r.headers.get("content-range", "*/0").split("/")[-1])


def ids_conocidos(ids):
    """De una lista de ids, devuelve los que ya están en avisos o descartados."""
    vistos = set()
    for i in range(0, len(ids), 150):
        lote = ",".join(f'"{x}"' for x in ids[i:i + 150])
        for t in ("avisos", "descartados"):
            vistos |= {f["id"] for f in leer(t, select="id", id=f"in.({lote})")}
    return vistos
