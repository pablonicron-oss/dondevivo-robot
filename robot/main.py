"""Corrida nocturna del robot de DóndeVivo.
1) Re-verifica avisos activos y da de baja los vendidos o borrados.
2) Busca avisos nuevos, filtra (fotos, vendidos) y los guarda.
3) Deja un resumen con el % de avance hacia la meta de 3.000."""
import os, sys, time, json, traceback
from datetime import datetime, timedelta, timezone
from . import db, infocasas, buscodepto, remax, fotos
from .config import GEMINI_KEY, SUPABASE_KEY, META, MAX_NUEVOS, MAX_REVISAR, MAX_LISTADOS, MINUTOS_MAX, MIN_FOTOS
from .util import Bloqueado

INICIO = time.time()
FUENTES = {"infocasas": infocasas, "buscodepto": buscodepto, "remax": remax}


def queda_tiempo():
    return (time.time() - INICIO) < MINUTOS_MAX * 60


def ahora():
    return datetime.now(timezone.utc).isoformat()


def progreso():
    p = {r: db.contar("avisos", activo="eq.true", region=f"eq.{r}") for r in META}
    p["total"] = sum(p.values())
    p["porcentaje"] = round(100 * sum(min(p[r], META[r]) for r in META) / sum(META.values()), 1)
    return p


def preparar_cola():
    if db.contar("cola_listados", fuente="eq.infocasas") > 0:
        return
    filas = [{"url": u, "fuente": "infocasas", "prioridad": p} for u, p in infocasas.listados_del_sitemap()]
    for i in range(0, len(filas), 500):
        db.upsert("cola_listados", filas[i:i + 500])
    print(f"Cola inicial: {len(filas)} páginas de ciudad/barrio")


