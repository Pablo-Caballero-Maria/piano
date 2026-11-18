"""Los diagramas de la memoria del proyecto (SVG y PNG en esta carpeta).

    uv run python docs/memoria/diagramas.py      # escribe *.svg y, con rsvg-convert, *.png (2x)

Cada diagrama es una función que dibuja con las ayudas de `Lienzo`; las coordenadas son píxeles
del SVG. Los PNG son los que lleva el documento de Google Docs.
"""

from __future__ import annotations

import html
import shutil
import subprocess
from pathlib import Path

AQUI = Path(__file__).resolve().parent
FUENTE = "Noto Sans, Liberation Sans, sans-serif"
TINTA, SUAVE, LINEA = "#1F2937", "#4B5563", "#475569"
AZUL = ("#EEF4FB", "#A8C1DF")  # el aula
AZUL_PC = ("#DDE8F5", "#8FAED3")  # el PC
MORADO = ("#F4F1FA", "#C3B6E0")  # internet
VERDE = ("#EEF7EE", "#A9D3A9")  # casa
NARANJA = ("#FFF7ED", "#C2410C")  # la placa y el zumbador
NOTA = ("#FEF9C3", "#CA8A04")  # notas de los diagramas de secuencia
ORO = "#B45309"


def ancho(texto: str, tam: float, negrita: bool = False) -> float:
    """Ancho aproximado de un texto en Noto Sans."""
    return len(texto) * tam * (0.6 if negrita else 0.55)


class Lienzo:
    def __init__(self, w: int, h: int):
        self.w, self.h, self.partes = w, h, []

    def rect(self, x, y, w, h, fondo="#FFFFFF", borde=LINEA, grosor=1.5, rx=10, guiones=False):
        d = ' stroke-dasharray="6 4"' if guiones else ""
        self.partes.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fondo}" '
            f'stroke="{borde}" stroke-width="{grosor}"{d}/>'
        )

    def texto(self, x, y, s, tam=12.5, negrita=False, color=TINTA, ancla="start", giro=None, mono=False):
        g = f' transform="rotate({giro} {x} {y})"' if giro is not None else ""
        familia = "Noto Sans Mono, monospace" if mono else FUENTE
        peso = ' font-weight="700"' if negrita else ""
        self.partes.append(
            f'<text x="{x}" y="{y}" font-family="{familia}" font-size="{tam}"{peso} fill="{color}" '
            f'text-anchor="{ancla}"{g}>{html.escape(s)}</text>'
        )

    def caja(
        self,
        x,
        y,
        w,
        h,
        titulo,
        lineas=(),
        fondo="#FFFFFF",
        borde=LINEA,
        tam_t=15,
        tam_l=12.5,
        centrar=False,
        rx=10,
        grosor=1.5,
        color_l=SUAVE,
    ):
        self.rect(x, y, w, h, fondo, borde, grosor, rx)
        alto = tam_t * 1.35 + len(lineas) * tam_l * 1.45
        cy = y + (h - alto) / 2 + tam_t
        tx, ancla = (x + w / 2, "middle") if centrar else (x + 14, "start")
        self.texto(tx, cy, titulo, tam_t, True, TINTA, ancla)
        for i, linea in enumerate(lineas):
            self.texto(tx, cy + tam_t * 0.4 + (i + 1) * tam_l * 1.45, linea, tam_l, False, color_l, ancla)

    def zona(self, x, y, w, h, nombre, colores):
        self.rect(x, y, w, h, colores[0], colores[1], 1.5, 14)
        self.texto(x + 18, y + 26, nombre.upper(), 13, True, "#6B7280")

    def flecha(self, puntos, doble=False, guiones=False, color=LINEA, grosor=1.6):
        d = " ".join(f"{x},{y}" for x, y in puntos)
        extra = ' marker-start="url(#ini)"' if doble else ""
        g = ' stroke-dasharray="6 4"' if guiones else ""
        self.partes.append(
            f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="{grosor}" '
            f'stroke-linejoin="round" marker-end="url(#fin)"{extra}{g}/>'
        )

    def linea(self, puntos, color=LINEA, grosor=1.6, guiones=False):
        d = " ".join(f"{x},{y}" for x, y in puntos)
        g = ' stroke-dasharray="5 5"' if guiones else ""
        self.partes.append(
            f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="{grosor}"{g}/>'
        )

    def etiqueta(self, x, y, lineas, tam=11.5, ancla="middle", fondo="#FFFFFF", giro=None, mono=False):
        """Texto sobre una flecha, con fondo para que se lea encima de las líneas."""
        if isinstance(lineas, str):
            lineas = [lineas]
        w = max(ancho(s, tam) for s in lineas) * (1.08 if mono else 1) + 8
        h = len(lineas) * tam * 1.3 + 4
        x0 = {"middle": x - w / 2, "start": x - 4, "end": x - w + 4}[ancla]
        y0 = y - tam - 1
        if giro is None:
            self.rect(x0, y0, w, h, fondo, fondo, 0, 3)
        else:
            self.partes.append(
                f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="3" fill="{fondo}" '
                f'transform="rotate({giro} {x} {y})"/>'
            )
        for i, s in enumerate(lineas):
            self.texto(x, y + i * tam * 1.3, s, tam, False, "#374151", ancla, giro, mono)

    def rombo(self, cx, cy, w, h, texto, tam=12.5):
        p = f"{cx},{cy - h / 2} {cx + w / 2},{cy} {cx},{cy + h / 2} {cx - w / 2},{cy}"
        self.partes.append(f'<polygon points="{p}" fill="#FFFFFF" stroke="{LINEA}" stroke-width="1.5"/>')
        self.texto(cx, cy + tam * 0.35, texto, tam, True, TINTA, "middle")

    def svg(self) -> str:
        marcas = (
            '<defs><marker id="fin" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{LINEA}"/></marker>'
            '<marker id="ini" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="{LINEA}"/></marker></defs>'
        )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}">{marcas}'
            f'<rect width="{self.w}" height="{self.h}" fill="#FFFFFF"/>' + "".join(self.partes) + "</svg>"
        )


