# Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
"""Disegna le icone dell'app (pompa gialla su fondo asfalto) nelle misure che servono al telefono.
Richiede Pillow. Uso: python strumenti/icone.py"""
import os
from PIL import Image, ImageDraw

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USCITA = os.path.join(QUI, "icone")
GIALLO = (255, 210, 31, 255)
ASFALTO = (20, 23, 27, 255)


def pompa(lato, pieno, scala):
    """pieno=True: fondo fino ai bordi (icona 'maskable', il telefono la ritaglia a cerchio o a goccia)."""
    L = 1024
    img = Image.new("RGBA", (L, L), ASFALTO if pieno else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not pieno:
        d.rounded_rectangle([0, 0, L, L], radius=220, fill=ASFALTO)
    s = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    p = ImageDraw.Draw(s)
    p.rounded_rectangle([250, 210, 610, 800], radius=60, outline=GIALLO, width=56)
    p.rounded_rectangle([330, 300, 530, 470], radius=24, fill=GIALLO)
    p.line([200, 810, 660, 810], fill=GIALLO, width=56)
    p.line([610, 430, 730, 530], fill=GIALLO, width=50)
    p.line([730, 520, 730, 700], fill=GIALLO, width=50)
    p.arc([690, 640, 830, 780], start=0, end=180, fill=GIALLO, width=50)
    p.line([806, 710, 806, 400], fill=GIALLO, width=50)
    p.line([806, 410, 720, 320], fill=GIALLO, width=50)
    lato_segno = int(L * scala)
    s = s.resize((lato_segno, lato_segno), Image.LANCZOS)
    img.alpha_composite(s, ((L - lato_segno) // 2, (L - lato_segno) // 2))
    return img.resize((lato, lato), Image.LANCZOS)


os.makedirs(USCITA, exist_ok=True)
pompa(192, False, 0.86).save(os.path.join(USCITA, "icona-192.png"))
pompa(512, False, 0.86).save(os.path.join(USCITA, "icona-512.png"))
pompa(512, True, 0.62).save(os.path.join(USCITA, "icona-ritagliabile-512.png"))
pompa(180, True, 0.72).convert("RGB").save(os.path.join(USCITA, "icona-apple-180.png"))
print("icone create in", USCITA)
