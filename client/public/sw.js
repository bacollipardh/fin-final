const CACHE_NAME = "fin-approvals-v2-202603270813";
const STATIC_ASSETS = ["/"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log("[SW] Deleting old cache:", k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
  // Notify all clients to reload
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage({ type: "SW_UPDATED" }));
  });
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  
  // SSE - lere kaloje pa nderhyrje (mos e percepto si fetch normal)
  if (url.pathname.startsWith("/notifications/")) {
    return; // nuk bejme asnje gje - browseri e menaxhon vete
  }

  // KurrÃƒÂ« mos cache-o: API, uploads, HTML
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/") ||
    url.pathname.startsWith("/pb/") ||
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.endsWith(".html")
  ) {
    e.respondWith(fetch(e.request).catch(err => new Response(JSON.stringify({error:"offline"}), {status:503, headers:{"Content-Type":"application/json"}})));
    return;
  }

  // Navigation - gjithmonÃƒÂ« network first
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/"))
    );
    return;
  }

  // JS/CSS me hash Vite - cache-first (hash garantoi version)
  if (url.pathname.match(/\.(js|css|woff2?|ttf|eot|ico)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Default - network first
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