# ---- 1. Arquitectura general ---------------------------------------------------------------------
def arquitectura() -> Lienzo:
    c = Lienzo(1200, 760)
    c.zona(20, 40, 740, 700, "Aula · router WiFi 2,4 GHz (WPA2)", AZUL)
    c.zona(790, 205, 390, 350, "Internet", MORADO)
    c.zona(790, 575, 390, 165, "Casa", VERDE)

    # Cómo leer el diagrama
    c.rect(790, 40, 390, 145, "#FFFFFF", "#CBD5E1", 1.2, 10)
    c.texto(808, 66, "Cómo leer el diagrama", 13.5, True)
    c.flecha([(810, 90), (850, 90)])
    c.texto(860, 94, "petición", 12, color=SUAVE)
    c.flecha([(950, 90), (990, 90)], doble=True)
    c.texto(1000, 94, "en los dos sentidos", 12, color=SUAVE)
    for i, s in enumerate(
        [
            "Lo que cruza la WiFi o sale a internet va cifrado",
            "(HTTPS, WebSocket seguro, MQTT con TLS). Sin cifrar,",
            "solo dentro del PC: de nginx a la app y a Mosquitto.",
        ]
    ):
        c.texto(808, 122 + i * 19, s, 12, color=SUAVE)

    # El aula
    c.caja(45, 110, 230, 96, "Móviles del aula", ["profesor y alumnos,", "en el navegador"])
    c.rect(335, 90, 400, 490, AZUL_PC[0], AZUL_PC[1], 1.5, 12)
    c.texto(355, 118, "PC del profesor (nodo fog)", 15, True)
    c.texto(355, 138, "Linux · systemd: todo arranca solo", 12.5, color=SUAVE)
    c.caja(360, 155, 350, 58, "nginx", ["HTTPS :443 · certificado Let's Encrypt"])
    c.rect(360, 235, 350, 210)
    c.texto(374, 259, "Aplicación fog", 15, True)
    c.texto(374, 279, "Python · FastAPI · :8080 (solo local)", 12.5, color=SUAVE)
    for i, s in enumerate(
        [
            "web estática y API REST (cuentas, melodías)",
            "clase en directo por WebSocket",
            "cola del zumbador",
            "enlace con la placa (MQTT)",
            "sincronización con Atlas",
            "actualizaciones desde GitHub",
            "DuckDNS y puente con Ably",
        ]
    ):
        c.texto(380, 304 + i * 20, "• " + s, 12.5, color="#374151")
    c.caja(
        360,
        470,
        350,
        88,
        "Mosquitto",
        ["broker MQTT · :1883 solo local", ":8883 con TLS para la placa · ACL"],
    )
    c.flecha([(535, 213), (535, 235)])
    c.etiqueta(548, 229, "HTTP local", ancla="start", fondo=AZUL_PC[0])
    c.flecha([(535, 447), (535, 468)], doble=True)
    c.etiqueta(548, 462, "MQTT :1883", ancla="start", fondo=AZUL_PC[0])

    c.caja(
        45,
        440,
        230,
        120,
        "Placa ESP32",
        ["MicroPython 1.29", "MQTT con TLS", "almacén cifrado", "se actualiza con tests"],
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    c.caja(
        45, 640, 230, 70, "Zumbador pasivo", ["una sola nota a la vez"], fondo=NARANJA[0], borde=NARANJA[1]
    )
    c.flecha([(160, 560), (160, 638)])
    c.etiqueta(172, 604, "PWM · GPIO 33", ancla="start", fondo=AZUL[0])

    c.flecha([(275, 175), (358, 175)], doble=True)
    c.etiqueta(317, 160, ["HTTPS y", "WebSocket"], fondo=AZUL[0])
    c.flecha([(275, 525), (358, 525)], doble=True)
    c.etiqueta(317, 510, ["MQTT/TLS", ":8883"], fondo=AZUL[0])
    c.flecha([(275, 462), (318, 462), (318, 200), (358, 200)])
    c.etiqueta(305, 331, "HTTPS: descarga de actualizaciones", giro=-90, fondo=AZUL[0])

    # Internet
    servicios = [
        ("GitHub", "código del proyecto", "git fetch"),
        ("DuckDNS · Let's Encrypt", "el nombre del aula, su certificado", "IP · reto DNS"),
        ("MongoDB Atlas", "todas las cuentas y melodías, cifradas", "sync"),
        ("Ably", "clases en directo por internet", "relay"),
    ]
    for i, (t, s, e) in enumerate(servicios):
        y = 245 + i * 56
        c.caja(815, y, 340, 48, t, [s], tam_t=14, tam_l=11.5)
        c.flecha([(710, y + 24), (813, y + 24)], doble=(e == "sync"))
        c.etiqueta(762, y + 18, e, fondo=AZUL_PC[0] if False else "#FFFFFF")
    c.caja(
        815, 478, 225, 64, "Vercel", ["la misma web + API", "sobre Atlas · tokens Ably"], tam_t=14, tam_l=11.5
    )

    # Casa
    c.caja(
        815,
        630,
        340,
        80,
        "Alumnos en casa",
        ["navegador en la web de Vercel", "(o un profesor que da clase online)"],
    )
    c.flecha([(925, 630), (925, 544)])
    c.etiqueta(935, 595, "HTTPS: web y API", ancla="start", fondo=VERDE[0])
    c.flecha([(1100, 630), (1100, 463)], doble=True)
    c.etiqueta(1108, 595, "WebSocket", ancla="start", fondo=VERDE[0])
    return c


# ---- 2. Módulos del software ---------------------------------------------------------------------
def modulos() -> Lienzo:
    c = Lienzo(1200, 770)
    c.zona(20, 40, 250, 700, "Navegador", AZUL)
    c.zona(360, 40, 470, 700, "PC del profesor", AZUL_PC)
    c.zona(920, 40, 260, 700, "Placa ESP32", NARANJA)
    c.texto(38, 86, "web/ · Next.js + TypeScript", 12, color=SUAVE)
    c.texto(378, 86, "fog/ y pianocore/ · Python", 12, color=SUAVE)
    c.texto(938, 86, "esp32/ · MicroPython", 12, color=SUAVE)

    def m(x, y, w, t, s):
        c.caja(x, y, w, 58, t, [s], tam_t=13.5, tam_l=11.5)

    filas = [110, 186, 262, 338, 414, 490, 566, 642]
    navegador = [
        ("components/", "React: piano, Studio, clase"),
        ("studio/engine", "piano roll y reproducción"),
        ("lib/notes", "notas, frecuencia resultante"),
        ("services/sound", "sonido en el propio móvil"),
        ("services/api", "cliente REST y sesión"),
        ("services/link", "WebSocket (aula) o Ably"),
        ("state/class-state", "la clase vista por la página"),
    ]
    for (t, s), y in zip(navegador, filas, strict=False):
        m(38, y, 214, t, s)

    izq = {
        110: ("app.py, website.py", "FastAPI y la web estática"),
        186: ("pianocore/auth", "contraseñas y sesiones"),
        262: ("pianocore/models", "usuarios y melodías"),
        338: ("pianocore/ably", "canales y tokens de Ably"),
        414: ("pianocore/api, service", "API REST y sus reglas"),
        490: ("classroom.py", "la clase en directo"),
        566: ("buzzer_queue.py", "quién toca el zumbador"),
        642: ("ably_bridge.py", "la clase hacia Ably"),
    }
    der = {
        110: ("pianocore/crypto", "AES-256-GCM y HKDF"),
        186: ("sync_service, sync", "placa ⇄ Atlas"),
        262: ("internet.py", "conexión y DuckDNS"),
        338: ("updater.py", "de GitHub al PC y la placa"),
        414: ("pianocore/kv_repo", "registros en la placa"),
        566: ("board.py", "enlace MQTT (aiomqtt)"),
    }
    for y, (t, s) in izq.items():
        m(378, y, 205, t, s)
    for y, (t, s) in der.items():
        m(607, y, 205, t, s)
    placa = {
        110: ("main.py", "arranque y rollback"),
        186: ("config.py, ca.pem", "ajustes y raíces TLS"),
        338: ("updater.py, ota.py", "versiones, descarga, tests"),
        414: ("kv.py", "btree de blobs cifrados"),
        490: ("tests/", "se ejecutan en la placa"),
        566: ("app.py, mqtt.py", "WiFi, reloj, MQTT/TLS"),
        642: ("tone.py", "PWM en GPIO 33"),
    }
    for y, (t, s) in placa.items():
        m(938, y, 224, t, s)

    # Entre columnas
    c.flecha([(252, 443), (376, 443)], doble=True)
    c.etiqueta(314, 430, ["REST", "JSON + token"], fondo=AZUL[0])
    c.flecha([(252, 519), (376, 519)], doble=True)
    c.etiqueta(314, 506, ["WebSocket", "JSON"], fondo=AZUL[0])
    c.flecha([(812, 367), (936, 367)])
    c.etiqueta(874, 354, ["MQTT ota", "+ HTTPS"], fondo="#FFFFFF")
    c.flecha([(812, 443), (936, 443)], doble=True)
    c.etiqueta(874, 430, ["MQTT kv", "binario"], fondo="#FFFFFF")
    c.flecha([(812, 595), (936, 595)], doble=True)
    c.etiqueta(874, 582, ["MQTT/TLS", "tone, status"], fondo="#FFFFFF")
    # Dentro del PC y de la placa
    c.flecha([(583, 443), (605, 443)])
    c.flecha([(480, 548), (480, 564)])
    c.flecha([(583, 595), (605, 595)])
    c.flecha([(710, 472), (710, 564)])
    c.flecha([(1050, 624), (1050, 640)])
    c.texto(
        378,
        724,
        "Vercel (api/index.py) usa el mismo pianocore, con Atlas en vez de la placa.",
        11.5,
        color=SUAVE,
    )
    return c


# ---- 3. Conexionado del hardware -----------------------------------------------------------------
def hardware() -> Lienzo:
    c = Lienzo(1000, 560)
    c.rect(80, 60, 300, 330, "#E8F1F8", "#1F4E79", 2, 14)
    c.texto(100, 92, "Placa ESP32 (DevKit)", 16, True)
    for i, s in enumerate(["MicroPython 1.29", "4 MB de flash · WiFi 2,4 GHz", "LED integrado en GPIO 2"]):
        c.texto(100, 116 + i * 20, s, 12.5, color=SUAVE)
    c.rect(110, 190, 150, 120, "#9CA3AF", "#4B5563", 1.2, 4)
    c.texto(185, 245, "ESP32-WROOM", 12.5, True, "#FFFFFF", "middle")
    c.texto(185, 263, "WiFi · 2 núcleos", 11, False, "#F3F4F6", "middle")

    c.rect(620, 130, 270, 230, "#F3F4F6", "#111827", 2, 14)
    c.texto(640, 162, "Módulo zumbador pasivo", 16, True)
    c.texto(640, 184, "3 pines: S, central (+), −", 12.5, color=SUAVE)
    c.partes.append('<circle cx="800" cy="270" r="44" fill="#111827"/>')
    c.partes.append('<circle cx="800" cy="270" r="10" fill="#374151"/>')

    cables = [
        (215, "3V3", "+ (central)", "#DC2626", "3,3 V"),
        (265, "GPIO 33 (D33)", "S (señal)", "#EA580C", "PWM: la nota"),
        (315, "GND", "− (masa)", "#111827", "masa"),
    ]
    for y, pin_placa, pin_zumb, color, txt in cables:
        c.rect(380, y - 6, 14, 12, "#D1D5DB", "#6B7280", 1, 2)
        c.texto(372, y + 4, pin_placa, 12.5, True, "#1F4E79", "end")
        c.rect(606, y - 6, 14, 12, "#D1D5DB", "#6B7280", 1, 2)
        c.texto(628, y + 4, pin_zumb, 12.5, True, TINTA)
        c.linea([(394, y), (606, y)], color, 3)
        c.etiqueta(500, y - 6, txt, 11.5)

    c.rect(195, 390, 70, 22, "#6B7280", "#4B5563", 1, 3)
    c.texto(230, 405, "USB", 11, True, "#FFFFFF", "middle")
    c.linea([(230, 412), (230, 470)], "#6B7280", 2.5, guiones=True)
    c.etiqueta(240, 446, "cable USB (CP2102, /dev/ttyUSB0)", ancla="start")
    c.caja(110, 470, 240, 62, "PC del profesor", ["instala el firmware y ve el log"], tam_t=14, tam_l=12)

    c.rect(450, 410, 500, 122, "#FFFFFF", "#CBD5E1", 1.2, 10)
    for i, s in enumerate(
        [
            "El zumbador suena con PWM: la frecuencia es la nota y el ciclo",
            "de trabajo, 50 % (el volumen más alto de un zumbador pasivo).",
            "Tiene una sola voz: un acorde llega como su frecuencia resultante.",
            "Pitidos: C6-E6-G6 arranca, G6-C7 conectada, C7-G6 sin conexión.",
            "El LED queda encendido mientras la placa está conectada al PC.",
        ]
    ):
        c.texto(468, 436 + i * 20, s, 12, color="#374151")
    return c


# ---- 4. Una nota, de la tecla al zumbador --------------------------------------------------------
def secuencia() -> Lienzo:
    c = Lienzo(1200, 690)
    vidas = [
        (118, "Móvil del profesor", "navegador"),
        (320, "PC: aplicación fog", "clase y cola"),
        (540, "Mosquitto", "broker MQTT"),
        (740, "Placa ESP32", "zumbador"),
        (930, "Móviles de alumnos", "en el aula"),
        (1110, "Ably", "alumnos en casa"),
    ]
    for x, t, s in vidas:
        c.caja(
            x - 85,
            24,
            170,
            56,
            t,
            [s],
            centrar=True,
            tam_t=13.5,
            tam_l=11.5,
            fondo=NARANJA[0] if "Placa" in t else "#FFFFFF",
            borde=NARANJA[1] if "Placa" in t else LINEA,
        )
        c.linea([(x, 80), (x, 670)], "#94A3B8", 1.4, guiones=True)

    def paso(n, x, y):
        c.partes.append(f'<circle cx="{x}" cy="{y}" r="11" fill="{LINEA}"/>')
        c.texto(x, y + 4.5, str(n), 12, True, "#FFFFFF", "middle")

    def nota(n, x, y, lineas, w=200):
        h = 16 + len(lineas) * 17
        c.rect(x - w / 2, y - h / 2, w, h, NOTA[0], NOTA[1], 1.2, 6)
        for i, s in enumerate(lineas):
            c.texto(x + 8, y - h / 2 + 22 + i * 17, s, 12, False, TINTA, "middle")
        paso(n, x - w / 2 + 2, y - h / 2 + 2)

    def mensaje(n, x1, x2, y, lineas, mono=True):
        lineas = [lineas] if isinstance(lineas, str) else lineas
        c.flecha([(x1, y), (x2 - 2, y)])
        c.etiqueta((x1 + x2) / 2 + 12, y - 17 - 15 * (len(lineas) - 1), lineas, 11.5, mono=mono)
        paso(n, x1 + 18, y)

    nota(1, 118, 125, ["pulsa una tecla (Do5):", "suena en el móvil"], 190)
    mensaje(2, 118, 320, 205, ['{"t": "note",', ' "freq": 523, "midi": [72]}'])
    nota(3, 320, 262, ["cola del zumbador:", "lo tiene el profesor"], 190)
    mensaje(4, 320, 540, 345, ["piano/piano1/tone", "0B 02 (523 Hz)"])
    mensaje(5, 540, 740, 405, "entrega (TLS)", mono=False)
    nota(6, 740, 460, ["PWM a 523 Hz, 50 %:", "suena el zumbador"], 190)
    mensaje(7, 320, 930, 540, ['{"t": "teacher.note", "freq": 523, "midi": [72]}'])
    nota(8, 930, 592, ["marca la tecla", "en ámbar"], 160)
    mensaje(9, 320, 1110, 650, "a la vez, al puente Ably: note en el canal class:<profesor>", mono=False)
    return c


# ---- 5. Actualizaciones automáticas --------------------------------------------------------------
def actualizaciones() -> Lienzo:
    c = Lienzo(1200, 730)
    c.texto(370, 26, "PC DEL PROFESOR · fog/updater.py", 13, True, "#6B7280", "middle")
    c.texto(880, 26, "PLACA ESP32 · esp32/ota.py, main.py", 13, True, "#6B7280", "middle")

    def paso(cx, y, lineas, h=58, w=360, fondo="#FFFFFF", borde=LINEA):
        c.rect(cx - w / 2, y, w, h, fondo, borde, 1.5, 10)
        y0 = y + h / 2 - (len(lineas) - 1) * 9 + 4.5
        for i, s in enumerate(lineas):
            c.texto(cx, y0 + i * 18, s, 12.5, i == 0 and len(lineas) == 1, TINTA, "middle")

    def salida(x, y, lineas, w=150):
        h = 14 + len(lineas) * 17
        c.rect(x, y - h / 2, w, h, "#F3F4F6", "#9CA3AF", 1.2, 8)
        for i, s in enumerate(lineas):
            c.texto(x + w / 2, y - h / 2 + 21 + i * 17, s, 12, False, SUAVE, "middle")

    pc, pl = 370, 880
    c.rect(pc - 150, 40, 300, 46, "#E0F2FE", "#0284C7", 1.5, 23)
    c.texto(pc, 68, "Cada hora, si hay internet", 13, True, TINTA, "middle")
    c.flecha([(pc, 86), (pc, 116)])
    paso(pc, 118, ["git fetch: ¿hay un commit nuevo en", "origin/main y el checkout está limpio?"])
    c.flecha([(pc, 176), (pc, 204)])
    c.flecha([(pc - 180, 147), (172, 147)])
    salida(20, 147, ["no: nada que", "hacer"])
    paso(pc, 206, ["lo prueba en un worktree aparte:", "pytest, npm ci, Vitest y next build"])
    c.flecha([(pc, 264), (pc, 282)])
    c.rombo(pc, 320, 180, 76, "¿pasan todos?")
    c.flecha([(pc - 90, 320), (172, 320)])
    salida(20, 320, ["no: sigue la", "versión actual"])
    c.flecha([(pc, 358), (pc, 398)])
    c.etiqueta(pc + 10, 383, "sí", ancla="start")
    paso(pc, 400, ["avanza el checkout, uv sync, pone la", "web nueva y reinicia el servicio"])
    c.flecha([(pc, 458), (pc, 476)])
    c.rombo(pc, 514, 200, 76, "¿cambió el firmware?")
    c.flecha([(pc - 100, 514), (172, 514)])
    salida(20, 514, ["no: fin"])
    c.flecha([(pc, 552), (pc, 592)])
    c.etiqueta(pc + 10, 577, "sí", ancla="start")
    paso(pc, 594, ["publica por MQTT piano/<id>/ota", '{"sha": …, "url": "https://<PC>/board/<sha>"}'])
    c.flecha([(pc + 180, 623), (625, 623), (625, 69), (pl - 182, 69)])

    paso(
        pl,
        40,
        ["guarda la petición y reinicia en modo", "actualización (solo ota.py en memoria)"],
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    c.flecha([(pl, 98), (pl, 126)])
    paso(
        pl,
        128,
        ["baja manifest.json y los ficheros que", "cambian, por HTTPS; comprueba el hash", "git de cada uno"],
        h=74,
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    c.flecha([(pl, 202), (pl, 230)])
    paso(
        pl,
        232,
        ["ejecuta los tests de la placa", "sobre el código nuevo (/next)"],
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    c.flecha([(pl, 290), (pl, 308)])
    c.rombo(pl, 346, 160, 76, "¿pasan?")
    c.flecha([(pl + 80, 346), (1048, 346)])
    salida(1050, 346, ["no: sigue la", "versión anterior"], 140)
    c.flecha([(pl, 384), (pl, 424)])
    c.etiqueta(pl + 10, 409, "sí", ancla="start")
    paso(
        pl,
        426,
        ["instala (la anterior pasa a /prev)", "y reinicia con la nueva"],
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    c.flecha([(pl, 484), (pl, 502)])
    c.rombo(pl, 540, 210, 76, "¿conecta con el PC?")
    c.flecha([(pl + 105, 540), (1048, 540)])
    salida(1050, 540, ["3 fallos: vuelve", "a la de /prev"], 140)
    c.flecha([(pl, 578), (pl, 618)])
    c.etiqueta(pl + 10, 603, "sí", ancla="start")
    paso(
        pl,
        620,
        ["versión confirmada (mark_good)", "y lo cuenta en piano/<id>/log"],
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    return c


# ---- 6. Los datos y la clave del sistema ---------------------------------------------------------
def datos() -> Lienzo:
    c = Lienzo(1200, 520)

    def caja(x, y, w, h, titulo, lineas, clave=False, fondo="#FFFFFF", borde=LINEA):
        """Título arriba, la marca de la clave del sistema debajo (si la tiene) y el texto."""
        c.rect(x, y, w, h, fondo, borde, 1.5, 10)
        c.texto(x + 16, y + 32, titulo, 15, True)
        y0 = y + 58
        if clave:
            c.rect(x + 16, y + 44, 150, 24, "#FEF3C7", ORO, 1.2, 12)
            c.texto(x + 91, y + 60.5, "clave del sistema", 11.5, True, ORO, "middle")
            y0 = y + 92
        for i, s in enumerate(lineas):
            c.texto(x + 16, y0 + i * 19, s, 12.5, color=SUAVE)

    caja(
        40,
        70,
        260,
        150,
        "Navegador",
        [
            "La contraseña no sale del móvil:",
            "envía PBKDF2-SHA256 de ella.",
            "Guarda un token de sesión",
            "firmado (30 días).",
        ],
    )
    caja(
        400,
        70,
        340,
        150,
        "PC del profesor",
        [
            "Sella cada registro con AES-256-GCM",
            "(la clave del registro va como dato",
            "asociado). Nombres: hash con clave.",
        ],
        clave=True,
    )
    caja(
        400,
        350,
        340,
        125,
        "Placa ESP32",
        [
            "Guarda solo blobs sellados en su flash",
            "(btree /piano.db). Sin la clave,",
            "no puede leer cuentas ni melodías.",
        ],
        fondo=NARANJA[0],
        borde=NARANJA[1],
    )
    caja(
        850,
        350,
        310,
        125,
        "MongoDB Atlas",
        [
            "Blobs sellados. En claro solo lo que",
            "piden las consultas: ids, dueño (hash),",
            "público, fecha y si se borró.",
        ],
    )
    caja(
        850,
        70,
        310,
        150,
        "Vercel",
        ["La misma clave que los PC:", "abre los registros de Atlas", "y firma los tokens de sesión."],
        clave=True,
    )

    c.flecha([(300, 155), (398, 155)], doble=True)
    c.etiqueta(349, 140, ["HTTPS", "en el aula"])
    c.flecha([(170, 70), (170, 36), (1005, 36), (1005, 68)])
    c.etiqueta(588, 41, "en casa: HTTPS a Vercel")
    c.flecha([(570, 220), (570, 348)], doble=True)
    c.etiqueta(580, 290, "MQTT/TLS: solo blobs sellados", ancla="start")
    c.flecha([(740, 190), (800, 190), (800, 412), (848, 412)], doble=True)
    c.etiqueta(800, 300, ["sync", "(TLS)"])
    c.flecha([(1005, 220), (1005, 348)], doble=True)
    c.etiqueta(1015, 290, "TLS", ancla="start")
    c.texto(
        40,
        505,
        "Las sesiones las comprueba cualquier servidor con la clave: no hay tabla de sesiones.",
        12,
        color=SUAVE,
    )
    return c


DIAGRAMAS = {
    "1-arquitectura": arquitectura,
    "2-modulos": modulos,
    "3-hardware": hardware,
    "4-una-nota": secuencia,
    "5-actualizaciones": actualizaciones,
    "6-datos": datos,
}


def main() -> None:
    rsvg = shutil.which("rsvg-convert")
    for nombre, dibujo in DIAGRAMAS.items():
        svg = AQUI / f"{nombre}.svg"
        svg.write_text(dibujo().svg(), encoding="utf-8")
        if rsvg:
            subprocess.run([rsvg, "-z", "2", "-o", str(AQUI / f"{nombre}.png"), str(svg)], check=True)
        print(nombre)


if __name__ == "__main__":
    main()
