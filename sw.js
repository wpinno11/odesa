// Odesa service worker: keeps the app shell available and shows push notifications. Data is never cached.
const V = "odesa-v13"; const SHELL = ["./", "index.html", "app.css?v=2", "app.js?v=13", "manifest.webmanifest", "icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;   // API calls go straight to the network
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: "Odesa", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Odesa", { body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "#today" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close(); const url = "./" + (e.notification.data && e.notification.data.url || "#today");
  e.waitUntil(clients.matchAll({ type: "window" }).then((cs) => { for (const c of cs) { c.navigate(url); return c.focus(); } return clients.openWindow(url); }));
});
