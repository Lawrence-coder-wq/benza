# Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
"""Scarica i prezzi dei carburanti pubblicati ogni mattina dal Ministero delle Imprese e del Made in Italy
e li prepara per la pagina: un file piccolo per provincia, l'elenco dei comuni e un indice.

Dati: "Prezzi alle 8 di mattina" e "Anagrafica degli impianti attivi" (MIMIT, licenza IODL 2.0).
Solo libreria standard.  Uso: python strumenti/aggiorna.py
"""
import csv
import io
import json
import math
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATI = os.path.join(QUI, "dati")
PREZZI = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"
IMPIANTI = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
GIORNI_VALIDI = 10          # un prezzo comunicato da piu' di dieci giorni non si mostra: potrebbe non essere piu' vero

# i nomi commerciali sono centinaia: si riportano ai quattro carburanti che la gente cerca
def categoria(nome):
    n = nome.lower()
    if "gpl" in n:
        return "gpl"
    if "metano" in n or "gnc" in n or "cng" in n:
        return "gnl" if "gnl" in n and "l-gnc" not in n else "metano"
    if "gnl" in n or "lng" in n:
        return "gnl"
    if "benzin" in n or "super" in n or n.startswith("sp ") or "98" in n or "100 ottani" in n or "f101" in n:
        return "benzina"
    if any(x in n for x in ("gasolio", "diesel", "hvo", "blu diesel", "supreme", "excellium", "hi-q", "hiq", "e-diesel", "dieselmax", "gasoil")):
        return "gasolio"
    return None


def speciale(nome):
    """I carburanti 'premium' costano di piu': si tengono fuori dal confronto col prodotto normale."""
    n = nome.lower().strip()
    return n not in ("benzina", "gasolio", "gpl", "metano", "gnl", "l-gnc")


def scarica(url):
    rich = urllib.request.Request(url, headers={"User-Agent": "benza (github.com/Lawrence-coder-wq/benza)"})
    with urllib.request.urlopen(rich, timeout=120) as r:
        return r.read().decode("utf-8", "replace")


def righe(testo):
    corpo = testo.split("\n", 1)      # la prima riga e' "Estrazione del AAAA-MM-GG"
    estratto = corpo[0].replace("Estrazione del", "").strip()
    return estratto, csv.reader(io.StringIO(corpo[1]), delimiter="|", quoting=csv.QUOTE_NONE)


def pulito(s):
    return " ".join((s or "").replace("\t", " ").split()).strip()


