import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
const header = /\/\*[\s\S]*?\*\//.exec(css)?.[0] ?? '';
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

const rules = parse(noComments);
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasRule = (cls: string): boolean => rules.some((r) => new RegExp(`\\.${escape(cls)}(?![\\w-])`).test(r.selector));
const bodyOf = (sel: string): string =>
  rules
    .filter((r) => r.media === null && r.selector.split(',').some((s) => s.trim() === sel))
    .map((r) => r.body)
    .join('\n');

/** Class names listed after `CLASSES:` in the header comment. */
function headerClasses(): string[] {
  const start = header.indexOf('CLASSES:');
  expect(start).toBeGreaterThan(0);
  const rest = header.slice(start + 'CLASSES:'.length);
  const end = rest.search(/\n \*\s*\n/);
  const list = end >= 0 ? rest.slice(0, end) : rest;
  return Array.from(list.matchAll(/\.([a-z][a-z0-9_-]*)/g), (m) => m[1]!);
}

const CONTRACT = ['status-window', 'hanko', 'btn', 'chip', 'combo', 'tategaki', 'judge-card', 'forge-bar', 'scroll-card', 'road-nav', 'seal'];

describe('components.css', () => {
  it('every class named in the header comment has a rule', () => {
    const classes = headerClasses();
    expect(classes.length).toBeGreaterThan(30);
    const missing = classes.filter((c) => !hasRule(c));
    expect(missing).toEqual([]);
  });

  it('declares the shared class contract src/shared/ui/ui.css expects', () => {
    for (const c of CONTRACT) expect(hasRule(c), c).toBe(true);
    expect(hasRule('btn--ghost')).toBe(true);
    expect(hasRule('chip--kiai')).toBe(true);
    expect(hasRule('chip--tag')).toBe(true);
    expect(hasRule('hanko--lg')).toBe(true);
    expect(hasRule('forge-bar__fill')).toBe(true);
  });

  it('uses no color literals outside tokens.css', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/\bhsla?\(/);
  });

  it('motion stays within 60–240 ms and honors reduced motion', () => {
    const durations = Array.from(noComments.matchAll(/(\d+)ms/g), (m) => Number(m[1]));
    expect(durations.length).toBeGreaterThan(3);
    for (const d of durations) {
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(240);
    }
    const reducedMedia = rules.filter((r) => r.media?.includes('prefers-reduced-motion: reduce'));
    const reducedClass = rules.filter((r) => r.selector.startsWith('.reduced-motion'));
    expect(reducedMedia.length).toBeGreaterThan(0);
    expect(reducedClass.length).toBeGreaterThan(0);
    // every animated selector is covered by both override paths, except opacity-only fades,
    // which design 01 §4.5 keeps under reduced motion
    const keyframeProps = (name: string): Set<string> => {
      const kf = rules.find((r) => r.selector === `@keyframes ${name}`);
      return new Set(Array.from(kf?.body.matchAll(/([a-z-]+)\s*:/g) ?? [], (m) => m[1]!));
    };
    const opacityOnly = (name: string): boolean => {
      const props = keyframeProps(name);
      return props.size > 0 && [...props].every((p) => p === 'opacity');
    };
    const animated = rules
      .filter((r) => r.media === null && !r.selector.startsWith('.reduced-motion') && /animation:\s*[a-z-]+\s/.test(r.body))
      .filter((r) => !opacityOnly(/animation:\s*([a-z-]+)/.exec(r.body)![1]!))
      .flatMap((r) => r.selector.split(',').map((s) => s.trim()));
    expect(animated.length).toBeGreaterThan(0);
    expect(opacityOnly('fade-in')).toBe(true);
    const mediaSel = reducedMedia.flatMap((r) => r.selector.split(',').map((s) => s.trim()));
    const classSel = reducedClass.flatMap((r) => r.selector.split(',').map((s) => s.trim().replace(/^\.reduced-motion\s+/, '')));
    for (const sel of animated) {
      expect(mediaSel, `media override for ${sel}`).toContain(sel);
      expect(classSel, `.reduced-motion override for ${sel}`).toContain(sel);
    }
  });

  it('Status Window: double border, notched corners, 92% raised', () => {
    const b = bodyOf('.status-window');
    expect(b).toMatch(/border:\s*2px double/);
    expect(b).toMatch(/clip-path:\s*polygon/);
    expect(b).toMatch(/color-mix\(in srgb, var\(--raised\) 92%/);
  });

  it('Hanko Button: vermilion, press scale 0.96, ink-bleed keyframes', () => {
    expect(bodyOf('.hanko')).toMatch(/background:\s*var\(--shu\)/);
    expect(bodyOf('.hanko:active')).toMatch(/scale\(0\.96\)/);
    expect(rules.some((r) => r.selector === '@keyframes ink-bleed')).toBe(true);
  });

  it('Combo scales by tier; Zen hides it', () => {
    expect(bodyOf('.combo[data-tier="3"]')).toMatch(/scale\(1\.3\)/);
    expect(rules.some((r) => r.selector.includes('.feel-zen .combo'))).toBe(true);
  });

  it('Tategaki is vertical; belts cover all eight colors; nav marks aria-current', () => {
    expect(bodyOf('.tategaki')).toMatch(/writing-mode:\s*vertical-rl/);
    for (const b of ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']) {
      expect(hasRule(`belt--${b}`), b).toBe(true);
      expect(noComments).toContain(`var(--belt-${b})`);
    }
    expect(rules.some((r) => r.selector.includes('.nav__item[aria-current="page"]'))).toBe(true);
  });

  it('touch targets: buttons and nav items use the 44 px token', () => {
    expect(bodyOf('.btn')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(bodyOf('.nav__item')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(bodyOf('.list__item')).toMatch(/min-height:\s*var\(--touch\)/);
  });
});
