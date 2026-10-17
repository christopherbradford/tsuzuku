import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
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
const bodyOf = (sel: string): string =>
  rules
    .filter((r) => r.media === null && r.selector.split(',').some((s) => s.trim() === sel))
    .map((r) => r.body)
    .join('\n');
const hasRule = (cls: string): boolean => rules.some((r) => new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(r.selector));

describe('base.css', () => {
  it('parses: balanced braces and at least a few dozen rules', () => {
    expect((noComments.match(/\{/g) ?? []).length).toBe((noComments.match(/\}/g) ?? []).length);
    expect(rules.length).toBeGreaterThan(40);
  });

  it('imports fonts.css first and declares no @font-face of its own', () => {
    expect(noComments.trimStart().startsWith('@import "./fonts.css";')).toBe(true);
    expect(rules.filter((r) => r.selector === '@font-face')).toHaveLength(0);
  });

  it('fonts.css declares unicode-range slices for the four OFL fonts with swap and a local() fallback', () => {
    const fontsCss = readFileSync(resolve(process.cwd(), 'src/styles/fonts.css'), 'utf8');
    const faces = parse(fontsCss.replace(/\/\*[\s\S]*?\*\//g, '')).filter((r) => r.selector === '@font-face');
    const families = [...new Set(faces.map((f) => /font-family:\s*"([^"]+)"/.exec(f.body)?.[1]))];
    expect(families).toEqual(['DotGothic16', 'Yuji Syuku', 'Shippori Mincho B1', 'Dela Gothic One']);
    // six slices per family: rest (declared first, lowest precedence), n2, n3, n4, n5, base —
    // except the brush family, whose catch-all `rest` face is dropped (fonts.test.ts has the reason)
    expect(faces).toHaveLength(families.length * 6 - 1);
    for (const f of faces) {
      expect(f.body).toMatch(/font-display:\s*swap/);
      expect(f.body).toMatch(/local\(/);
      expect(f.body).toMatch(/url\("\/fonts\/[A-Za-z0-9]+-(rest|n2|n3|n4|n5|base)\.woff2"\)\s*format\("woff2"\)/);
      expect(f.body).toMatch(/unicode-range:\s*U\+[0-9A-F]/);
    }
    // every referenced slice file ships in public/fonts/
    for (const f of faces) {
      const file = /url\("\/fonts\/([^"]+)"\)/.exec(f.body)![1];
      expect(() => readFileSync(resolve(process.cwd(), 'public/fonts', file))).not.toThrow();
    }
  });

  it('font classes reference the token stacks, never literal font names', () => {
    expect(bodyOf('.pixel')).toMatch(/font-family:\s*var\(--font-pixel\)/);
    expect(bodyOf('.brush')).toMatch(/font-family:\s*var\(--font-brush\)/);
    expect(bodyOf('.mincho')).toMatch(/font-family:\s*var\(--font-mincho\)/);
    expect(bodyOf('.neon')).toMatch(/font-family:\s*var\(--font-neon\)/);
    expect(bodyOf('.ja')).toMatch(/font-family:\s*var\(--font-ja\)/);
    expect(bodyOf('.ja')).toMatch(/"palt"/);
    expect(bodyOf('.ja')).toMatch(/line-height:\s*var\(--lh-ja\)/);
    const outsideFontFace = rules.filter((r) => r.selector !== '@font-face').map((r) => r.body).join('\n');
    expect(outsideFontFace).not.toMatch(/font-family:\s*"/);
  });

  it('Japanese wraps between characters under strict kinsoku: word-break normal, never keep-all', () => {
    const ja = bodyOf('.ja');
    expect(ja).toMatch(/word-break:\s*normal/);
    expect(ja).not.toMatch(/keep-all/);
    expect(ja).toMatch(/line-break:\s*strict/);
    expect(ja).toMatch(/overflow-wrap:\s*anywhere/);
    expect(noComments).not.toMatch(/keep-all/);
  });

  it('resets the fieldset border so form groups inherit the theme (no UA groove)', () => {
    const fs = bodyOf('fieldset');
    expect(fs).toMatch(/border:\s*0/);
    expect(fs).toMatch(/padding:\s*0/);
    expect(fs).toMatch(/min-inline-size:\s*0/);
    expect(bodyOf('legend')).toMatch(/padding:\s*0/);
  });

  it('has .visually-hidden / .sr-only, a focusable variant, and 0.5em ruby text', () => {
    expect(hasRule('visually-hidden')).toBe(true);
    expect(hasRule('sr-only')).toBe(true);
    expect(bodyOf('.visually-hidden')).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rules.some((r) => r.selector.includes('.visually-hidden.focusable:focus'))).toBe(true);
    expect(bodyOf('rt')).toMatch(/font-size:\s*0\.5em/);
  });

  it('works at 320 px: body min-width, 16 px gutters via token, 44 px targets via token', () => {
    expect(bodyOf('body')).toMatch(/min-width:\s*320px/);
    expect(bodyOf('.container')).toMatch(/var\(--gutter\)/);
    expect(bodyOf('.touch')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(bodyOf('input[type="range"]')).toMatch(/var\(--touch\)/);
  });

  it('uses no color literals (tokens only)', () => {
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\brgba?\(/);
    expect(noComments).not.toMatch(/\bhsla?\(/);
  });

  it('respects reduced motion (media query and body class) and has print styles', () => {
    expect(rules.some((r) => r.media?.includes('prefers-reduced-motion: reduce') && /animation-duration/.test(r.body))).toBe(true);
    expect(rules.some((r) => r.selector.startsWith('.reduced-motion') && /animation-duration/.test(r.body))).toBe(true);
    expect(rules.some((r) => r.media === '@media print')).toBe(true);
  });

  it('exposes safe-area variables for the shell', () => {
    expect(bodyOf('html')).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom/);
    expect(bodyOf('html')).toMatch(/--safe-top:\s*env\(safe-area-inset-top/);
  });
});
