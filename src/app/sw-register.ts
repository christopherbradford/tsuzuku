/**
 * TSUZUKU — service-worker registration (group A, design 07 §10).
 *
 * Registers `./sw.js` with a page-relative scope so the app works under
 * `/<repo>/` on GitHub Pages. Only in production builds and only where the
 * browser supports it; never blocks or throws out of boot.
 *
 * Updates are learner-driven: when a new worker is installed behind a live
 * page, `swUpdate` turns true and the Layout shows a quiet toast with a
 * reload button. `applySwUpdate()` tells the waiting worker to take over and
 * reloads once it controls the page. Nothing here reloads on its own.
 */
import { signal, type Signal } from '@preact/signals';

export const SW_URL = './sw.js';
export const SW_SCOPE = './';

/** A new version is installed and waiting. */
export const swUpdate: Signal<boolean> = signal(false);
/** The first worker finished installing: the shell now works offline. */
export const swOfflineReady: Signal<boolean> = signal(false);

export interface SwEnv {
  /** Defaults to `import.meta.env.PROD`. */
  prod?: boolean;
  /** Defaults to `navigator.serviceWorker`; `null` = unsupported. */
  container?: ServiceWorkerContainer | null;
  /** Defaults to `location.reload()`. */
  reload?: () => void;
  /** Defaults to `document` (visibility-triggered update checks). */
  doc?: Document | null;
}

let registration: ServiceWorkerRegistration | null = null;
let reloadFn: () => void = () => {
  if (typeof location !== 'undefined') location.reload();
};
let reloading = false;

function defaultContainer(): ServiceWorkerContainer | null {
  try {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  } catch {
    return null;
  }
}

function watchInstalling(reg: ServiceWorkerRegistration, container: ServiceWorkerContainer): void {
  const worker = reg.installing;
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state !== 'installed') return;
    if (container.controller) swUpdate.value = true;
    else swOfflineReady.value = true;
  });
}

/** Registers the worker. Resolves without doing anything outside production or without support. */
export async function registerSw(env: SwEnv = {}): Promise<void> {
  const prod = env.prod ?? Boolean(import.meta.env.PROD);
  const container = env.container === undefined ? defaultContainer() : env.container;
  if (env.reload) reloadFn = env.reload;
  if (!prod || !container || typeof container.register !== 'function') return;
  try {
    const reg = await container.register(SW_URL, { scope: SW_SCOPE, updateViaCache: 'none' });
    registration = reg;
    if (reg.waiting && container.controller) swUpdate.value = true;
    if (reg.installing) watchInstalling(reg, container);
    reg.addEventListener('updatefound', () => watchInstalling(reg, container));
    container.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      reloadFn();
    });
    const doc = env.doc === undefined ? (typeof document !== 'undefined' ? document : null) : env.doc;
    if (doc) {
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible') reg.update().catch(() => undefined);
      });
    }
  } catch (err) {
    // A failed registration is a quieter app, not a broken one.
    console.warn('[sw] registration failed', err);
  }
}

/** Learner pressed "Reload to update": activate the waiting worker; the page reloads on controllerchange. */
export function applySwUpdate(): void {
  const waiting = registration?.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  // No waiting worker (already activated elsewhere): a plain reload picks it up.
  reloadFn();
}

export function dismissSwUpdate(): void {
  swUpdate.value = false;
}

/** Tests: forget the registration and reset the signals. */
export function resetSwForTests(): void {
  registration = null;
  reloading = false;
  swUpdate.value = false;
  swOfflineReady.value = false;
  reloadFn = () => {
    if (typeof location !== 'undefined') location.reload();
  };
}
