import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// import.meta.url is an http URL under the jsdom environment; vitest runs from the project root.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

const COLOR_TOKENS = ['--bg', '--surface', '--raised', '--fg', '--fg-muted', '--line', '--shu', '--kin', '--ai', '--sakura', '--matcha', '--neon-c', '--neon-m', '--kon', '--hai', '--focus'];
const INVARIANT = ['--belt-white', '--belt-yellow', '--belt-orange', '--belt-green', '--belt-blue', '--belt-purple', '--belt-brown', '--belt-black', '--bronze', '--silver'];
const FONTS = ['--font-ui', '--font-ja', '--font-pixel', '--font-brush', '--font-mincho', '--font-neon'];
const SIZES = ['--fs-1', '--fs-2', '--fs-3', '--fs-4', '--fs-5', '--fs-6', '--fs-7', '--fs-8'];
const MOTION = ['--ease', '--dur-1', '--dur-2'];
const LAYOUT = ['--gutter', '--touch', '--radius', '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6'];

const LIGHT: Record<string, string> = {
  '--bg': '#F4EDE0', '--surface': '#FFFBF3', '--raised': '#EADFCB', '--fg': '#1A1A1F', '--fg-muted': '#5E5A52', '--line': '#D9CDB6',
  '--shu': '#C9302C', '--kin': '#B8860B', '--ai': '#1F2A6B', '--sakura': '#C9718A', '--matcha': '#4E8A3C', '--neon-c': '#0E8F86',
  '--neon-m': '#B8257A', '--kon': '#1F3A93', '--hai': '#8A8578', '--focus': '#1F2A6B',
};
const DARK: Record<string, string> = {
  '--bg': '#0B0B10', '--surface': '#15151D', '--raised': '#1F1F2A', '--fg': '#F4EDE0', '--fg-muted': '#A9A49A', '--line': '#2C2C3A',
  '--shu': '#E63B2E', '--kin': '#E0B341', '--ai': '#6C7BD9', '--sakura': '#F7B2C4', '--matcha': '#7BB661', '--neon-c': '#2EE6D6',
  '--neon-m': '#FF3DA6', '--kon': '#4F6FD6', '--hai': '#6E6A61', '--focus': '#2EE6D6',
};

/** Returns the body of the first block whose selector line matches. */
function block(selector: string): string {
  const i = css.indexOf(selector);
  expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  throw new Error('unbalanced');
}

function tokensOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('tokens.css', () => {
  const root = tokensOf(block(':root {'));
  const darkAuto = tokensOf(block(':root:not([data-theme="light"])'));
  const darkForced = tokensOf(block(':root[data-theme="dark"]'));

  it('defines every ARCHITECTURE §7 token on :root', () => {
    for (const t of [...COLOR_TOKENS, ...INVARIANT, ...FONTS, ...SIZES, ...MOTION, ...LAYOUT]) expect(root[t], t).toBeTruthy();
    expect(root['--gutter']).toBe('16px');
    expect(root['--touch']).toBe('44px');
    expect(root['--fs-8']).toBe('7.5rem');
    expect(root['--ease']).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('redefines every color token in both dark blocks with the design 01 §4.3 values', () => {
    for (const t of COLOR_TOKENS) {
      expect(root[t]?.toUpperCase(), `light ${t}`).toBe(LIGHT[t]);
      expect(darkAuto[t]?.toUpperCase(), `dark auto ${t}`).toBe(DARK[t]);
      expect(darkForced[t]?.toUpperCase(), `dark forced ${t}`).toBe(DARK[t]);
    }
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  });

  it('belt colors match types.ts and are not redefined in dark', () => {
    expect(root['--belt-black']).toBe('#0B0B10');
    expect(root['--belt-yellow']).toBe('#F2D54A');
    expect(root['--bronze']).toBe('#B87333');
    expect(root['--silver']).toBe('#C9CED6');
    for (const t of INVARIANT) {
      expect(darkAuto[t]).toBeUndefined();
      expect(darkForced[t]).toBeUndefined();
    }
  });

  it('meets contrast: fg/bg ≥ 12:1 and fg-muted/bg ≥ 4.5:1 in both themes', () => {
    for (const theme of [LIGHT, DARK]) {
      expect(contrast(theme['--fg']!, theme['--bg']!)).toBeGreaterThanOrEqual(12);
      expect(contrast(theme['--fg-muted']!, theme['--bg']!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('font stacks use system fallbacks and body has an explicit background', () => {
    for (const f of FONTS) expect(root[f]).toMatch(/(sans-serif|serif|monospace)$/);
    expect(block('body {')).toMatch(/background:\s*var\(--bg\)/);
  });
});
