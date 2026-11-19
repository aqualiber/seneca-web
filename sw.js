// Guarda so a casca estatica (mesma origem). Nunca intercepta chamadas a outra origem (a funcao do Sêneca)
// nem nada que nao seja GET.
const CACHE = "seneca-web-v1";
const CASCA = [
  "./", "index.html", "app.css", "config.js", "manifest.webmanifest", "icone-192.png", "icone-512.png",
  "js/app.js", "js/api.js", "js/chat.js", "js/fila.js", "js/gravador.js", "js/pareamento.js",
  "js/puro.js", "js/render.js", "js/resumos.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return; // funcao do Seneca e qualquer terceiro: nunca
  // rede primeiro (pega versao nova); sem rede, a copia guardada
  e.respondWith(
    fetch(r).then((resp) => {
      if (resp && resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(r, copia)); }
      return resp;
    }).catch(() => caches.match(r, { ignoreSearch: true })),
  );
});
