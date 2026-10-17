import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/arcade.css'), 'utf8');
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selector: string;
  body: string;
  media: string | null;
}

function parse(text: string, media: string | null = null, out: Rule[] = []): Rule[] {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(selector)) parse(body, selector, out);
    else out.push({ selector, body, media });
    i = j;
  }
  return out;
}

const GATE = ':is(:root[data-feel="arcade"], body.feel-arcade)';
const rules = parse(noComments);
const styleRules = rules.filter((r) => !r.selector.startsWith('@keyframes'));
const keyframes = rules.filter((r) => r.selector.startsWith('@keyframes')).map((r) => r.selector.replace('@keyframes', '').trim());

/** Splits a selector list on top-level commas only (`:is(a, b) .x, .y` → 2 selectors). */
function selectors(r: Rule): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of r.selector) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Strips the arcade gate / reduced-motion prefix so overrides can be matched to their targets. */
const core = (sel: string): string => sel.replace(new RegExp(`^${GATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '').replace(/^body\.reduced-motion\s+/, '');

const animatedRules = styleRules.filter((r) => r.media === null && !r.selector.startsWith('body.reduced-motion') && /animation(-name)?:\s*(?!none)[a-z-]/.test(r.body));

describe('arcade.css', () => {
  it('parses and defines keyframes for every animation it uses', () => {
    expect((noComments.match(/\{/g) ?? []).length).toBe((noComments.match(/\}/g) ?? []).length);
    expect(keyframes.length).toBeGreaterThan(3);
    for (const r of animatedRules) {
      const name = /animation:\s*([a-z-]+)/.exec(r.body)?.[1];
      expect(keyframes, `keyframes for ${r.selector}`).toContain(name);
    }
  });

  it('every animation declares a duration ≥ 334 ms (nothing flashes above 3 Hz)', () => {
    expect(animatedRules.length).toBeGreaterThan(3);
    for (const r of animatedRules) {
      const ms = Array.from(r.body.matchAll(/animation[^;]*?(\d+)ms/g), (m) => Number(m[1]));
      expect(ms.length, `duration in ${r.selector}`).toBeGreaterThan(0);
      for (const d of ms) expect(d, r.selector).toBeGreaterThanOrEqual(334);
    }
    // alternating animations: a full on/off cycle is two iterations, still ≤ 3 Hz
    for (const r of animatedRules) {
      if (/alternate/.test(r.body)) {
        const d = Number(/(\d+)ms/.exec(r.body)?.[1]);
        expect(d * 2).toBeGreaterThanOrEqual(668);
      }
    }
  });

  it('every animated selector has a reduced-motion override via the media query AND body.reduced-motion', () => {
    const mediaOverrides = new Set(
      styleRules
        .filter((r) => r.media?.includes('prefers-reduced-motion: reduce') && /animation:\s*none/.test(r.body))
        .flatMap((r) => selectors(r).map(core)),
    );
    const classOverrides = new Set(
      styleRules
        .filter((r) => r.media === null && r.selector.startsWith('body.reduced-motion') && /animation:\s*none/.test(r.body))
        .flatMap((r) => selectors(r).map(core)),
    );
    expect(mediaOverrides.size).toBeGreaterThan(0);
    expect(classOverrides.size).toBeGreaterThan(0);
    for (const r of animatedRules) {
      for (const sel of selectors(r).map(core)) {
        expect(mediaOverrides, `media override for ${sel}`).toContain(sel);
        expect(classOverrides, `body.reduced-motion override for ${sel}`).toContain(sel);
      }
    }
  });

  it('everything is gated by the arcade feel (or is a reduced-motion override)', () => {
    for (const r of styleRules) {
      for (const sel of selectors(r)) {
        const gated = sel.startsWith(GATE) || sel.startsWith('body.reduced-motion');
        expect(gated, sel).toBe(true);
      }
    }
  });

  it('ships the documented classes: .crt .glow-edge .speed-lines .halftone and the Kiai / Ippon / combo effects', () => {
    for (const c of ['crt', 'glow-edge', 'speed-lines', 'halftone', 'ippon-flash', 'combo-pop', 'ki-glow', 'hiscore', 'arcade-head']) {
      expect(styleRules.some((r) => new RegExp(`\\.${c}(?![\\w-])`).test(r.selector)), c).toBe(true);
    }
    const crt = styleRules.find((r) => r.selector === `${GATE} .crt::after`);
    expect(crt?.body).toMatch(/repeating-linear-gradient/);
    const offset = styleRules.find((r) => r.selector.includes('.crt .crt > *') || r.selector.includes('body.crt .crt > *'));
    expect(offset?.body).toMatch(/text-shadow:\s*\n?\s*1px 0 0/);
  });

  it('uses no color literals (tokens only)', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/\bhsla?\(/);
  });
});
