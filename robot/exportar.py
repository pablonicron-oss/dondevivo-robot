"""Exporta los avisos activos a web/data/avisos.json para la web estática.
La web no tiene claves: solo lee este archivo público."""
import json, os, requests
from .config import SUPABASE_URL, SUPABASE_KEY

CAMPOS = ("id,fuente,url,titulo,descripcion,operacion,tipo,estado_obra,precio,moneda,dormitorios,banos,"
          "m2,ciudad,barrio,region,lat,lng,fotos,garantia,mascotas,publicado_en,primera_vez")


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


def corto(a):
    return {
        "id": a["id"], "f": a["fuente"], "u": a["url"], "t": a["titulo"],
        "d": (a.get("descripcion") or "")[:1500], "op": a["operacion"], "tp": a["tipo"], "eo": a.get("estado_obra"),
        "p": a.get("precio"), "m": a.get("moneda"), "dor": a.get("dormitorios"), "ban": a.get("banos"),
        "m2": a.get("m2"), "c": a.get("ciudad"), "b": a.get("barrio"), "r": a.get("region"),
        "lat": a.get("lat"), "lng": a.get("lng"), "ph": (a.get("fotos") or [])[:12],
        "g": a.get("garantia"), "ms": a.get("mascotas"), "n": (a.get("primera_vez") or "")[:10],
    }


def main():
    avisos = [corto(a) for a in todos()]
    os.makedirs("web/data", exist_ok=True)
    with open("web/data/avisos.json", "w", encoding="utf-8") as f:
        json.dump({"actualizado": __import__("datetime").datetime.utcnow().isoformat() + "Z", "avisos": avisos},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"Exportados {len(avisos)} avisos")


if __name__ == "__main__":
    main()
