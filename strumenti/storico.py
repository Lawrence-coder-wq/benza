# Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
"""Legge gli archivi trimestrali dei prezzi (MIMIT, un file al giorno dal 2015) e ricava per ogni distributore
come si comporta di solito: quanto sta sopra o sotto la media della sua provincia, se rincara nel fine settimana,
ogni quanto aggiorna il prezzo e quante volte ne ha comunicato uno palesemente sbagliato.

Il confronto e' sempre con la media della provincia NELLO STESSO GIORNO: cosi' il giudizio regge anche quando
tutti i prezzi salgono o scendono insieme. Si guardano benzina e gasolio normali, in self.

Uso:  python strumenti/storico.py archivio1.tar.gz [archivio2.tar.gz ...]      (solo libreria standard)
Esce: dati/storico/<PROVINCIA>.json   { idImpianto: { "b": [...], "g": [...] } }  con, per carburante:
      [scarto medio in centesimi, rincaro nel fine settimana in centesimi, giorni tra un aggiornamento e l'altro,
       % di giorni con prezzo fermo da oltre una settimana, % di giorni con prezzo anomalo, giorni osservati]
"""
import csv
import io
import json
import os
import sys
import tarfile
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from aggiorna import IMPIANTI, scarica, righe, pulito          # stessa anagrafica e stesse regole dell'aggiornamento quotidiano

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USCITA = os.path.join(QUI, "dati", "storico")
CARBURANTI = {"benzina": "b", "gasolio": "g"}
ANOMALO = 0.25            # euro di distanza dalla media della provincia oltre i quali il prezzo e' quasi certamente un errore di battitura
FERMO = 7                 # giorni senza aggiornare oltre i quali il prezzo comunicato vale poco
MINIMO_GIORNI = 20        # sotto questa soglia di osservazioni non si dice niente del distributore


def giorni_di(archivio):
    """Restituisce (data, righe del csv) per ogni file giornaliero dentro l'archivio."""
    with tarfile.open(archivio, "r:gz") as tar:
        for membro in tar:
            nome = os.path.basename(membro.name)
            if not (membro.isfile() and nome.startswith("prezzo_alle_8-") and nome.endswith(".csv")):
                continue
            giorno = datetime.strptime(nome[14:22], "%Y%m%d")
            testo = tar.extractfile(membro).read().decode("utf-8", "replace")
            corpo = testo.split("\n", 1)[1] if testo.startswith("Estrazione") else testo
            yield giorno, csv.reader(io.StringIO(corpo), delimiter="|", quoting=csv.QUOTE_NONE)


def main(archivi):
    _, lettore = righe(scarica(IMPIANTI))
    next(lettore)
    provincia = {r[0]: pulito(r[7]).upper() for r in lettore if len(r) >= 10}

    # per ogni impianto e carburante: [somma scarti, n, somma scarti feriali, n feriali, somma scarti fine settimana, n fine settimana,
    #                                  giorni col prezzo fermo, giorni anomali] + l'insieme delle date in cui ha aggiornato
    conti = defaultdict(lambda: [0.0, 0, 0.0, 0, 0.0, 0, 0, 0])
    aggiornamenti = defaultdict(set)
    quanti_giorni = 0
    for archivio in archivi:
        for giorno, lettore in giorni_di(archivio):
            quanti_giorni += 1
            del_giorno = {}                                   # (impianto, carburante) -> (prezzo, data di comunicazione)
            for r in lettore:
                if len(r) < 5 or r[3].strip() != "1":
                    continue
                cat = CARBURANTI.get(r[1].strip().lower())
                if not cat or r[0] not in provincia:
                    continue
                try:
                    prezzo = float(r[2])
                    comunicato = datetime.strptime(r[4].strip()[:10], "%d/%m/%Y")
                except ValueError:
                    continue
                if not (0.5 < prezzo < 4):
                    continue
                chiave = (r[0], cat)
                if chiave not in del_giorno or prezzo < del_giorno[chiave][0]:
                    del_giorno[chiave] = (prezzo, comunicato)
            somme = defaultdict(lambda: [0.0, 0])             # (provincia, carburante) -> media del giorno, solo prezzi freschi
            for (ida, cat), (prezzo, comunicato) in del_giorno.items():
                if (giorno - comunicato).days <= FERMO:
                    s = somme[(provincia[ida], cat)]
                    s[0] += prezzo
                    s[1] += 1
            fine_settimana = giorno.weekday() >= 5
            for (ida, cat), (prezzo, comunicato) in del_giorno.items():
                s = somme.get((provincia[ida], cat))
                if not s or s[1] < 5:
                    continue
                scarto = prezzo - s[0] / s[1]
                c = conti[(ida, cat)]
                aggiornamenti[(ida, cat)].add(comunicato)
                if (giorno - comunicato).days > FERMO:
                    c[6] += 1
                if abs(scarto) > ANOMALO:
                    c[7] += 1
                    continue                                   # un prezzo sbagliato non entra nella media del distributore
                c[0] += scarto
                c[1] += 1
                k = 4 if fine_settimana else 2
                c[k] += scarto
                c[k + 1] += 1
        print("letto", os.path.basename(archivio), "·", quanti_giorni, "giorni finora", flush=True)

    per_provincia = defaultdict(dict)
    for (ida, cat), c in conti.items():
        osservati = c[1] + c[7]
        if c[1] < MINIMO_GIORNI:
            continue
        rincaro = (c[4] / c[5] - c[2] / c[3]) * 100 if c[3] >= 10 and c[5] >= 6 else 0.0
        ogni = osservati / max(1, len(aggiornamenti[(ida, cat)]))
        per_provincia[provincia[ida]].setdefault(ida, {})[cat] = [round(c[0] / c[1] * 100, 1), round(rincaro, 1), round(ogni, 1),
                                                                  round(c[6] / osservati * 100), round(c[7] / osservati * 100), osservati]
    os.makedirs(USCITA, exist_ok=True)
    for prov, impianti in per_provincia.items():
        if len(prov) == 2:
            json.dump({"giorni": quanti_giorni, "impianti": impianti}, open(os.path.join(USCITA, prov + ".json"), "w", encoding="utf-8"), separators=(",", ":"))
    peso = sum(os.path.getsize(os.path.join(USCITA, f)) for f in os.listdir(USCITA)) / 1e6
    print("Storico: %d giorni, %d distributori in %d province, %.1f MB" % (quanti_giorni, sum(len(v) for v in per_provincia.values()), len(per_provincia), peso))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
