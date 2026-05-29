// Minimal service worker to make the chat installable as an app.
// No offline caching (the app needs the live server); a pass-through fetch
// handler is enough for installability.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* network passthrough */ });
