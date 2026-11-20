"""Exporta los avisos activos a web/data/avisos.json para la web estática.
La web no tiene claves: solo lee este archivo público."""
import json, os, re, html, requests
from datetime import datetime, timedelta, timezone
from .config import SUPABASE_URL, SUPABASE_KEY

CAMPOS = ("id,fuente,url,titulo,descripcion,operacion,tipo,estado_obra,precio,moneda,dormitorios,banos,"
          "m2,ciudad,barrio,region,lat,lng,fotos,garantia,mascotas,publicado_en,primera_vez,destacado_hasta,contacto")


def todos():
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    out, desde, paso = [], 0, 1000
    while True:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/avisos", timeout=60, headers={**h, "Range": f"{desde}-{desde + paso - 1}"},
                         params={"select": CAMPOS, "activo": "eq.true", "order": "primera_vez.desc"})
        r.raise_for_status()
        lote = r.json()
        out += lote
        if len(lote) < paso:
            return out
        desde += paso


NUNCA_PUBLICOS = ("en revisión", "rechazado", "fotos con diseño, logos o teléfonos")


def bajas(dias=90):
    """Avisos que estuvieron en la web y ya no están (vendidos, alquilados, borrados en la fuente o pausados).
    No se muestran en la búsqueda, pero el que guardó el link ve el aviso con un cartel de que ya no está disponible."""
    h = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    desde_fecha = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()
    out, desde, paso = [], 0, 1000
    while True:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/avisos", timeout=60, headers={**h, "Range": f"{desde}-{desde + paso - 1}"},
                         params={"select": "id,fuente,titulo,operacion,tipo,precio,moneda,dormitorios,m2,ciudad,barrio,fotos,motivo_baja,ultima_revision",
                                 "activo": "eq.false", "ultima_revision": f"gte.{desde_fecha}", "order": "ultima_revision.desc"})
        r.raise_for_status()
        lote = r.json()
        out += [a for a in lote if (a.get("motivo_baja") or "") not in NUNCA_PUBLICOS and a.get("fotos")]
        if len(lote) < paso:
            return out
        desde += paso


def estado_baja(a):
    m = (a.get("motivo_baja") or "").lower()
    if m in ("alquilado", "vendido"):
        return m
    if "vendido/alquilado" in m:
        return "alquilado" if a.get("operacion") == "alquiler" else "vendido"
    if m == "pausado":
        return "pausado"
    return "no_disponible"


def texto_limpio(t):
    """Algunas páginas mandan la descripción con etiquetas HTML: las pasamos a texto común."""
    t = t or ""
    t = re.sub(r"(?i)<br\s*/?>|</p\s*>|</div\s*>|</li\s*>", "\n", t)
    t = re.sub(r"(?i)<li[^>]*>", "• ", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def destacado(a):
    """Devuelve la fecha de fin si el aviso está destacado ahora."""
    h = a.get("destacado_hasta")
    try:
        return h if h and datetime.fromisoformat(h.replace("Z", "+00:00")) > datetime.now(timezone.utc) else None
    except ValueError:
        return None


def corto(a):
    propio = a["fuente"] == "dondevivo"
    return {
        "id": a["id"], "f": a["fuente"], "u": a["url"], "t": texto_limpio(a["titulo"]),
        "d": texto_limpio(a.get("descripcion"))[:1500], "op": a["operacion"], "tp": a["tipo"], "eo": a.get("estado_obra"),
        "p": a.get("precio"), "m": a.get("moneda"), "dor": a.get("dormitorios"), "ban": a.get("banos"),
        "m2": a.get("m2"), "c": a.get("ciudad"), "b": a.get("barrio"), "r": a.get("region"),
        "lat": a.get("lat"), "lng": a.get("lng"), "ph": (a.get("fotos") or [])[:12],
        "g": a.get("garantia"), "ms": a.get("mascotas"), "n": (a.get("primera_vez") or "")[:19],
        "dh": destacado(a), "wa": a.get("contacto") if propio else None,
    }


def main():
    filas = todos()
    avisos = [corto(a) for a in filas]
    hace24 = datetime.now(timezone.utc) - timedelta(hours=24)
    def fecha(x):
        try:
            return datetime.fromisoformat((x or "").replace("Z", "+00:00"))
        except ValueError:
            return None
    ultimas24 = sum(1 for a in filas if (fecha(a.get("primera_vez")) or hace24) > hace24)
    os.makedirs("web/data", exist_ok=True)
    with open("web/data/avisos.json", "w", encoding="utf-8") as f:
        json.dump({"actualizado": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                   "total": len(avisos), "ultimas24": ultimas24, "avisos": avisos},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"Exportados {len(avisos)} avisos")
    ids = {a["id"] for a in avisos}
    fuera = [{"id": a["id"], "f": a["fuente"], "t": texto_limpio(a["titulo"]), "op": a["operacion"], "tp": a["tipo"], "p": a.get("precio"),
              "m": a.get("moneda"), "dor": a.get("dormitorios"), "m2": a.get("m2"), "c": a.get("ciudad"), "b": a.get("barrio"),
              "ph": (a.get("fotos") or [])[:3], "e": estado_baja(a), "fb": (a.get("ultima_revision") or "")[:10]}
             for a in bajas() if a["id"] not in ids]
    with open("web/data/bajas.json", "w", encoding="utf-8") as f:
        json.dump({"bajas": fuera}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Exportados {len(fuera)} avisos que ya no están disponibles")


if __name__ == "__main__":
    main()
