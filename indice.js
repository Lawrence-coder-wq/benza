/* Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
   L'indice: medie provinciali del self contro la media italiana, con la frase pronta da citare. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const euro = v => v.toFixed(3).replace(".", ",");
  const perc = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1).replace(".", ",") + "%";
  const SEGMENTI = { a: [2, 0, 8, 2], b: [10, 1.5, 2, 7.5], c: [10, 11, 2, 7.5], d: [2, 18, 8, 2], e: [0, 11, 2, 7.5], f: [0, 1.5, 2, 7.5], g: [2, 9, 8, 2] };
  const ACCESI = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
  const cifra = n => `<svg viewBox="0 0 12 20" aria-hidden="true">${Object.entries(SEGMENTI).map(([k, [x, y, w, h]]) => `<rect class="${ACCESI[n].includes(k) ? "acceso" : "spento"}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>`).join("")}</svg>`;
  const totem = p => { const t = p.toFixed(3); return `<span class="cifre grandi" role="img" aria-label="${t.replace(".", ",")} euro al litro">${cifra(+t[0])}<i class="virgola"></i>${cifra(+t[2])}${cifra(+t[3])}<span class="millesimo">${cifra(+t[4])}</span></span>`; };

  // "lo 0,3%", "l'1,2%", "l'8%", "l'11%", "il 2,5%": l'articolo davanti a una percentuale segue il numero
  const articolo = n => (n.startsWith("0") ? "lo " : /^(1\.|1$|8|11)/.test(n) ? "l'" : "il ");
  let D = null, carburante = "benzina", storico = null;

  function classifica() {
    const media = D.italia[carburante];
    const righe = Object.entries(D.province).filter(([, v]) => v[carburante]).map(([p, v]) => ({ p, nome: D.nomi[p], prezzo: v[carburante], scarto: (v[carburante] / media - 1) * 100 })).sort((a, b) => b.prezzo - a.prezzo);
    const massimo = Math.max(...righe.map(r => Math.abs(r.scarto)), 0.1);
    const riga = r => `<li><a href="?provincia=${r.p}#t-provincia" data-p="${r.p}">${esc(r.nome)}</a><span class="barra ${r.scarto >= 0 ? "su" : "giu"}"><i style="width:${Math.abs(r.scarto) / massimo * 100}%"></i></span><b>${euro(r.prezzo)}</b><em>${perc(r.scarto)}</em></li>`;
    $("#care").innerHTML = righe.slice(0, 10).map(riga).join("");
    $("#economiche").innerHTML = righe.slice(-10).reverse().map(riga).join("");
    return righe;
  }

  function frase() {
    const p = $("#provincia").value, v = D.province[p]; if (!v) return;
    try { localStorage.setItem("dcm-provincia", p); } catch {}
    const pezzi = [];
    for (const c of ["benzina", "gasolio"]) {
      if (!v[c]) continue;
      const scarto = (v[c] / D.italia[c] - 1) * 100;
      const ordine = Object.values(D.province).filter(x => x[c]).map(x => x[c]).sort((a, b) => b - a);
      const posto = ordine.indexOf(v[c]) + 1;
      let t = `${c === "benzina" ? "la benzina" : "il gasolio"} self costa in media <b>${euro(v[c])} € al litro</b>, ${Math.abs(scarto) < 0.05 ? "in linea con " : `${articolo(Math.abs(scarto).toFixed(1))}${Math.abs(scarto).toFixed(1).replace(".", ",")}% in ${scarto > 0 ? "più" : "meno"} del`}la media italiana (${euro(D.italia[c])} €): è la ${posto}ª provincia più cara su ${ordine.length}`;
      if (storico) {
        const giorni = Object.keys(storico).sort(), prima = giorni[Math.max(0, giorni.length - 8)];
        const ieri = storico[prima]?.province?.[p]?.[c];
        if (ieri && prima !== D.giorno) { const cent = (v[c] - ieri) * 100; t += `; ${Math.abs(cent) < 0.05 ? "stabile" : (cent > 0 ? "+" : "−") + Math.abs(cent).toFixed(1).replace(".", ",") + " centesimi"} rispetto al ${prima.split("-").reverse().slice(0, 2).join("/")}`; }
      }
      pezzi.push(t);
    }
    const [a, m, g] = D.giorno.split("-");
    $("#frase").innerHTML = `<p>Oggi in provincia di ${esc(D.nomi[p])} ${pezzi.join(". E ")}.</p><small>Fonte: Benza su dati MIMIT del ${g}/${m}/${a}</small>`;
  }

  function andamento() {
    const giorni = Object.keys(storico).sort();
    if (giorni.length < 3) { $("#andamento").innerHTML = `<p class="nota">Lo storico dell'indice è cominciato il ${giorni[0].split("-").reverse().join("/")}: il grafico dell'andamento compare tra qualche giorno.</p>`; return; }
    const L = 600, A = 140, serie = c => giorni.map(g => storico[g].italia[c]).filter(Boolean);
    const tutti = [...serie("benzina"), ...serie("gasolio")], min = Math.min(...tutti) - 0.01, max = Math.max(...tutti) + 0.01;
    const linea = c => giorni.map((g, i) => `${i ? "L" : "M"}${(i / (giorni.length - 1) * L).toFixed(1)},${(A - (storico[g].italia[c] - min) / (max - min) * A).toFixed(1)}`).join("");
    $("#andamento").innerHTML = `<svg class="grafico" viewBox="-4 -8 ${L + 8} ${A + 16}" role="img" aria-label="Andamento della media italiana di benzina e gasolio"><path d="${linea("benzina")}" fill="none" stroke="#0b8a4b" stroke-width="2.5"/><path d="${linea("gasolio")}" fill="none" stroke="#14171b" stroke-width="2.5"/></svg>
      <p class="nota"><b style="color:#0b8a4b">benzina</b> e <b>gasolio</b>, media italiana del self dal ${giorni[0].split("-").reverse().join("/")} a oggi (da ${euro(min + 0.01)} a ${euro(max - 0.01)} €)</p>`;
  }

  fetch("dati/indice-benza.json").then(r => r.json()).then(d => {
    D = d;
    const [a, m, g] = d.giorno.split("-");
    $("#aggiornato").textContent = `Prezzi medi del self del ${g}/${m}/${a}, dai dati ufficiali del Ministero`;
    $("#italia").innerHTML = ["benzina", "gasolio"].map(c => `<div class="totem largo">${totem(d.italia[c])}<small>${c.toUpperCase()} · MEDIA ITALIANA SELF</small></div>`).join("");
    const sigle = Object.keys(d.province).sort((x, y) => d.nomi[x].localeCompare(d.nomi[y], "it"));
    let scelta = new URLSearchParams(location.search).get("provincia"); try { scelta = scelta || localStorage.getItem("dcm-provincia"); } catch {}
    $("#provincia").innerHTML = sigle.map(p => `<option value="${p}" ${p === scelta ? "selected" : ""}>${esc(d.nomi[p])}</option>`).join("");
    if (!d.province[scelta]) $("#provincia").value = d.province.RM ? "RM" : sigle[0];
    classifica(); frase();
    return fetch("dati/indice-storico.json").then(r => r.json()).then(s => { storico = s; frase(); andamento(); });
  }).catch(() => { $("#aggiornato").textContent = "Non riesco a leggere l'indice. Riprova tra poco."; });

  $("#provincia").addEventListener("change", frase);
  $("#quale").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; carburante = b.dataset.c; document.querySelectorAll("#quale button").forEach(x => x.setAttribute("aria-checked", String(x === b))); classifica(); });
  document.addEventListener("click", e => { const a = e.target.closest("a[data-p]"); if (!a) return; e.preventDefault(); $("#provincia").value = a.dataset.p; frase(); $("#t-provincia").scrollIntoView({ behavior: "smooth" }); });
  $("#copia").addEventListener("click", async () => {
    const testo = $("#frase").innerText.replace(/\n+/g, " ").trim();
    try { await navigator.clipboard.writeText(testo); $("#copia").textContent = "Copiata"; setTimeout(() => ($("#copia").textContent = "Copia la frase"), 1800); } catch { $("#copia").textContent = "Selezionala e copiala a mano"; }
  });
})();
