import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BELTS, BELT_IDS } from '../content/types';
import {
  alpha,
  BELT_HEX,
  contrast,
  darken,
  desaturate,
  fromOklab,
  gradientStops,
  hsl,
  isLight,
  lighten,
  luminance,
  mix,
  mixOklab,
  normalizeHex,
  PALETTE,
  parseHex,
  pickReadable,
  PRESETS,
  ramp,
  readable,
  ringHex,
  saturate,
  shiftHue,
  toHex,
  toHsl,
  toOklab,
  TOKENS,
  token,
} from './color';

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  expect(i).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  let depth = 0;
  let body = '';
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) {
        body = css.slice(open + 1, j);
        break;
      }
    }
  }
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

describe('PALETTE mirrors tokens.css', () => {
  const light = block(':root {');
  const dark = block(':root[data-theme="dark"]');
  it('light theme', () => {
    for (const t of TOKENS) expect(PALETTE.light[t], t).toBe(light[`--${t}`]);
  });
  it('dark theme', () => {
    for (const t of TOKENS) expect(PALETTE.dark[t], t).toBe(dark[`--${t}`]);
  });
  it('belt colors equal BELTS and the --belt-* tokens; rings equal --bronze/--silver, gold = --kin', () => {
    for (const b of BELTS) {
      expect(BELT_HEX[b.id]).toBe(b.color);
      expect(BELT_HEX[b.id]).toBe(light[`--belt-${b.id}`]);
    }
    expect(Object.keys(BELT_HEX).sort()).toEqual([...BELT_IDS].sort());
    expect(ringHex('bronze')).toBe(light['--bronze']);
    expect(ringHex('silver')).toBe(light['--silver']);
    expect(ringHex('gold')).toBe(light['--kin']);
    expect(ringHex('gold', 'dark')).toBe(dark['--kin']);
    expect(token('shu', 'dark')).toBe('#E63B2E');
  });
  it('presets hold valid hex colors', () => {
    for (const list of Object.values(PRESETS)) {
      expect(list.length).toBeGreaterThanOrEqual(4);
      for (const c of list) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('parsing', () => {
  it('accepts #rgb, #rrggbb, #rrggbbaa and rgb()', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#C9302C')).toEqual([201, 48, 44]);
    expect(parseHex('#C9302C80')).toEqual([201, 48, 44]);
    expect(parseHex('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseHex('rgba(1 2 3 / 0.5)')).toEqual([1, 2, 3]);
    expect(parseHex('nonsense')).toEqual([0, 0, 0]);
    expect(toHex(300, -5, 12.6)).toBe('#ff000d');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
  });
});

describe('mixing', () => {
  it('mix endpoints and midpoint', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', -3)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 7)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', Number.NaN)).toBe('#000000');
  });
  it('alpha / lighten / darken / desaturate', () => {
    expect(alpha('#C9302C', 0.5)).toBe('rgba(201,48,44,0.5)');
    expect(alpha('#C9302C', 2)).toBe('rgba(201,48,44,1)');
    expect(lighten('#000000', 1)).toBe('#ffffff');
    expect(darken('#ffffff', 1)).toBe('#000000');
    expect(lighten('#808080', 0)).toBe('#808080');
    const grey = desaturate('#C9302C', 1);
    const [r, g, b] = parseHex(grey);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
  it('ramp and gradientStops', () => {
    expect(ramp('#000000', '#ffffff', 3)).toEqual(['#000000', '#808080', '#ffffff']);
    expect(gradientStops(['#a', '#b', '#c'])).toEqual([
      [0, '#a'],
      [0.5, '#b'],
      [1, '#c'],
    ]);
    expect(gradientStops(['#a'])).toEqual([
      [0, '#a'],
      [1, '#a'],
    ]);
    expect(gradientStops([])).toEqual([]);
  });
  it('hsl round-trips and hue shifts', () => {
    expect(hsl(0, 1, 0.5)).toBe('#ff0000');
    expect(hsl(120, 1, 0.5)).toBe('#00ff00');
    expect(hsl(240, 1, 0.5)).toBe('#0000ff');
    expect(hsl(0, 0, 0.5)).toBe('#808080');
    const [h, s, l] = toHsl('#ff0000');
    expect(h).toBeCloseTo(0);
    expect(s).toBeCloseTo(1);
    expect(l).toBeCloseTo(0.5);
    expect(shiftHue('#ff0000', 120)).toBe('#00ff00');
    expect(saturate('#808080', 1)).toBe('#808080');
    expect(toHsl(saturate('#c08080', -1))[1]).toBeCloseTo(0);
  });
  it('oklab round-trips and mixes without a muddy middle', () => {
    for (const c of ['#C9302C', '#1F3A93', '#F4EDE0', '#0B0B10']) {
      const [L, a, b] = toOklab(c);
      expect(fromOklab(L, a, b)).toBe(c.toLowerCase());
    }
    expect(mixOklab('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixOklab('#000000', '#ffffff', 1)).toBe('#ffffff');
    const mid = mixOklab('#0000ff', '#ffff00', 0.5);
    const srgbMid = mix('#0000ff', '#ffff00', 0.5);
    expect(luminance(mid)).toBeGreaterThan(luminance(srgbMid) * 0.9);
  });
});

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBeCloseTo(0);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21);
    expect(contrast(PALETTE.light.fg, PALETTE.light.bg)).toBeGreaterThanOrEqual(12);
    expect(contrast(PALETTE.dark.fg, PALETTE.dark.bg)).toBeGreaterThanOrEqual(12);
    expect(readable(PALETTE.light['fg-muted'], PALETTE.light.bg)).toBe(true);
    expect(readable('#777777', '#888888')).toBe(false);
  });
  it('pickReadable chooses the most contrasting candidate', () => {
    expect(pickReadable('#0B0B10', ['#1A1A1F', '#F4EDE0', '#C9302C'])).toBe('#F4EDE0');
    expect(pickReadable('#F4EDE0', [])).toBe('#1A1A1F');
    expect(pickReadable('#0B0B10', [])).toBe('#F4EDE0');
    expect(isLight('#F4EDE0')).toBe(true);
    expect(isLight('#0B0B10')).toBe(false);
  });
});
