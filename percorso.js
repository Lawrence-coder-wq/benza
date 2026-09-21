/* Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
   Lungo la strada: i distributori vicini al percorso e quanto resta in tasca se si devia per quello meno caro.
   La strada e i tempi arrivano da OSRM (servizio pubblico su OpenStreetMap); i prezzi sono i file statici di Benza. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NOMI = { benzina: "benzina", gasolio: "gasolio", gpl: "GPL", metano: "metano" };
  const OSRM = "https://router.project-osrm.org";
  const CORRIDOIO = 5;          // km dalla strada entro cui si guardano i distributori
  const SULLA_STRADA = 0.35;    // km dalla linea: chi sta piu' lontano non puo' essere "sulla strada"
  const DEVIAZIONE_NULLA = 0.6; // km misurati: sotto questa soglia passarci non e' una deviazione
  const CANDIDATI = 18;         // quanti distributori si fanno misurare davvero a OSRM
  const euro = n => n.toFixed(2).replace(".", ",") + " €";
  const prezzoTxt = p => p.toFixed(3).replace(".", ",");

  const stato = { carburante: "benzina", modo: "s", da: null, a: null };
  try { const s = JSON.parse(localStorage.getItem("dcm") || "{}"); if (s.carburante) stato.carburante = s.carburante; if (s.modo) stato.modo = s.modo; } catch {}
  try { const v = JSON.parse(localStorage.getItem("dcm-viaggio") || "{}"); if (v.litri) $("#litri").value = v.litri; if (v.resa) $("#resa").value = v.resa; } catch {}
  let indice = null, comuni = null;
  const province = new Map();

  // ---------------------------------------------------------------- geometria
  const RAD = Math.PI / 180;
  const distanza = (a, b, c, d) => {        // km tra due punti
    const x = Math.sin((c - a) * RAD / 2) ** 2 + Math.cos(a * RAD) * Math.cos(c * RAD) * Math.sin((d - b) * RAD / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };
  // La strada diventa una spezzata in chilometri su un piano locale: basta e avanza per dire "a quanti km dalla strada".
  function spezzata(punti) {                 // punti = [[lon, lat], ...] come li da' OSRM
    const lat0 = punti[Math.floor(punti.length / 2)][1], kx = 111.32 * Math.cos(lat0 * RAD), ky = 110.57;
    const piano = [[punti[0][0] * kx, punti[0][1] * ky]], lungo = [0];
    for (let i = 1; i < punti.length; i++) {
      const p = [punti[i][0] * kx, punti[i][1] * ky], u = piano[piano.length - 1], d = Math.hypot(p[0] - u[0], p[1] - u[1]);
      if (d < 0.15 && i < punti.length - 1) continue;          // un punto ogni 150 metri e' piu' che sufficiente
      piano.push(p); lungo.push(lungo[lungo.length - 1] + d);
    }
    const xs = piano.map(p => p[0]), ys = piano.map(p => p[1]);
    return { piano, lungo, kx, ky, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  function dallaStrada(s, lat, lon) {        // -> [km dalla strada, km dall'inizio del viaggio]
    const x = lon * s.kx, y = lat * s.ky;
    if (x < s.minX - CORRIDOIO || x > s.maxX + CORRIDOIO || y < s.minY - CORRIDOIO || y > s.maxY + CORRIDOIO) return [Infinity, 0];
    let meglio = Infinity, dove = 0;
    for (let i = 1; i < s.piano.length; i++) {
      const [ax, ay] = s.piano[i - 1], [bx, by] = s.piano[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < meglio) { meglio = d; dove = s.lungo[i - 1] + t * Math.sqrt(l2); }
    }
    return [meglio, dove];
  }

  // ---------------------------------------------------------------- mappa
  let mappa = null, strato = null;
  function preparaMappa() {
    if (mappa) { strato.clearLayers(); return; }
    mappa = L.map("mappa", { zoomControl: true }).setView([42.2, 12.6], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mappa);
    strato = L.layerGroup().addTo(mappa);
  }

  // ---------------------------------------------------------------- il conto
  async function calcola() {
    const dice = t => { $("#stato").textContent = t; };
    // chi scrive il comune per intero e non tocca l'elenco va capito lo stesso
    if (!stato.da) stato.da = await indovina($("#da"));
    if (!stato.a) stato.a = await indovina($("#a"));
    if (!stato.da || !stato.a) { dice(`Non ho capito ${!stato.da ? "da dove parti" : "dove arrivi"}: scrivi il comune e sceglilo dall'elenco che compare.`); return; }
    const litri = Math.max(5, +String($("#litri").value).replace(",", ".") || 40), resa = Math.max(4, +String($("#resa").value).replace(",", ".") || 15);
    try { localStorage.setItem("dcm-viaggio", JSON.stringify({ litri, resa })); localStorage.setItem("dcm", JSON.stringify({ ...JSON.parse(localStorage.getItem("dcm") || "{}"), carburante: stato.carburante, modo: stato.modo })); } catch {}
    const modo = stato.modo === "s" ? "self" : "servito", unita = stato.carburante === "metano" ? "kg" : "litri";
    $("#risultati").hidden = true;
    dice("Chiedo la strada…");

    let strada;
    try {
      const r = await fetch(`${OSRM}/route/v1/driving/${stato.da.lon},${stato.da.lat};${stato.a.lon},${stato.a.lat}?overview=full&geometries=geojson`).then(x => x.json());
      if (r.code !== "Ok" || !r.routes.length) throw 0;
      strada = r.routes[0];
    } catch { dice("Non riesco a farmi dare la strada (il servizio dei percorsi non risponde o non trova un collegamento). Riprova tra poco."); return; }
    const km = strada.distance / 1000, s = spezzata(strada.geometry.coordinates);

    dice("Guardo i distributori lungo la strada…");
    // le province toccate: quelle il cui centro sta entro il loro raggio (+ corridoio) da un punto della strada, preso ogni 4 km circa
    const campioni = []; let prossimo = 0;
    s.piano.forEach((p, i) => { if (s.lungo[i] >= prossimo) { campioni.push([p[1] / s.ky, p[0] / s.kx]); prossimo = s.lungo[i] + 4; } });
    campioni.push([stato.a.lat, stato.a.lon]);
    const servono = indice.province.filter(([, lat, lon, raggio]) => campioni.some(c => distanza(c[0], c[1], lat, lon) <= raggio + CORRIDOIO + 3)).map(p => p[0]);
    try { await Promise.all(servono.filter(x => !province.has(x)).map(async x => province.set(x, (await (await fetch(`dati/province/${x}.json`)).json()).impianti))); }
    catch { dice("Non riesco a scaricare i prezzi. Controlla la connessione e riprova."); return; }

    const vicini = [];
    for (const sigla of servono) for (const i of province.get(sigla)) {
      const p = i[7][stato.carburante]; if (!p || !p[stato.modo]) continue;
      const [fuori, lungo] = dallaStrada(s, i[1], i[2]); if (fuori > CORRIDOIO) continue;
      vicini.push({ id: i[0], lat: i[1], lon: i[2], bandiera: i[3], nome: i[4], indirizzo: i[5], comune: i[6], prezzo: p[stato.modo][0], del: p[stato.modo][1], fuori, lungo });
    }
    if (!vicini.length) { dice(`Lungo questa strada non trovo distributori con ${NOMI[stato.carburante]} ${modo}.${stato.modo === "s" ? " Prova «Servito»." : ""}`); return; }

    // Quanto costa DAVVERO passare da un distributore: si chiede a OSRM partenza -> distributore -> arrivo e si toglie il viaggio diretto.
    // La distanza in linea d'aria dalla strada non basta: in autostrada un distributore a 200 metri puo' voler dire uscire e rientrare.
    async function misura(lista) {
      if (!lista.length) return;
      try {
        const punti = [stato.da, ...lista, stato.a].map(q => `${q.lon},${q.lat}`).join(";"), n = lista.length;
        const sorgenti = [...Array(n + 1).keys()].join(";"), mete = [...Array(n + 1).keys()].map(k => k + 1).join(";");
        const t = await fetch(`${OSRM}/table/v1/driving/${punti}?sources=${sorgenti}&destinations=${mete}&annotations=distance,duration`).then(x => x.json());
        if (t.code !== "Ok") throw 0;
        lista.forEach((c, k) => {
          c.kmInPiu = Math.max(0, (t.distances[0][k] + t.distances[k + 1][n]) / 1000 - km);
          c.minInPiu = Math.max(0, (t.durations[0][k] + t.durations[k + 1][n] - strada.duration) / 60);
        });
      } catch {
        lista.forEach(c => { c.kmInPiu = 2 * c.fuori * 1.4; c.minInPiu = c.kmInPiu * 1.5; c.stimato = true; });
      }
    }

    // il termine di paragone: il meno caro che si incontra SENZA uscire dalla strada (deviazione misurata sotto i 600 metri)
    dice("Guardo chi sta davvero sulla strada…");
    const rasenti = vicini.filter(v => v.fuori <= SULLA_STRADA);
    const primoGiro = [...rasenti].sort((a, b) => a.prezzo - b.prezzo).slice(0, 45);
    await misura(primoGiro);
    // le aree di servizio sono le piu' care e le piu' attaccate alla carreggiata: se i 45 meno cari non bastano, si guardano i piu' vicini alla linea
    if (!primoGiro.some(v => v.kmInPiu <= DEVIAZIONE_NULLA)) await misura(rasenti.filter(v => v.kmInPiu === undefined).sort((a, b) => a.fuori - b.fuori).slice(0, 45));
    const sullaStrada = rasenti.filter(v => v.kmInPiu !== undefined && v.kmInPiu <= DEVIAZIONE_NULLA).sort((a, b) => a.prezzo - b.prezzo);
    const ordinati = [...vicini].sort((a, b) => a.prezzo - b.prezzo);
    const base = sullaStrada[0] || null;
    const prezzoBase = base ? base.prezzo : ordinati[Math.floor(ordinati.length / 2)].prezzo;      // senza nessuno sulla strada: il prezzo di mezzo del corridoio

    // chi vale la pena far misurare ancora: i piu' promettenti con una stima a occhio (andata e ritorno, strade non dritte)
    const stima = v => (prezzoBase - v.prezzo) * litri - (2 * Math.max(v.fuori, 0.5) * 1.4 / resa) * v.prezzo;
    const daMisurare = vicini.filter(v => v.kmInPiu === undefined && v.prezzo < prezzoBase - 0.005).sort((a, b) => stima(b) - stima(a)).slice(0, CANDIDATI);
    if (daMisurare.length) { dice("Misuro le deviazioni…"); await misura(daMisurare); }
    const candidati = vicini.filter(v => v.kmInPiu !== undefined && v.kmInPiu > DEVIAZIONE_NULLA && v.prezzo < prezzoBase - 0.005);
    candidati.forEach(c => { c.netto = (prezzoBase - c.prezzo) * litri - (c.kmInPiu / resa) * c.prezzo; });
    candidati.sort((a, b) => b.netto - a.netto);
    const buoni = candidati.filter(c => c.netto >= 0.3 && c.minInPiu <= 20).slice(0, 8);      // oltre venti minuti non e' una deviazione, e' un altro viaggio
    const migliore = buoni[0];

    // ---- verdetto
    const chi = v => esc(v.bandiera && v.bandiera !== "Pompe Bianche" ? v.bandiera : v.nome || "Pompa bianca");
    const doveSta = v => `${esc(v.comune || v.indirizzo)}, al km ${Math.round(v.lungo)} del viaggio`;
    let verdetto;
    if (migliore && migliore.netto >= 1) {
      verdetto = `<p class="esito si"><b>Conviene deviare.</b> ${chi(migliore)} a ${doveSta(migliore)}: ${prezzoTxt(migliore.prezzo)} €, ${migliore.kmInPiu.toFixed(1).replace(".", ",")} km e circa ${Math.max(1, Math.round(migliore.minInPiu))} minuti in più. Tolto il carburante della deviazione ti restano <span class="risparmio">${euro(migliore.netto)}</span> su ${litri} ${unita}.</p>`;
    } else if (base) {
      verdetto = `<p class="esito no"><b>Non conviene deviare.</b> Il meno caro lo trovi già sulla strada: ${chi(base)} a ${doveSta(base)}, ${prezzoTxt(base.prezzo)} €.${migliore ? ` Uscendo guadagneresti al massimo ${euro(migliore.netto)}: non ne vale il tempo.` : ""}</p>`;
    } else {
      verdetto = `<p class="esito no"><b>Sulla strada non c'è nessun distributore con ${NOMI[stato.carburante]} ${modo}:</b> bisogna uscire comunque. Qui sotto i meno cari entro ${CORRIDOIO} km dal percorso.</p>`;
    }
    $("#verdetto").innerHTML = `<div id="riassunto"><b>${Math.round(km)} km</b>, circa ${Math.round(strada.duration / 60)} minuti. ${vicini.length} distributori con ${NOMI[stato.carburante]} ${modo} entro ${CORRIDOIO} km dalla strada.</div>${verdetto}`;

    // ---- elenco: prima il riferimento sulla strada, poi le deviazioni che rendono
    const voci = [];
    if (base) voci.push({ ...base, tipo: "base" });
    buoni.forEach(c => voci.push({ ...c, tipo: "devia" }));
    if (!base && !buoni.length) ordinati.slice(0, 6).forEach(v => voci.push({ ...v, tipo: "fuori" }));
    const tappa = v => `https://www.google.com/maps/dir/?api=1&origin=${stato.da.lat},${stato.da.lon}&destination=${stato.a.lat},${stato.a.lon}&waypoints=${v.lat},${v.lon}&travelmode=driving`;
    $("#lista").innerHTML = voci.map((v, k) => `<li class="impianto ${v.tipo === "devia" && k === (base ? 1 : 0) && v.netto >= 1 ? "primo" : ""}" data-lat="${v.lat}" data-lon="${v.lon}">
      <div class="totem"><span class="prezzone">${prezzoTxt(v.prezzo)}</span><small>${modo.toUpperCase()} · ${esc(v.del)}</small></div>
      <div class="dati"><h3>${chi(v)}${v.tipo === "base" ? '<span class="etichetta">sulla strada</span>' : ""}</h3>
        <p>${esc(v.indirizzo)}${v.comune ? ", " + esc(v.comune) : ""} · km ${Math.round(v.lungo)} del viaggio</p>
        <p class="giudizio">${v.tipo === "base" ? `Il termine di paragone: ${litri} ${unita} qui costano ${euro(v.prezzo * litri)}.`
          : v.tipo === "devia" ? `<b class="bene">+${euro(v.netto)} in tasca</b> · ${v.kmInPiu.toFixed(1).replace(".", ",")} km e ${Math.max(1, Math.round(v.minInPiu))} min in più${v.stimato ? " (stima)" : ""}`
          : `a ${v.fuori.toFixed(1).replace(".", ",")} km dalla strada`}</p>
        <div class="azioni"><a href="${tappa(v)}" target="_blank" rel="noopener">Viaggio con questa tappa</a></div></div></li>`).join("");
    $("#notaConti").textContent = `Conti fatti su ${litri} ${unita} e ${String(resa).replace(".", ",")} km con un ${unita === "kg" ? "kg" : "litro"}. I prezzi li comunicano i gestori: controlla il cartello.`;

    // ---- mappa
    $("#risultati").hidden = false; dice("");
    preparaMappa();
    const linea = L.polyline(strada.geometry.coordinates.map(c => [c[1], c[0]]), { color: "#14171b", weight: 4, opacity: 0.8 }).addTo(strato);
    for (const v of vicini) if (!voci.some(x => x.id === v.id)) L.circleMarker([v.lat, v.lon], { radius: 3, weight: 1, color: "#fff", fillColor: "#6b7480", fillOpacity: 0.85 }).bindTooltip(`${prezzoTxt(v.prezzo)} € · ${v.bandiera || v.nome}`).addTo(strato);
    [...voci].reverse().forEach(v => L.marker([v.lat, v.lon], { icon: L.divIcon({ className: "", html: `<div class="segno ${v.tipo === "devia" && v === voci[base ? 1 : 0] ? "meno" : ""}">${prezzoTxt(v.prezzo)}</div>`, iconSize: null, iconAnchor: [24, 12] }) }).addTo(strato));
    L.marker([stato.da.lat, stato.da.lon], { icon: L.divIcon({ className: "", html: '<div class="tu"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(strato);
    mappa.invalidateSize(); mappa.fitBounds(linea.getBounds(), { padding: [16, 16] });
    $("#lista").onclick = e => { if (e.target.closest("a")) return; const li = e.target.closest(".impianto"); if (li) { mappa.setView([+li.dataset.lat, +li.dataset.lon], 14); if (innerWidth < 900) $("#mappa").scrollIntoView({ behavior: "smooth", block: "start" }); } };
  }

  // ---------------------------------------------------------------- comandi
  function gruppo(sel, chiave, attr) {
    const box = $(sel), segna = () => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(b.dataset[attr] === stato[chiave])));
    box.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      stato[chiave] = b.dataset[attr];
      if (chiave === "carburante") { stato.modo = ["gpl", "metano"].includes(stato.carburante) ? "a" : "s"; segnaModo(); unita(); }
      segna();
    });
    segna(); return segna;
  }
  const unita = () => { const kg = stato.carburante === "metano"; $("#unita").textContent = kg ? "kg" : "litri"; $("#unita1").textContent = kg ? "kg" : "litro"; };
  gruppo("#carburante", "carburante", "c");
  const segnaModo = gruppo("#modo", "modo", "m");
  unita();

  async function caricaComuni() {
    if (!comuni) comuni = (await (await fetch("dati/comuni.json")).json()).map(c => ({ nome: c[0], prov: c[1], lat: c[2], lon: c[3], piano: piano(c[0]) }));
    return comuni;
  }
  async function indovina(campo) {             // il comune scritto a mano: nome esatto, altrimenti il primo che comincia cosi'
    const q = piano(campo.value.trim()); if (q.length < 2) return null;
    const tutti = await caricaComuni();
    const c = tutti.find(x => x.piano === q) || tutti.filter(x => x.piano.startsWith(q)).sort((a, b) => a.nome.length - b.nome.length)[0];
    if (!c) return null;
    campo.value = c.nome;
    return { lat: c.lat, lon: c.lon, nome: c.nome };
  }

  const piano = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function completamento(campo, box, preso) {
    let scelto = -1, esiti = [];
    const chiudi = () => { box.hidden = true; };
    const prendi = c => { if (!c) return; campo.value = c.nome; chiudi(); preso({ lat: c.lat, lon: c.lon, nome: c.nome }); };
    campo.addEventListener("input", async () => {
      preso(null);
      const q = piano(campo.value.trim()); if (q.length < 2) { chiudi(); return; }
      await caricaComuni();
      esiti = comuni.filter(c => c.piano.includes(q)).sort((a, b) => a.piano.indexOf(q) - b.piano.indexOf(q) || a.nome.length - b.nome.length).slice(0, 8);
      scelto = -1;
      box.innerHTML = esiti.map((c, k) => `<li role="option" data-k="${k}">${esc(c.nome)} <small>${c.prov}</small></li>`).join("") || `<li aria-disabled="true"><small>Nessun comune con un distributore che si chiami così</small></li>`;
      box.hidden = false;
    });
    campo.addEventListener("keydown", e => {
      const voci = [...box.querySelectorAll("li[role=option]")];
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && voci.length) { e.preventDefault(); scelto = (scelto + (e.key === "ArrowDown" ? 1 : -1) + voci.length) % voci.length; voci.forEach((v, k) => v.setAttribute("aria-selected", String(k === scelto))); }
      if (e.key === "Enter") { e.preventDefault(); prendi(esiti[Math.max(0, scelto)]); }
      if (e.key === "Escape") chiudi();
    });
    box.addEventListener("click", e => { const li = e.target.closest("li[data-k]"); if (li) prendi(esiti[+li.dataset.k]); });
    document.addEventListener("click", e => { if (!e.target.closest(".cerca") || !campo.parentElement.contains(e.target)) chiudi(); });
  }
  completamento($("#da"), $("#esitiDa"), p => { stato.da = p; });
  completamento($("#a"), $("#esitiA"), p => { stato.a = p; });

  $("#qui").addEventListener("click", () => {
    if (!navigator.geolocation) { $("#stato").textContent = "Questo browser non dà la posizione: scrivi il comune di partenza."; return; }
    $("#stato").textContent = "Chiedo la posizione al dispositivo…";
    navigator.geolocation.getCurrentPosition(p => { stato.da = { lat: p.coords.latitude, lon: p.coords.longitude, nome: "la mia posizione" }; $("#da").value = "La mia posizione"; $("#stato").textContent = ""; },
      () => { $("#stato").textContent = "Posizione non concessa. Nessun problema: scrivi il comune di partenza."; }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
  $("#calcola").addEventListener("click", calcola);

  // ---------------------------------------------------------------- avvio
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  fetch("dati/indice.json").then(r => r.json()).then(d => {
    indice = d;
    const [a, m, g] = d.agg.split("-");
    $("#aggiornato").textContent = `Prezzi ufficiali del ${g}/${m}/${a}`;
  }).catch(() => { $("#stato").textContent = "Non riesco a leggere i prezzi. Riprova tra poco."; });
})();
