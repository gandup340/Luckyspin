/* LUCKY VIPS GAME — service worker (PWA cache + Web Push) */
const CACHE_NAME = "lucky-vips-shell-v2";
const PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/chat-media.js",
  "/chat.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && (url.pathname === "/" || PRECACHE.includes(url.pathname))) {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const home = await caches.match("/");
          if (home) return home;
        }
        throw new Error("offline");
      })
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "LUCKY VIPS GAME",
    body: "You have a new update.",
    icon: "/assets/icons/icon-192.png",
    badge: "/assets/icons/icon-192.png",
    url: "/",
    data: {},
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
      if (parsed.data && typeof parsed.data === "object") {
        payload.data = { ...payload.data, ...parsed.data };
      }
    }
  } catch {
    try {
      const text = event.data && event.data.text();
      if (text) payload.body = text;
    } catch {
      /* keep defaults */
    }
  }

  const targetUrl = String(payload.url || payload.data?.url || "/");
  const options = {
    body: String(payload.body || ""),
    icon: String(payload.icon || "/assets/icons/icon-192.png"),
    badge: String(payload.badge || "/assets/icons/icon-192.png"),
    data: { ...(payload.data || {}), url: targetUrl },
    vibrate: [120, 60, 120, 60, 180],
    renotify: true,
    requireInteraction: false,
    silent: false,
    tag: String(payload.tag || "lucky-vips"),
  };

  event.waitUntil(self.registration.showNotification(String(payload.title || "LUCKY VIPS GAME"), options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = String(event.notification?.data?.url || "/");
  const abs = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(abs);
            } catch {
              /* ignore navigate failures */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(abs);
    })()
  );
});
