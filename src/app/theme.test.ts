import { freshSave, resetStoreForTests, store } from '@/store';
import type { Settings } from '@/shared/store-types';
import { makeTestStore } from '@/store/testing';
import { applyTheme, effectiveTheme, startThemeSync } from './theme';

function settings(over: Partial<Settings> = {}): Settings {
  return { ...freshSave(0, 'UTC').settings, ...over };
}

const html = (): HTMLElement => document.documentElement;
const meta = (): string | null => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

afterEach(() => {
  resetStoreForTests();
  for (const a of ['data-theme', 'data-color-scheme', 'data-feel', 'data-crt', 'data-reduced-motion']) html().removeAttribute(a);
  document.body.className = '';
  document.querySelector('meta[name="theme-color"]')?.remove();
});

describe('effectiveTheme', () => {
  it('auto follows the system preference', () => {
    expect(effectiveTheme(settings({ theme: 'auto' }), true)).toBe('dark');
    expect(effectiveTheme(settings({ theme: 'auto' }), false)).toBe('light');
  });
  it('manual choice overrides the media query', () => {
    expect(effectiveTheme(settings({ theme: 'light' }), true)).toBe('light');
    expect(effectiveTheme(settings({ theme: 'dark' }), false)).toBe('dark');
  });
  it('without matchMedia (jsdom) auto is light', () => {
    expect(effectiveTheme(settings({ theme: 'auto' }))).toBe('light');
  });
});

describe('applyTheme', () => {
  it('auto + dark media → data-theme=auto, color-scheme dark, dark theme-color', () => {
    applyTheme(settings({ theme: 'auto' }), { prefersDark: true });
    expect(html().getAttribute('data-theme')).toBe('auto');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    expect(meta()?.toUpperCase()).toBe('#0B0B10');
  });

  it('manual light overrides dark media', () => {
    applyTheme(settings({ theme: 'light' }), { prefersDark: true });
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().getAttribute('data-color-scheme')).toBe('light');
    expect(meta()?.toUpperCase()).toBe('#F4EDE0');
  });

  it('manual dark sets data-theme=dark', () => {
    applyTheme(settings({ theme: 'dark' }), { prefersDark: false });
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
  });

  it('feel class swaps on body and data-feel on html', () => {
    applyTheme(settings({ feel: 'dojo' }));
    expect(document.body.classList.contains('feel-dojo')).toBe(true);
    expect(html().getAttribute('data-feel')).toBe('dojo');
    applyTheme(settings({ feel: 'arcade' }));
    expect(document.body.classList.contains('feel-arcade')).toBe(true);
    expect(document.body.classList.contains('feel-dojo')).toBe(false);
    expect(html().getAttribute('data-feel')).toBe('arcade');
    applyTheme(settings({ feel: 'zen' }));
    expect(Array.from(document.body.classList).filter((c) => c.startsWith('feel-'))).toEqual(['feel-zen']);
  });

  it('reducedMotion adds the class and the data attribute; removing it removes both', () => {
    applyTheme(settings({ reducedMotion: true }));
    expect(document.body.classList.contains('reduced-motion')).toBe(true);
    expect(html().hasAttribute('data-reduced-motion')).toBe(true);
    applyTheme(settings({ reducedMotion: false }));
    expect(document.body.classList.contains('reduced-motion')).toBe(false);
    expect(html().hasAttribute('data-reduced-motion')).toBe(false);
  });

  it('CRT applies only with the arcade feel', () => {
    applyTheme(settings({ crt: true, feel: 'dojo' }));
    expect(document.body.classList.contains('crt')).toBe(false);
    expect(html().hasAttribute('data-crt')).toBe(false);
    applyTheme(settings({ crt: true, feel: 'arcade' }));
    expect(document.body.classList.contains('crt')).toBe(true);
    expect(html().hasAttribute('data-crt')).toBe(true);
  });

  it('creates the theme-color meta when index.html lacks one and reuses it afterwards', () => {
    expect(meta()).toBeNull();
    applyTheme(settings({ theme: 'dark' }));
    expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
    applyTheme(settings({ theme: 'light' }));
    expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
    expect(meta()?.toUpperCase()).toBe('#F4EDE0');
  });
});

describe('startThemeSync', () => {
  it('follows store.settings and stops after dispose', async () => {
    await makeTestStore({ save: { settings: { feel: 'zen', theme: 'light' } } });
    const stop = startThemeSync({ prefersDark: true });
    expect(html().getAttribute('data-feel')).toBe('zen');
    expect(html().getAttribute('data-theme')).toBe('light');
    store.patch('settings', (s) => ({ ...s, feel: 'arcade', theme: 'auto' }));
    expect(html().getAttribute('data-feel')).toBe('arcade');
    expect(html().getAttribute('data-color-scheme')).toBe('dark');
    stop();
    store.patch('settings', (s) => ({ ...s, feel: 'dojo' }));
    expect(html().getAttribute('data-feel')).toBe('arcade');
  });
});
