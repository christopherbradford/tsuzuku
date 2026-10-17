/**
 * TSUZUKU — composition root (group A, ARCHITECTURE §0 exception).
 *
 * The ONLY module that may hand `() => Date.now()` to `initStore()` and the
 * only one (with `app/pages.ts`) that imports other groups' barrels:
 *
 *   render(<App overlays={signal}/>)  first paint: the つづく loading mark while the save loads
 *   initStore({slot, now, storage})   → await ready → the Layout and the page render
 *   startPerapera(store)              monthly Perapera snapshot (now + every day:rolled)
 *   startRouter() · registerSw()
 *   installServices(createWebAudio(), createStt())   from @/audio (F), fire-and-forget
 *   loadOverlays() → overlays.value   CeremonyHost from @/art (G), fire-and-forget
 *
 * Nothing but the store blocks first paint (design 07 §9 budgets): audio, the
 * ceremony overlay and the exercise registry load behind it (`pages.ts`
 * fills the registry per route, the Dojo included). Every optional barrel
 * degrades: no audio module → silent `nullAudio`; no art → no ceremonies;
 * the shell itself always renders.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import { installServices } from '@/shared/audio';
import { navigate, route } from '@/shared/routes';
import { initStore, store } from '@/store';
import { startPerapera } from '@/store/derived';
import { S } from '@/i18n/strings';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/arcade.css';
import { App } from './app/App';
import { startRouter } from './app/router';
import { registerSw } from './app/sw-register';
import type { FunctionComponent } from 'preact';

export interface BootOptions {
  /** Defaults to `localStorage` when reachable (the store falls back otherwise). */
  storage?: Storage;
  /** Defaults to the wall clock. */
  now?: () => number;
  /** Save slot (0 = default). */
  slot?: number;
  /** Load `@/audio` and install the real services (default true; tests keep `nullAudio`). */
  audio?: boolean;
  /** Load `@/art` for the ceremony overlay (default true). */
  overlays?: boolean;
  /** Register the service worker (default true; a no-op outside production). */
  sw?: boolean;
}

function browserStorage(): Storage | undefined {
  try {
    const s = globalThis.localStorage;
    // Touching it can throw in locked-down contexts.
    s.getItem('tsuzuku.probe');
    return s;
  } catch {
    return undefined;
  }
}

type AnyModule = Record<string, unknown>;

/**
 * F's audio barrel and G's art barrel, loaded lazily through `import.meta.glob`
 * over their exact paths: Vite code-splits them like a literal `import()`, but a
 * barrel that is not built yet is simply absent instead of a build error.
 */
const OPTIONAL = import.meta.glob<AnyModule>(['/src/audio/index.ts', '/src/art/index.ts']);
export const AUDIO_BARREL = 'src/audio/index.ts';
export const ART_BARREL = 'src/art/index.ts';

async function optional(file: string, what: string): Promise<AnyModule | null> {
  const loader = OPTIONAL[`/${file}`];
  if (!loader) {
    console.warn(`[boot] ${what} unavailable: ${file} is not built yet`);
    return null;
  }
  try {
    return await loader();
  } catch (err) {
    console.warn(`[boot] ${what} unavailable`, err);
    return null;
  }
}

async function installAudio(): Promise<void> {
  const m = await optional(AUDIO_BARREL, 'audio services');
  if (!m) return;
  try {
    const audio = typeof m.createWebAudio === 'function' ? (m.createWebAudio as () => unknown)() : undefined;
    const stt = typeof m.createStt === 'function' ? (m.createStt as () => unknown)() : undefined;
    installServices({
      audio: audio as Parameters<typeof installServices>[0]['audio'],
      stt: stt as Parameters<typeof installServices>[0]['stt'],
    });
  } catch (err) {
    // Silence is a feature, not a crash: nullAudio stays installed.
    console.warn('[boot] audio services failed to start', err);
  }
}

async function loadOverlays(): Promise<FunctionComponent[]> {
  const m = await optional(ART_BARREL, 'ceremonies');
  return m && typeof m.CeremonyHost === 'function' ? [m.CeremonyHost as FunctionComponent] : [];
}

/**
 * A save with no trace of a learner: blank name, or no activity at all.
 * (A fresh save carries the default name 無名, so the name alone cannot tell.)
 */
export function isFirstRun(): boolean {
  const profile = store.profile.value;
  if (profile.name.trim() === '') return true;
  const stats = store.stats.value;
  const streak = store.streak.value;
  return (
    stats.sessions === 0 &&
    streak.totalDays === 0 &&
    profile.xp === 0 &&
    profile.kanaKnown.length === 0 &&
    profile.goals.length === 0 &&
    store.cards.count() === 0
  );
}

let stopRouter: (() => void) | null = null;
let stopPerapera: (() => void) | null = null;

/** Boots the app into `root`. Never throws for optional pieces; the shell always renders. */
export async function boot(root: HTMLElement, o: BootOptions = {}): Promise<void> {
  stopRouter?.();
  stopRouter = null;
  stopPerapera?.();
  stopPerapera = null;
  const now = o.now ?? ((): number => Date.now());

  // Paint first: `store.ready` is false until initStore resolves, so the App
  // shows its loading mark instead of a blank screen while the save loads.
  const overlays = signal<FunctionComponent[]>([]);
  render(<App overlays={overlays} />, root);

  await initStore({ slot: o.slot ?? 0, now, storage: o.storage ?? browserStorage() });
  // store/day.ts leaves the month snapshot to perapera (it needs @/learn, which
  // the store barrel may not import), so the composition root wires it here.
  stopPerapera = startPerapera(store);

  // A brand-new learner lands at Nihonbashi; deep links are left alone.
  if (route.peek().name === 'dojo' && isFirstRun()) navigate({ name: 'onboarding' }, { replace: true });

  stopRouter = startRouter();
  if (o.sw !== false) void registerSw();

  // Behind first paint: audio services and the ceremony overlay.
  if (o.audio !== false) void installAudio();
  if (o.overlays !== false) {
    void loadOverlays().then((list) => {
      overlays.value = list;
    });
  }
}

function showFatal(root: HTMLElement, err: unknown): void {
  console.error('[boot] failed', err);
  const message = err instanceof Error ? err.message : String(err);
  root.replaceChildren();
  const box = document.createElement('section');
  box.className = 'app-error status-window';
  box.setAttribute('role', 'alert');
  const h = document.createElement('h1');
  h.textContent = S.errorTitle;
  const p = document.createElement('p');
  p.textContent = S.errorBody;
  const pre = document.createElement('pre');
  pre.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hanko';
  btn.textContent = S.reload;
  btn.addEventListener('click', () => location.reload());
  box.append(h, p, pre, btn);
  root.appendChild(box);
}

if (import.meta.env.MODE !== 'test' && typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) boot(root).catch((err: unknown) => showFatal(root, err));
}
