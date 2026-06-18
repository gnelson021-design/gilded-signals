const CACHE_NAME = 'gs-shell-v1';
const SHELL_ASSETS = ['/','/index.html','/manifest.json','/assets/js/gs-scanner.js','/assets/js/gs-access.js','/assets/icons/icon-192.png','/assets/icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL_ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n!==CACHE_NAME).map(n => caches.delete(n))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/.netlify/functions/') || url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,copy)); return r; }).catch(() => caches.match(e.request).then(c => c || caches.match('/index.html'))));
});
