/**
 * TSUZUKU — theme / feel applier (group A, ARCHITECTURE §7, design 01 §4.3, §6).
 *
 * Writes the learner's `settings` onto the document so CSS can react:
 *   <html data-theme="auto|light|dark" data-color-scheme="light|dark"
 *         data-feel="zen|dojo|arcade" data-crt data-reduced-motion>
 *   <body class="feel-zen|feel-dojo|feel-arcade [crt] [reduced-motion]">
 *   <meta name="theme-color" content=…>   (the effective --bg)
 *
 * `auto` follows `prefers-color-scheme`; tokens.css applies the dark palette
 * under the media query unless `data-theme="light"`, and always under
 * `data-theme="dark"`, so the attribute alone is enough for colors. The
 * effective scheme is still written (`data-color-scheme`) for canvases and
 * art that need to know, and for the theme-color meta.
 */
import { effect } from '@preact/signals';
import { store } from '@/store';
import type { Feel, Settings } from '@/shared/store-types';

export const FEELS: readonly Feel[] = ['zen', 'dojo', 'arcade'];

/** `--bg` per scheme (mirrors tokens.css; used only when computed styles are unavailable). */
const BG_FALLBACK = { light: '#F4EDE0', dark: '#0B0B10' } as const;
const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeEnv {
  /** Defaults to `document`. */
  doc?: Document;
  /** Overrides the media query (tests); `undefined` = ask `matchMedia`. */
  prefersDark?: boolean;
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' ? matchMedia(DARK_QUERY).matches : false;
  } catch {
    return false;
  }
}

/** The scheme the learner actually sees. */
export function effectiveTheme(s: Settings, prefersDark?: boolean): 'light' | 'dark' {
  if (s.theme === 'light' || s.theme === 'dark') return s.theme;
  return (prefersDark ?? systemPrefersDark()) ? 'dark' : 'light';
}

function readBg(doc: Document, scheme: 'light' | 'dark'): string {
  try {
    const view = doc.defaultView;
    const v = view ? view.getComputedStyle(doc.documentElement).getPropertyValue('--bg').trim() : '';
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  } catch {
    /* jsdom or detached document */
  }
  return BG_FALLBACK[scheme];
}

function setMetaThemeColor(doc: Document, color: string): void {
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    if (!doc.head) return;
    meta = doc.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    doc.head.appendChild(meta);
  }
  if (meta.getAttribute('content') !== color) meta.setAttribute('content', color);
}

/** Applies theme, feel, CRT and reduced-motion to `<html>` / `<body>`. Idempotent. */
export function applyTheme(s: Settings, env: ThemeEnv = {}): void {
  const doc = env.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  const html = doc.documentElement;
  const body = doc.body;
  const scheme = effectiveTheme(s, env.prefersDark);
  const feel: Feel = FEELS.includes(s.feel) ? s.feel : 'dojo';
  // CRT scanlines live on arcade screens only (design 01 §4.4).
  const crt = Boolean(s.crt) && feel === 'arcade';
  const reduced = Boolean(s.reducedMotion);

  html.setAttribute('data-theme', s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto');
  html.setAttribute('data-color-scheme', scheme);
  html.setAttribute('data-feel', feel);
  if (crt) html.setAttribute('data-crt', '');
  else html.removeAttribute('data-crt');
  if (reduced) html.setAttribute('data-reduced-motion', '');
  else html.removeAttribute('data-reduced-motion');

  if (body) {
    for (const f of FEELS) body.classList.toggle(`feel-${f}`, f === feel);
    body.classList.toggle('crt', crt);
    body.classList.toggle('reduced-motion', reduced);
  }

  setMetaThemeColor(doc, readBg(doc, scheme));
}

/**
 * Keeps the document in sync with `store.settings` and with the system
 * scheme while `theme: 'auto'`. Returns a disposer.
 */
export function startThemeSync(env: ThemeEnv = {}): () => void {
  const dispose = effect(() => {
    applyTheme(store.settings.value, env);
  });
  let mql: MediaQueryList | null = null;
  const onChange = (): void => applyTheme(store.settings.peek(), env);
  try {
    if (typeof matchMedia === 'function') {
      mql = matchMedia(DARK_QUERY);
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    }
  } catch {
    mql = null;
  }
  return () => {
    dispose();
    if (mql && typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
  };
}
