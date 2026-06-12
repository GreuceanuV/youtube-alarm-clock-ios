const CACHE = "yt-alarm-v1";
const ASSETS = ["./", "./index.html", "./css/style.css", "./js/app.js", "./js/alarms.js", "./js/storage.js", "./js/youtube.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});