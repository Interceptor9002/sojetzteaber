const SCHALE = "rk-shell-v39";
const EXT = "rk-ext-v39";
const KERN = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SCHALE).then(c => Promise.allSettled(KERN.map(d => c.add(d)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(alle => Promise.all(alle.filter(n => n !== SCHALE && n !== EXT).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);

  if (u.origin === location.origin){
    if (u.pathname.endsWith("/worker.js") || u.pathname.endsWith("/sw.js")){
      e.respondWith(fetch(r).catch(() => caches.match(r)));
      return;
    }
    e.respondWith(
      fetch(r).then(res => {
        if (res && res.ok){
          const kopie = res.clone();
          caches.open(SCHALE).then(c => c.put(r, kopie)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(r).then(t => t || caches.match("./index.html")))
    );
    return;
  }

  if (u.hostname === "cdn.jsdelivr.net"){
    e.respondWith(
      caches.match(r).then(t => t || fetch(r).then(res => {
        if (res && res.ok){
          const kopie = res.clone();
          caches.open(EXT).then(c => c.put(r, kopie)).catch(() => {});
        }
        return res;
      }))
    );
  }
});