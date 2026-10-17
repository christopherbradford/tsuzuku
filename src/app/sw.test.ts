/**
 * public/sw.js evaluated inside a fake ServiceWorkerGlobalScope.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const code = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
const ORIGIN = 'https://user.github.io';
const BASE = `${ORIGIN}/repo/`;

type Listener = (ev: unknown) => void;

interface RequestLike {
  url: string;
  method: string;
  mode?: string;
}

class FakeCache {
  readonly store = new Map<string, Response>();
  async put(req: RequestLike | string, res: Response): Promise<void> {
    this.store.set(typeof req === 'string' ? req : req.url, res);
  }
  async match(req: RequestLike | string): Promise<Response | undefined> {
    const hit = this.store.get(typeof req === 'string' ? req : req.url);
    return hit ? hit.clone() : undefined;
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
  async match(req: RequestLike | string): Promise<Response | undefined> {
    for (const c of this.caches.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface Scope {
  listeners: Map<string, Listener[]>;
  self: {
    location: { href: string };
    addEventListener(type: string, fn: Listener): void;
    clients: { claim: ReturnType<typeof vi.fn> };
    skipWaiting: ReturnType<typeof vi.fn>;
  };
  caches: FakeCacheStorage;
  fetch: ReturnType<typeof vi.fn>;
  dispatch(type: string, ev: unknown): void;
}

function load(fetchImpl: (req: RequestLike | string) => Promise<Response>): Scope {
  const listeners = new Map<string, Listener[]>();
  const self: Scope['self'] = {
    location: { href: `${BASE}sw.js` },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
  };
  const caches = new FakeCacheStorage();
  const fetch = vi.fn(fetchImpl);
  const run = new Function('self', 'caches', 'fetch', 'Response', 'URL', code) as (...a: unknown[]) => void;
  run(self, caches, fetch, Response, URL);
  return {
    listeners,
    self,
    caches,
    fetch,
    dispatch(type, ev) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
  };
}

function extendable(): { waitUntil(p: Promise<unknown>): void; done: Promise<unknown> } {
  let done: Promise<unknown> = Promise.resolve();
  return {
    waitUntil(p) {
      done = p;
    },
    get done() {
      return done;
    },
  };
}

function fetchEvent(req: RequestLike): { request: RequestLike; respondWith(p: Promise<Response>): void; response: Promise<Response> | null } {
  const ev = {
    request: req,
    response: null as Promise<Response> | null,
    respondWith(p: Promise<Response>) {
      ev.response = p;
    },
  };
  return ev;
}

const ok = (body: string, type = 'application/json'): Response => new Response(body, { status: 200, headers: { 'Content-Type': type } });
const urlOf = (req: RequestLike | string): string => (typeof req === 'string' ? req : req.url);

describe('public/sw.js', () => {
  it('declares a versioned cache name and a page-relative base', () => {
    expect(code).toMatch(/const CACHE_VERSION = '[^']+'/);
    expect(code).toMatch(/new URL\('\.\/', self\.location\.href\)/);
    expect(code).toContain("'SKIP_WAITING'");
  });

  it('install precaches the shell (index.html + manifest) under the versioned cache', async () => {
    const sw = load(async (req) => ok(`<!doctype html>${urlOf(req)}`, 'text/html'));
    const ev = extendable();
    sw.dispatch('install', ev);
    await ev.done;
    const names = await sw.caches.keys();
    expect(names).toEqual([expect.stringMatching(/^tsuzuku-shell-v/)]);
    const shell = sw.caches.caches.get(names[0]!)!;
    expect(shell.store.has(`${BASE}index.html`)).toBe(true);
    expect(shell.store.has(`${BASE}manifest.webmanifest`)).toBe(true);
    expect(shell.store.has(BASE)).toBe(true);
  });

  it('install survives an offline network (nothing cached, no throw)', async () => {
    const sw = load(async () => {
      throw new TypeError('offline');
    });
    const ev = extendable();
    sw.dispatch('install', ev);
    await expect(ev.done).resolves.toBeUndefined();
  });

  it('serves a content request from cache when present, without touching the network', async () => {
    const sw = load(async () => ok('{"fresh":true}'));
    const url = `${BASE}content/vocab/n5/vocab-n5-001.json`;
    const runtime = await sw.caches.open('tsuzuku-runtime-v1');
    await runtime.put(url, ok('{"cached":true}'));
    sw.fetch.mockClear();
    const ev = fetchEvent({ url, method: 'GET', mode: 'cors' });
    sw.dispatch('fetch', ev);
    expect(ev.response).not.toBeNull();
    const res = await ev.response!;
    expect(await res.text()).toBe('{"cached":true}');
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it('a content miss is fetched once, cached, and served from cache the next time', async () => {
    const sw = load(async () => ok('{"n":1}'));
    const url = `${BASE}content/stations/04.json`;
    const first = fetchEvent({ url, method: 'GET' });
    sw.dispatch('fetch', first);
    expect(await (await first.response!).text()).toBe('{"n":1}');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
    // putIfOk is awaited inside cacheFirst, so the cache is populated when the response resolves
    const second = fetchEvent({ url, method: 'GET' });
    sw.dispatch('fetch', second);
    expect(await (await second.response!).text()).toBe('{"n":1}');
    expect(sw.fetch).toHaveBeenCalledTimes(1);
  });

  it('hashed assets and fonts are cache-first too; failed responses are never cached', async () => {
    const sw = load(async (req) => (urlOf(req).endsWith('.woff2') ? new Response('', { status: 404 }) : ok('js')));
    const js = fetchEvent({ url: `${BASE}assets/index-abc123.js`, method: 'GET' });
    sw.dispatch('fetch', js);
    expect((await js.response!).status).toBe(200);
    const font = fetchEvent({ url: `${BASE}fonts/missing.woff2`, method: 'GET' });
    sw.dispatch('fetch', font);
    expect((await font.response!).status).toBe(404);
    const runtime = sw.caches.caches.get('tsuzuku-runtime-v1')!;
    expect(runtime.store.has(`${BASE}assets/index-abc123.js`)).toBe(true);
    expect(runtime.store.has(`${BASE}fonts/missing.woff2`)).toBe(false);
  });

  it('navigations are network-first and fall back to the cached index.html offline', async () => {
    let online = true;
    const sw = load(async () => {
      if (!online) throw new TypeError('offline');
      return ok('<!doctype html>live', 'text/html');
    });
    const nav = fetchEvent({ url: `${BASE}`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', nav);
    expect(await (await nav.response!).text()).toBe('<!doctype html>live');
    online = false;
    const offline = fetchEvent({ url: `${BASE}index.html`, method: 'GET', mode: 'navigate' });
    sw.dispatch('fetch', offline);
    const res = await offline.response!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<!doctype html>live');
  });

  it('ignores non-GET, cross-origin and out-of-scope requests', () => {
    const sw = load(async () => ok('x'));
    const post = fetchEvent({ url: `${BASE}content/x.json`, method: 'POST' });
    sw.dispatch('fetch', post);
    const foreign = fetchEvent({ url: 'https://example.com/content/x.json', method: 'GET' });
    sw.dispatch('fetch', foreign);
    const outside = fetchEvent({ url: `${ORIGIN}/other/content/x.json`, method: 'GET' });
    sw.dispatch('fetch', outside);
    expect(post.response).toBeNull();
    expect(foreign.response).toBeNull();
    expect(outside.response).toBeNull();
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it('activate deletes our caches from other versions, keeps the loader caches, and claims clients', async () => {
    const sw = load(async () => ok('x'));
    await sw.caches.open('tsuzuku-shell-v0');
    await sw.caches.open('tsuzuku-runtime-v0');
    await sw.caches.open('tsuzuku-shell-v1');
    await sw.caches.open('tsuzuku-content-2026.10');
    const ev = extendable();
    sw.dispatch('activate', ev);
    await ev.done;
    const names = (await sw.caches.keys()).sort();
    expect(names).toEqual(['tsuzuku-content-2026.10', 'tsuzuku-shell-v1']);
    expect(sw.self.clients.claim).toHaveBeenCalledTimes(1);
  });

  it('SKIP_WAITING messages call skipWaiting; other messages are ignored', () => {
    const sw = load(async () => ok('x'));
    sw.dispatch('message', { data: { type: 'HELLO' } });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
    sw.dispatch('message', {});
  });
});