def revisar_activos(stats):
    limite = (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()
    filas = db.leer("avisos", select="id,url,fuente", activo="eq.true",
                    ultima_revision=f"lt.{limite}", order="ultima_revision.asc", limit=MAX_REVISAR)
    bloqueadas = set()
    for f in filas:
        if not queda_tiempo():
            break
        if f["fuente"] in bloqueadas:
            continue
        try:
            aviso, motivo = FUENTES[f["fuente"]].leer_aviso(f["url"])
        except Bloqueado as e:
            bloqueadas.add(f["fuente"]); stats["notas"].append(f"{f['fuente']} pidió control antibots al revisar: {e}")
            continue
        except Exception as e:
            stats["notas"].append(f"error revisando {f['id']}: {e}"); continue
        stats["revisados"] += 1
        if aviso is None:
            db.actualizar("avisos", {"id": f"eq.{f['id']}"},
                          {"activo": False, "motivo_baja": motivo, "ultima_revision": ahora()})
            stats["bajas"] += 1
        else:
            db.actualizar("avisos", {"id": f"eq.{f['id']}"},
                          {"precio": aviso["precio"], "moneda": aviso["moneda"], "ultima_revision": ahora()})


def _candidatos_infocasas(stats):
    urls = []
    try:
        urls += infocasas.avisos_del_rss()
    except Bloqueado as e:
        stats["notas"].append(f"infocasas bloqueó el feed: {e}"); return urls
    cola = db.leer("cola_listados", select="url", fuente="eq.infocasas",
                   order="prioridad.asc,ultima_vez.asc.nullsfirst", limit=MAX_LISTADOS)
    for c in cola:
        if not queda_tiempo() or len(urls) > MAX_NUEVOS * 2:
            break
        try:
            urls += infocasas.avisos_de_listado(c["url"])
        except Bloqueado as e:
            stats["notas"].append(f"infocasas pidió control antibots en listados: {e}"); break
        except Exception as e:
            stats["notas"].append(f"error en listado {c['url']}: {e}")
        db.actualizar("cola_listados", {"url": f"eq.{c['url']}"}, {"ultima_vez": ahora()})
    return urls


def candidatos(stats):
    """Junta avisos nuevos de cada fuente y los intercala, para que haya variedad."""
    por_fuente = {}
    for nombre, mod in FUENTES.items():
        try:
            urls = _candidatos_infocasas(stats) if nombre == "infocasas" else mod.nuevos()
        except Bloqueado as e:
            stats["notas"].append(f"{nombre} pidió control antibots: {e}"); continue
        except Exception as e:
            stats["notas"].append(f"error buscando en {nombre}: {e}"); continue
        urls = list(dict.fromkeys(urls))[:MAX_NUEVOS * 2]
        conocidos = db.ids_conocidos([mod.id_de(u) for u in urls])
        por_fuente[nombre] = [u for u in urls if mod.id_de(u) not in conocidos]
        stats["notas"].append(f"{nombre}: {len(por_fuente[nombre])} avisos nuevos para revisar")
    mezcla = []
    while any(por_fuente.values()):
        for nombre in list(por_fuente):
            if por_fuente[nombre]:
                mezcla.append((nombre, por_fuente[nombre].pop(0)))
    return mezcla


def sumar_nuevos(stats, prog):
    llenas = {r for r in META if prog[r] >= META[r]}
    bloqueadas = set()
    for nombre, url in candidatos(stats)[:MAX_NUEVOS]:
        if not queda_tiempo():
            break
        if nombre in bloqueadas:
            continue
        mod = FUENTES[nombre]
        try:
            aviso, motivo = mod.leer_aviso(url)
        except Bloqueado as e:
            bloqueadas.add(nombre); stats["notas"].append(f"{nombre} pidió control antibots en avisos: {e}"); continue
        except Exception as e:
            stats["notas"].append(f"error leyendo {url}: {e}"); continue
        if aviso is None:
            db.upsert("descartados", {"id": mod.id_de(url), "motivo": motivo}); stats["descartados"] += 1; continue
        if aviso["region"] in llenas:
            continue   # esa zona ya llegó a su meta; lo dejamos para más adelante
        if aviso["fotos_total"] < MIN_FOTOS:
            db.upsert("descartados", {"id": aviso["id"], "motivo": "menos de 2 fotos"}); stats["descartados"] += 1; continue
        try:
            aprobadas = fotos.revisar(aviso["fotos"])
        except Exception as e:
            stats["notas"].append(f"error revisando fotos {aviso['id']}: {e}"); continue
        if len(aprobadas) < MIN_FOTOS:
            db.upsert("descartados", {"id": aviso["id"], "motivo": "fotos con diseño, logos o teléfonos"})
            stats["descartados"] += 1; continue
        aviso["fotos"] = aprobadas
        aviso["ultima_revision"] = ahora()
        db.upsert("avisos", aviso)
        stats["nuevos"] += 1
        stats.setdefault("por_fuente", {}).setdefault(nombre, 0)
        stats["por_fuente"][nombre] += 1


def limpiar(txt):
    """Nunca dejar claves en los informes."""
    for k in (GEMINI_KEY, SUPABASE_KEY):
        if k:
            txt = txt.replace(k, "***")
    return txt


def resumen(stats, prog):
    txt = (f"## DóndeVivo · corrida del {datetime.now().strftime('%d/%m/%Y')}\n\n"
           f"- Nuevos: **{stats['nuevos']}**\n- Dados de baja: **{stats['bajas']}**\n"
           f"- Descartados: {stats['descartados']}\n- Revisados: {stats['revisados']}\n\n"
           f"### Avance hacia 3.000: **{prog['porcentaje']}%**\n\n"
           + "\n".join(f"- {r}: {prog[r]} / {META[r]}" for r in META)
           + "\n\n### Nuevos por fuente\n" + "\n".join(f"- {k}: {v}" for k, v in stats.get("por_fuente", {}).items())
           + ("\n\n### Notas\n" + "\n".join(f"- {n}" for n in stats["notas"][:30]) if stats["notas"] else ""))
    txt = limpiar(txt)
    print(txt)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(txt)


def main():
    stats = {"nuevos": 0, "bajas": 0, "descartados": 0, "revisados": 0, "notas": []}
    try:
        preparar_cola()
        revisar_activos(stats)
        sumar_nuevos(stats, progreso())
    except Exception:
        stats["notas"].append(traceback.format_exc()[-800:])
    try:
        stats["notas"].insert(0, f"modelo de fotos: {fotos._modelo or 'sin usar'}")
    except Exception:
        pass
    prog = progreso()
    db.upsert("corridas", {"nuevos": stats["nuevos"], "bajas": stats["bajas"], "descartados": stats["descartados"],
                           "revisados": stats["revisados"], "progreso": prog, "notas": limpiar("\n".join(stats["notas"]))[:5000]})
    resumen(stats, prog)


if __name__ == "__main__":
    main()
