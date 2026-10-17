import { SW_SCOPE, SW_URL, applySwUpdate, dismissSwUpdate, registerSw, resetSwForTests, swOfflineReady, swUpdate } from './sw-register';

type Listener = (ev?: unknown) => void;

interface FakeWorker {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
  listeners: Record<string, Listener[]>;
  addEventListener(type: string, fn: Listener): void;
}
interface FakeReg {
  waiting: FakeWorker | null;
  installing: FakeWorker | null;
  listeners: Record<string, Listener[]>;
  addEventListener(type: string, fn: Listener): void;
  update: ReturnType<typeof vi.fn>;
}
interface FakeContainer {
  controller: object | null;
  register: ReturnType<typeof vi.fn>;
  listeners: Record<string, Listener[]>;
  addEventListener(type: string, fn: Listener): void;
}

function worker(state = 'installing'): FakeWorker {
  const w: FakeWorker = {
    state,
    postMessage: vi.fn(),
    listeners: {},
    addEventListener(type, fn) {
      (w.listeners[type] ??= []).push(fn);
    },
  };
  return w;
}

function registration(over: Partial<FakeReg> = {}): FakeReg {
  const r: FakeReg = {
    waiting: null,
    installing: null,
    listeners: {},
    addEventListener(type, fn) {
      (r.listeners[type] ??= []).push(fn);
    },
    update: vi.fn(async () => undefined),
    ...over,
  };
  return r;
}

function container(reg: FakeReg, controller: object | null = null): FakeContainer {
  const c: FakeContainer = {
    controller,
    register: vi.fn(async () => reg),
    listeners: {},
    addEventListener(type, fn) {
      (c.listeners[type] ??= []).push(fn);
    },
  };
  return c;
}

const asContainer = (c: FakeContainer): ServiceWorkerContainer => c as unknown as ServiceWorkerContainer;
const fire = (ls: Record<string, Listener[]>, type: string): void => (ls[type] ?? []).forEach((fn) => fn());

beforeEach(() => resetSwForTests());

describe('registerSw', () => {
  it('is a no-op when navigator.serviceWorker is unavailable', async () => {
    await expect(registerSw({ prod: true, container: null, doc: null })).resolves.toBeUndefined();
    expect(swUpdate.value).toBe(false);
  });

  it('is a no-op outside production builds', async () => {
    const c = container(registration());
    await registerSw({ prod: false, container: asContainer(c), doc: null });
    expect(c.register).not.toHaveBeenCalled();
  });

  it('registers ./sw.js with a page-relative scope', async () => {
    const c = container(registration());
    await registerSw({ prod: true, container: asContainer(c), doc: null });
    expect(c.register).toHaveBeenCalledTimes(1);
    const [url, opts] = c.register.mock.calls[0] as [string, RegistrationOptions];
    expect(url).toBe(SW_URL);
    expect(url.startsWith('/')).toBe(false);
    expect(url.startsWith('./')).toBe(true);
    expect(opts.scope).toBe(SW_SCOPE);
    expect(SW_SCOPE.startsWith('/')).toBe(false);
  });

  it('never throws when registration fails', async () => {
    const c = container(registration());
    c.register = vi.fn(async () => {
      throw new Error('insecure context');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(registerSw({ prod: true, container: asContainer(c), doc: null })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a new worker installed behind a controlled page raises swUpdate; the first install raises swOfflineReady', async () => {
    const reg = registration();
    const c = container(reg, null);
    await registerSw({ prod: true, container: asContainer(c), doc: null });

    // first install: no controller yet → offline ready
    const first = worker();
    reg.installing = first;
    fire(reg.listeners, 'updatefound');
    first.state = 'installed';
    fire(first.listeners, 'statechange');
    expect(swOfflineReady.value).toBe(true);
    expect(swUpdate.value).toBe(false);

    // later update: a controller exists → update available
    c.controller = {};
    const second = worker();
    reg.installing = second;
    fire(reg.listeners, 'updatefound');
    second.state = 'installed';
    fire(second.listeners, 'statechange');
    expect(swUpdate.value).toBe(true);

    dismissSwUpdate();
    expect(swUpdate.value).toBe(false);
  });

  it('a worker already waiting at registration raises swUpdate; applySwUpdate posts SKIP_WAITING and reloads on controllerchange', async () => {
    const waiting = worker('installed');
    const reg = registration({ waiting });
    const c = container(reg, {});
    const reload = vi.fn();
    await registerSw({ prod: true, container: asContainer(c), doc: null, reload });
    expect(swUpdate.value).toBe(true);

    applySwUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();

    fire(c.listeners, 'controllerchange');
    fire(c.listeners, 'controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the first install (clients.claim fires controllerchange) never reloads the page on its own', async () => {
    const reg = registration();
    const c = container(reg, null);
    const reload = vi.fn();
    await registerSw({ prod: true, container: asContainer(c), doc: null, reload });
    const first = worker();
    reg.installing = first;
    fire(reg.listeners, 'updatefound');
    first.state = 'installed';
    fire(first.listeners, 'statechange');
    first.state = 'activated';
    fire(first.listeners, 'statechange');
    c.controller = first;
    fire(c.listeners, 'controllerchange');
    expect(reload).not.toHaveBeenCalled();
    expect(swOfflineReady.value).toBe(true);

    // The learner later asks for an update: the same event now reloads exactly once.
    const waiting = worker('installed');
    reg.waiting = waiting;
    applySwUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    fire(c.listeners, 'controllerchange');
    fire(c.listeners, 'controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('applySwUpdate without a waiting worker falls back to a plain reload', async () => {
    const reload = vi.fn();
    await registerSw({ prod: true, container: asContainer(container(registration())), doc: null, reload });
    applySwUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks for updates when the page becomes visible', async () => {
    const reg = registration();
    const c = container(reg);
    await registerSw({ prod: true, container: asContainer(c), doc: document });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reg.update).toHaveBeenCalledTimes(1);
  });
});
