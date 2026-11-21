"""Prueba rápida de fuentes nuevas desde GitHub: si responden al robot, si su robots.txt
nos deja leer esa página y cuántos enlaces a avisos se ven. No guarda nada."""
import os, re, time
from urllib.parse import urlparse
from urllib import robotparser
import requests
from .config import USER_AGENT

FUENTES = [
    ("Homy", "https://homy.com.py/buscar/alquiler/departamento/asuncion/"),
    ("InmueblesPy", "https://inmueblespy.com/operacion/alquiler/"),
    ("Mercado Libre", "https://inmuebles.mercadolibre.com.py/alquiler/"),
    ("ClasInmuebles", "https://clasinmuebles.com.py/"),
    ("Alquileres.com.py", "https://alquileres.com.py/"),
    ("Depto.com.py", "https://depto.com.py/"),
    ("Jariton", "https://www.jariton.com.py/alquiler/departamento"),
    ("PropiedadesYA", "https://propiedadesya.com.py/"),
    ("Century 21", "https://www.century21.com.py/"),
    ("Raíces", "https://raices.com.py/"),
    ("Tu Lugar", "https://tulugar.com/es/paraguay"),
    ("Encuentra24", "https://www.encuentra24.com/paraguay-es/bienes-raices-alquiler-apartamentos"),
    ("Hendyla", "https://www.hendyla.com/"),
    ("Alquilo.com.py", "https://alquilo.com.py/"),
    ("Asuncion.estate", "https://asuncion.estate/es/asuncion/alquiler/apartamentos"),
    ("Clasipar", "https://clasipar.paraguay.com/inmuebles/departamentos"),
    ("InfoCasas", "https://www.infocasas.com.py/alquiler/departamentos/asuncion"),
]
S = requests.Session()
S.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "es-PY,es;q=0.9"})


def probar(nombre, url):
    dom = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    fila = {"nombre": nombre, "url": url}
    try:
        rt = S.get(dom + "/robots.txt", timeout=25)
        rp = robotparser.RobotFileParser(); rp.parse(rt.text.splitlines() if rt.status_code == 200 else [])
        fila["robots"] = "permite" if rp.can_fetch(USER_AGENT, url) else "NO permite"
        fila["sitemaps"] = len(re.findall(r"(?im)^sitemap:", rt.text)) if rt.status_code == 200 else 0
    except Exception as e:
        fila["robots"], fila["sitemaps"] = f"error {type(e).__name__}", 0
    time.sleep(3)
    try:
        r = S.get(url, timeout=30)
        fila["estado"] = r.status_code
        fila["kb"] = len(r.content) // 1024
        links = set(re.findall(r'href="([^"#?]+)"', r.text))
        fila["enlaces"] = len([l for l in links if re.search(r"\d{3,}", l) and len(l) > 25])
        fila["alquiler"] = len(re.findall(r"(?i)alquil", r.text))
        fila["ld_json"] = "sí" if "application/ld+json" in r.text else "no"
        fila["desafio"] = "sí" if re.search(r"(?i)cf-chl|challenge-platform|captcha|just a moment", r.text) else "no"
    except Exception as e:
        fila["estado"] = f"error {type(e).__name__}"
    return fila


def main():
    filas = []
    for n, u in FUENTES:
        filas.append(probar(n, u)); time.sleep(3)
    out = ["## Prueba de fuentes nuevas", "", "| Fuente | Estado | robots.txt | Sitemaps | KB | Enlaces a avisos | Menciones de alquiler | Datos estructurados | Desafío anti robots |", "|---|---|---|---|---|---|---|---|---|"]
    for f in filas:
        out.append(f"| [{f['nombre']}]({f['url']}) | {f.get('estado')} | {f.get('robots')} | {f.get('sitemaps')} | {f.get('kb','')} | {f.get('enlaces','')} | {f.get('alquiler','')} | {f.get('ld_json','')} | {f.get('desafio','')} |")
    texto = "\n".join(out)
    print(texto)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(texto + "\n")


if __name__ == "__main__":
    main()
