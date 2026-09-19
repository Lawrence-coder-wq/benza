/* Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
   Tutto gira nel browser: i file dei prezzi sono statici (uno per provincia) e la posizione non esce mai da qui. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NOMI = { benzina: "benzina", gasolio: "gasolio", gpl: "GPL", metano: "metano" };
  const PIENO = 50;                         // litri di un pieno, per dire il risparmio in euro

  const stato = { carburante: "benzina", modo: "s", km: 10, dove: null, nome: "" };
  let indice = null, comuni = null;
  const province = new Map();               // sigla -> impianti gia' scaricati
  try { Object.assign(stato, JSON.parse(localStorage.getItem("dcm") || "{}")); } catch {}
  const ricorda = () => { try { localStorage.setItem("dcm", JSON.stringify({ carburante: stato.carburante, modo: stato.modo, km: stato.km })); } catch {} };

  // ---------------------------------------------------------------- cifre a sette segmenti, come sul totem
  const SEGMENTI = { a: [2, 0, 8, 2], b: [10, 1.5, 2, 7.5], c: [10, 11, 2, 7.5], d: [2, 18, 8, 2], e: [0, 11, 2, 7.5], f: [0, 1.5, 2, 7.5], g: [2, 9, 8, 2] };
  const ACCESI = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
  const cifra = n => `<svg viewBox="0 0 12 20" aria-hidden="true">${Object.entries(SEGMENTI).map(([k, [x, y, w, h]]) => `<rect class="${ACCESI[n].includes(k) ? "acceso" : "spento"}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>`).join("")}</svg>`;
  function totem(prezzo) {
    const t = prezzo.toFixed(3);            // 2.179 -> "2" "," "17" e il millesimo piccolo
    return `<span class="cifre" role="img" aria-label="${t.replace(".", ",")} euro al litro">${cifra(+t[0])}<i class="virgola"></i>${cifra(+t[2])}${cifra(+t[3])}<span class="millesimo">${cifra(+t[4])}</span></span>`;
  }

  // ---------------------------------------------------------------- mappa
  const mappa = L.map("mappa", { zoomControl: true, attributionControl: true }).setView([42.2, 12.6], 6);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mappa);
  const strato = L.layerGroup().addTo(mappa);
  let cerchio = null;

  const distanza = (a, b, c, d) => {        // km tra due punti (formula dell'emisenoverso)
    const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };

  async function impiantiVicini() {
    const servono = indice.province.filter(([, lat, lon, raggio]) => distanza(stato.dove.lat, stato.dove.lon, lat, lon) <= raggio + stato.km + 5).map(p => p[0]);
    await Promise.all(servono.filter(s => !province.has(s)).map(async s => province.set(s, (await (await fetch(`dati/province/${s}.json`)).json()).impianti)));
    const fuori = [];
    for (const s of servono) for (const i of province.get(s)) {
      const p = i[7][stato.carburante]; if (!p || !p[stato.modo]) continue;
      const km = distanza(stato.dove.lat, stato.dove.lon, i[1], i[2]); if (km > stato.km) continue;
      fuori.push({ id: i[0], lat: i[1], lon: i[2], bandiera: i[3], nome: i[4], indirizzo: i[5], comune: i[6], prezzo: p[stato.modo][0], del: p[stato.modo][1], km });
    }
    return fuori.sort((a, b) => a.prezzo - b.prezzo || a.km - b.km);
  }

  async function cerca() {
    if (!stato.dove || !indice) return;
    $("#stato").textContent = "Cerco i distributori…";
    let trovati;
    try { trovati = await impiantiVicini(); } catch { $("#stato").textContent = "Non riesco a scaricare i prezzi. Controlla la connessione e riprova."; return; }
    strato.clearLayers();
    if (cerchio) cerchio.remove();
    cerchio = L.circle([stato.dove.lat, stato.dove.lon], { radius: stato.km * 1000, color: "#14171b", weight: 1, fillOpacity: 0.04 }).addTo(mappa);
    L.marker([stato.dove.lat, stato.dove.lon], { icon: L.divIcon({ className: "", html: '<div class="tu"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(strato);
    mappa.invalidateSize();
    mappa.fitBounds(cerchio.getBounds(), { padding: [10, 10] });

    const modo = stato.modo === "s" ? "self" : "servito";
    if (!trovati.length) {
      $("#riassunto").hidden = true; $("#lista").innerHTML = "";
      $("#stato").textContent = `Nessun distributore con ${NOMI[stato.carburante]} ${modo} entro ${stato.km} km da ${stato.nome}. Allarga il raggio${stato.modo === "s" ? " o prova «Servito»" : ""}.`;
      return;
    }
    const media = trovati.reduce((s, x) => s + x.prezzo, 0) / trovati.length;
    const terzo = Math.max(1, Math.ceil(trovati.length / 3));
    trovati.forEach((x, k) => { x.fascia = k < terzo ? "meno" : k >= trovati.length - terzo && trovati.length > 3 ? "piu" : ""; });
    const risparmio = (media - trovati[0].prezzo) * PIENO;
    $("#stato").textContent = "";
    $("#riassunto").hidden = false;
    $("#riassunto").innerHTML = `<b>${trovati.length} distributori</b> con ${NOMI[stato.carburante]} ${modo} entro ${stato.km} km da ${esc(stato.nome)}. Media della zona <b>${media.toFixed(3).replace(".", ",")} €</b>${indice.medie_self[stato.carburante] && stato.modo === "s" ? `, media italiana ${indice.medie_self[stato.carburante].toFixed(3).replace(".", ",")} €` : ""}.` +
      (risparmio >= 0.5 ? ` Dal meno caro <span class="risparmio">risparmi circa ${risparmio.toFixed(2).replace(".", ",")} € su un pieno da ${PIENO} litri</span> rispetto alla media.` : "");

    const segni = new Map();
    // sulla mappa il cartellino col prezzo va solo ai 15 della lista; gli altri sono puntini, altrimenti si coprono a vicenda
    for (const x of trovati.slice(15, 300)) L.circleMarker([x.lat, x.lon], { radius: 4, weight: 1, color: "#fff", fillColor: "#6b7480", fillOpacity: 0.9 }).bindTooltip(`${x.prezzo.toFixed(3).replace(".", ",")} € · ${x.bandiera || x.nome}`).addTo(strato);
    for (const x of trovati.slice(0, 15).reverse()) {        // i meno cari si disegnano per ultimi, cosi' stanno sopra
      const m = L.marker([x.lat, x.lon], { icon: L.divIcon({ className: "", html: `<div class="segno ${x === trovati[0] ? "meno" : ""}">${x.prezzo.toFixed(3).replace(".", ",")}</div>`, iconSize: null, iconAnchor: [24, 12] }), title: x.nome || x.bandiera });
      m.on("click", () => evidenzia(x.id, true));
      m.addTo(strato); segni.set(x.id, m);
    }
    $("#lista").innerHTML = trovati.slice(0, 15).map((x, k) => `<li class="impianto ${k === 0 ? "primo" : ""}" data-id="${x.id}" data-lat="${x.lat}" data-lon="${x.lon}">
      <div class="totem">${totem(x.prezzo)}<small>${modo.toUpperCase()} · ${esc(x.del)}</small></div>
      <div class="dati"><h3>${esc(x.bandiera && x.bandiera !== "Pompe Bianche" ? x.bandiera : x.nome || "Pompa bianca")}${k === 0 ? '<span class="etichetta">il meno caro</span>' : ""}</h3>
        <p>${esc(x.indirizzo)}${x.comune ? ", " + esc(x.comune) : ""}</p>
        <div class="azioni"><span class="km">${x.km < 1 ? Math.round(x.km * 1000) + " m" : x.km.toFixed(1).replace(".", ",") + " km"}</span>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lon}" target="_blank" rel="noopener">Portami lì</a></div></div></li>`).join("");

    function evidenzia(id, scorri) {
      document.querySelectorAll(".impianto.scelto").forEach(e => e.classList.remove("scelto"));
      const li = document.querySelector(`.impianto[data-id="${id}"]`);
      if (li) { li.classList.add("scelto"); if (scorri) li.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
    $("#lista").onclick = e => {
      if (e.target.closest("a")) return;
      const li = e.target.closest(".impianto"); if (!li) return;
      evidenzia(li.dataset.id); mappa.setView([+li.dataset.lat, +li.dataset.lon], Math.max(mappa.getZoom(), 14));
      if (innerWidth < 900) $("#mappa").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  // ---------------------------------------------------------------- comandi
  const aggiorna = {};
  function gruppo(sel, chiave, attr) {
    const box = $(sel);
    const segna = () => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(b.dataset[attr] === stato[chiave])));
    box.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      stato[chiave] = b.dataset[attr];
      // GPL e metano in Italia li eroga quasi sempre un addetto: con "Self" non si troverebbe nulla
      if (chiave === "carburante") { stato.modo = ["gpl", "metano"].includes(stato.carburante) ? "a" : "s"; aggiorna.modo(); }
      segna(); ricorda(); cerca();
    });
    aggiorna[chiave] = segna;
    segna();
  }
  gruppo("#carburante", "carburante", "c");
  gruppo("#modo", "modo", "m");
  $("#km").value = stato.km; $("#kmTesto").textContent = stato.km;
  $("#km").addEventListener("input", e => { stato.km = +e.target.value; $("#kmTesto").textContent = stato.km; });
  $("#km").addEventListener("change", () => { ricorda(); cerca(); });

  $("#qui").addEventListener("click", () => {
    if (!navigator.geolocation) { $("#stato").textContent = "Questo browser non dà la posizione: scrivi un comune."; return; }
    $("#stato").textContent = "Chiedo la posizione al dispositivo…";
    navigator.geolocation.getCurrentPosition(p => { stato.dove = { lat: p.coords.latitude, lon: p.coords.longitude }; stato.nome = "te"; cerca(); },
      () => { $("#stato").textContent = "Posizione non concessa. Nessun problema: scrivi il nome di un comune."; }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  const piano = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let scelto = -1;
  async function suggerisci() {
    const q = piano($("#comune").value.trim()), box = $("#esiti");
    if (q.length < 2) { box.hidden = true; return; }
    if (!comuni) comuni = (await (await fetch("dati/comuni.json")).json()).map(c => ({ nome: c[0], prov: c[1], lat: c[2], lon: c[3], piano: piano(c[0]) }));
    const esiti = comuni.filter(c => c.piano.includes(q)).sort((a, b) => a.piano.indexOf(q) - b.piano.indexOf(q) || a.nome.length - b.nome.length).slice(0, 8);
    scelto = -1;
    box.innerHTML = esiti.map((c, k) => `<li role="option" data-k="${k}">${esc(c.nome)} <small>${c.prov}</small></li>`).join("") || `<li aria-disabled="true"><small>Nessun comune con un distributore che si chiami così</small></li>`;
    box.hidden = false; box._esiti = esiti;
  }
  function prendi(c) { if (!c) return; $("#comune").value = c.nome; $("#esiti").hidden = true; stato.dove = { lat: c.lat, lon: c.lon }; stato.nome = c.nome; cerca(); }
  $("#comune").addEventListener("input", suggerisci);
  $("#comune").addEventListener("keydown", e => {
    const voci = [...document.querySelectorAll("#esiti li[role=option]")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); scelto = (scelto + (e.key === "ArrowDown" ? 1 : -1) + voci.length) % voci.length; voci.forEach((v, k) => v.setAttribute("aria-selected", String(k === scelto))); }
    if (e.key === "Enter") { e.preventDefault(); prendi(($("#esiti")._esiti || [])[Math.max(0, scelto)]); }
    if (e.key === "Escape") $("#esiti").hidden = true;
  });
  $("#esiti").addEventListener("click", e => { const li = e.target.closest("li[data-k]"); if (li) prendi($("#esiti")._esiti[+li.dataset.k]); });
  document.addEventListener("click", e => { if (!e.target.closest(".cerca")) $("#esiti").hidden = true; });

  // ---------------------------------------------------------------- avvio
  fetch("dati/indice.json").then(r => r.json()).then(d => {
    indice = d;
    const [a, m, g] = d.agg.split("-");
    $("#aggiornato").textContent = `Prezzi ufficiali del ${g}/${m}/${a} · ${d.impianti.toLocaleString("it-IT")} distributori in tutta Italia`;
    const p = new URLSearchParams(location.search).get("comune");      // si puo' condividere un link gia' puntato: ?comune=Salerno
    if (p) { $("#comune").value = p; suggerisci().then(() => prendi(($("#esiti")._esiti || [])[0])); }
  }).catch(() => { $("#stato").textContent = "Non riesco a leggere i prezzi. Riprova tra poco."; });
})();
