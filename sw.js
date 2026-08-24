// ═══════════════════════════════════════════════════
//  Service Worker – Directorio Aposento Alto
//  Versión: 1.0.0
// ═══════════════════════════════════════════════════

const CACHE_NAME  = 'aposento-v1';
const CACHE_URLS  = [
  '/',
  '/index.html',
  '/style.css',
  '/index.js',
  '/directorio.js',
  '/logo.png',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Outfit:wght@300;400;600;700&display=swap'
];

// Instalar: cachear recursos clave
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: red primero, caché como respaldo
self.addEventListener('fetch', e => {
  // Solo cachear requests GET del mismo origen o Google Fonts
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const esMismoOrigen = url.origin === self.location.origin;
  const esFonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  if (!esMismoOrigen && !esFonts) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Guardar copia fresca en caché
        const copia = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
