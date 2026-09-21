/* Benza - Copyright (c) 2026 Lorenzo Paoletta - licenza MIT
   Fa funzionare Benza come un'app sul telefono: la pagina si apre subito anche con poca rete,
   e se la rete manca del tutto mostra gli ultimi prezzi scaricati (con la loro data). */
const VERSIONE = "benza-1.3.0";
const GUSCIO = ["./", "index.html", "indice.html", "percorso.html", "stile.css", "app.js", "indice.js", "percorso.js", "manifest.webmanifest", "icone/icona-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"];

self.addEventListener("install", e => e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(GUSCIO)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(nomi => Promise.all(nomi.filter(n => n !== VERSIONE).map(n => caches.delete(n)))).then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.hostname.endsWith("openstreetmap.org") || u.hostname.endsWith("project-osrm.org")) return;      // le mattonelle della mappa non si conservano
  const prezzi = u.origin === location.origin && u.pathname.includes("/dati/");
  if (prezzi || e.request.mode === "navigate") {
    // prima la rete (i prezzi cambiano ogni giorno), la copia solo se la rete non c'e'
    e.respondWith(fetch(e.request).then(r => { const copia = r.clone(); caches.open(VERSIONE).then(c => c.put(e.request, copia)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    // stile, codice e icone: subito dalla copia, e intanto si aggiorna la copia
    e.respondWith(caches.match(e.request).then(c => { const rete = fetch(e.request).then(r => { const copia = r.clone(); caches.open(VERSIONE).then(k => k.put(e.request, copia)); return r; }).catch(() => c); return c || rete; }));
  }
});
