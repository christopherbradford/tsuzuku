/*
 * TSUZUKU — service worker (group A, design 07 §10). Plain JS, no build step.
 *
 * Scope is wherever this file is served from, so it works at
 * https://<user>.github.io/<repo>/ and at a custom root alike.
 *
 *   install   precache the shell (./, index.html, manifest, favicon)
 *   activate  drop our caches from other versions, claim clients
 *   fetch     navigations / index.html     → network-first, shell fallback
 *             content/manifest.json        → stale-while-revalidate (new content versions flow)
 *             content/** assets/** fonts/** → cache-first (immutable per release)
 *             manifest / favicon / sw.js   → stale-while-revalidate
 *   message   {type:'SKIP_WAITING'} → skipWaiting (the page asks after the learner taps Reload)
 *
 * The content loader keeps its own `tsuzuku-content-<version>` caches; we never touch those.
 */
'use strict';

const CACHE_VERSION = 'v1';
const SHELL_CACHE = 'tsuzuku-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'tsuzuku-runtime-' + CACHE_VERSION;
const OWN_PREFIXES = ['tsuzuku-shell-', 'tsuzuku-runtime-'];
const BASE = new URL('./', self.location.href);
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './favicon.svg'].map(function (p) {
  return new URL(p, BASE).href;
});
const INDEX_URL = new URL('./index.html', BASE).href;

function relativePath(url) {
  return url.href.startsWith(BASE.href) ? url.href.slice(BASE.href.length).split('?')[0].split('#')[0] : null;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    SHELL_URLS.map(async function (url) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res && res.ok) await cache.put(url, res);
      } catch (_) {
        /* offline during install: the next activation retries */
      }
    }),
  );
}

async function cleanOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter(function (k) {
        return OWN_PREFIXES.some(function (p) {
          return k.startsWith(p);
        }) && k !== SHELL_CACHE && k !== RUNTIME_CACHE;
      })
      .map(function (k) {
        return caches.delete(k);
      }),
  );
}

async function putIfOk(cacheName, request, response) {
  if (!response || !response.ok) return response;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (_) {
    /* quota: serve without caching */
  }
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  return putIfOk(RUNTIME_CACHE, request, res);
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(function (res) {
      return putIfOk(cacheName, request, res);
    })
    .catch(function () {
      return null;
    });
  if (cached) {
    refresh.catch(function () {});
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response('', { status: 504, statusText: 'offline' });
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await putIfOk(SHELL_CACHE, INDEX_URL, res.clone());
      return res;
    }
    const cached = (await caches.match(request)) || (await caches.match(INDEX_URL));
    return cached || res;
  } catch (_) {
    const cached = (await caches.match(request)) || (await caches.match(INDEX_URL));
    return cached || new Response('<!doctype html><title>TSUZUKU</title><p>Offline. The dojo opens again when the network returns.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    cleanOldCaches().then(function () {
      return self.clients && self.clients.claim ? self.clients.claim() : undefined;
    }),
  );
});

self.addEventListener('message', function (event) {
  const data = event && event.data;
  if (data && data.type === 'SKIP_WAITING' && self.skipWaiting) self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (!request || request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== BASE.origin) return;
  const rel = relativePath(url);
  if (rel === null) return;

  if (request.mode === 'navigate' || rel === '' || rel === 'index.html') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (rel === 'content/manifest.json') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }
  if (rel.startsWith('content/') || rel.startsWith('assets/') || rel.startsWith('fonts/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (rel === 'manifest.webmanifest' || rel === 'favicon.svg' || rel === 'sw.js') {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