def km(lat1, lon1, lat2, lon2):
    r = math.pi / 180
    x = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def indice_benza(per_provincia, medie, giorno):
    """L'indice Benza: quanto costa in media il self in ogni provincia rispetto all'Italia, e come cambia nel tempo.
    La media e' quella dei distributori (non pesata sui litri venduti, che nessuno pubblica). Lo storico cresce di un giorno alla volta."""
    from province import NOMI
    oggi = {}
    for prov, elenco in per_provincia.items():
        riga = {}
        for cat in ("benzina", "gasolio"):
            valori = sorted(e[7][cat]["s"][0] for e in elenco if cat in e[7] and "s" in e[7][cat])
            if len(valori) >= 5:                                    # con meno di cinque distributori la media non dice niente
                riga[cat] = round(sum(valori) / len(valori), 3)
        if riga:
            oggi[prov] = riga
    percorso = os.path.join(DATI, "indice-storico.json")
    try:
        storico = json.load(open(percorso, encoding="utf-8"))
    except (OSError, ValueError):
        storico = {}
    storico[giorno] = {"italia": {c: medie[c] for c in ("benzina", "gasolio") if c in medie}, "province": oggi}
    for vecchio in sorted(storico)[:-400]:                          # si tiene poco piu' di un anno
        del storico[vecchio]
    json.dump(storico, open(percorso, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"giorno": giorno, "italia": storico[giorno]["italia"], "nomi": {p: NOMI.get(p, p) for p in oggi}, "province": oggi,
               "giorni": sorted(storico)}, open(os.path.join(DATI, "indice-benza.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def main():
    os.makedirs(os.path.join(DATI, "province"), exist_ok=True)
    estratto, lettore = righe(scarica(IMPIANTI))
    next(lettore)
    impianti = {}
    for r in lettore:
        if len(r) < 10:
            continue
        try:
            lat, lon = float(r[8]), float(r[9])
        except ValueError:
            continue
        if not (35.0 < lat < 47.5 and 6.0 < lon < 19.0):        # coordinate mancanti, a zero o scambiate
            continue
        impianti[r[0]] = {"lat": round(lat, 5), "lon": round(lon, 5), "gestore": pulito(r[1]), "bandiera": pulito(r[2]), "nome": pulito(r[4]),
                          "indirizzo": pulito(r[5]), "comune": pulito(r[6]).title(), "prov": pulito(r[7]).upper(), "prezzi": {}}

    estratto_prezzi, lettore = righe(scarica(PREZZI))
    next(lettore)
    oggi = datetime.strptime(estratto_prezzi, "%Y-%m-%d")
    limite = oggi - timedelta(days=GIORNI_VALIDI)
    scartati = 0
    for r in lettore:
        if len(r) < 5 or r[0] not in impianti:
            continue
        cat = categoria(r[1])
        if not cat or speciale(r[1]):
            continue
        try:
            prezzo = float(r[2])
            quando = datetime.strptime(r[4].strip(), "%d/%m/%Y %H:%M:%S")
        except ValueError:
            continue
        if quando < limite or not (0.3 < prezzo < 5):
            scartati += 1
            continue
        modo = "s" if r[3].strip() == "1" else "a"              # s = self, a = servito (con addetto)
        voce = impianti[r[0]]["prezzi"].setdefault(cat, {})
        if modo not in voce or prezzo < voce[modo][0]:
            voce[modo] = [prezzo, quando.strftime("%d/%m")]

    # alcune coordinate del Ministero sono sbagliate di cento chilometri: un impianto troppo lontano dal centro
    # della sua provincia (mediana degli impianti) non si pubblica, perche' comparirebbe "vicino" a chi non lo e'
    centri = {}
    for prov in {i["prov"] for i in impianti.values()}:
        pt = [(i["lat"], i["lon"]) for i in impianti.values() if i["prov"] == prov]
        centri[prov] = (sorted(x[0] for x in pt)[len(pt) // 2], sorted(x[1] for x in pt)[len(pt) // 2])
    fuori_posto = [k for k, i in impianti.items() if km(i["lat"], i["lon"], *centri[i["prov"]]) > 95]
    for k in fuori_posto:
        del impianti[k]
    print("Impianti con coordinate fuori dalla loro provincia, scartati:", len(fuori_posto))

    per_provincia = defaultdict(list)
    per_comune = defaultdict(list)
    for ida, i in impianti.items():
        if not i["prezzi"] or len(i["prov"]) != 2:
            continue
        per_provincia[i["prov"]].append([int(ida), i["lat"], i["lon"], i["bandiera"], i["nome"], i["indirizzo"], i["comune"], i["prezzi"]])
        per_comune[(i["comune"], i["prov"])].append((i["lat"], i["lon"]))

    indice = []
    for prov, elenco in sorted(per_provincia.items()):
        json.dump({"agg": estratto_prezzi, "impianti": elenco}, open(os.path.join(DATI, "province", prov + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        lat = sum(e[1] for e in elenco) / len(elenco)
        lon = sum(e[2] for e in elenco) / len(elenco)
        raggio = max(((e[1] - lat) ** 2 + ((e[2] - lon) * 0.74) ** 2) ** 0.5 for e in elenco) * 111      # km dal centro all'impianto piu' lontano
        indice.append([prov, round(lat, 4), round(lon, 4), round(raggio, 1), len(elenco)])
    comuni = [[c, p, round(sum(x[0] for x in pt) / len(pt), 4), round(sum(x[1] for x in pt) / len(pt), 4)] for (c, p), pt in sorted(per_comune.items()) if c]

    medie = {}
    for cat in ("benzina", "gasolio", "gpl", "metano"):
        valori = [e[7][cat]["s"][0] for el in per_provincia.values() for e in el if cat in e[7] and "s" in e[7][cat]]
        if valori:
            medie[cat] = round(sum(valori) / len(valori), 3)
    json.dump({"agg": estratto_prezzi, "province": indice, "medie_self": medie, "impianti": sum(len(v) for v in per_provincia.values())},
              open(os.path.join(DATI, "indice.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    indice_benza(per_provincia, medie, estratto_prezzi)
    json.dump(comuni, open(os.path.join(DATI, "comuni.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    peso = sum(os.path.getsize(os.path.join(r, f)) for r, _, ff in os.walk(DATI) for f in ff) / 1e6
    print("Prezzi del %s: %d impianti con prezzi validi in %d province, %d comuni, %d prezzi vecchi scartati, %.1f MB in tutto" % (
        estratto_prezzi, sum(len(v) for v in per_provincia.values()), len(per_provincia), len(comuni), scartati, peso))
    print("Medie self:", medie)
    if len(per_provincia) < 100:
        sys.exit("Troppe poche province: il file del Ministero sembra incompleto, non pubblico nulla.")


if __name__ == "__main__":
    main()
