import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * fonts.css is generated (scripts/fonts/build-fonts.py) and then hand-trimmed:
 * these checks pin the slicing contract the shell relies on.
 */
const css = readFileSync(resolve(process.cwd(), 'src/styles/fonts.css'), 'utf8');

interface Face {
  family: string;
  file: string;
  range: string;
}

const faces: Face[] = Array.from(css.matchAll(/@font-face \{([^}]*)\}/g), (m) => {
  const body = m[1]!;
  return {
    family: /font-family: "([^"]+)"/.exec(body)![1]!,
    file: /url\("\/fonts\/([^"]+)"\)/.exec(body)![1]!,
    range: /unicode-range: ([^;]+);/.exec(body)![1]!,
  };
});

const slice = (file: string): string => /-(base|n5|n4|n3|n2|rest)\.woff2$/.exec(file)![1]!;
const byFamily = (family: string): Face[] => faces.filter((f) => f.family === family);

describe('fonts.css slices', () => {
  it('declares the four families, each with base + the four JLPT level slices', () => {
    for (const family of ['DotGothic16', 'Yuji Syuku', 'Shippori Mincho B1', 'Dela Gothic One']) {
      const slices = byFamily(family).map((f) => slice(f.file));
      expect(slices, family).toEqual(expect.arrayContaining(['base', 'n5', 'n4', 'n3', 'n2']));
    }
  });

  it('the brush family (Yuji Syuku) ships no catch-all `rest` face: shell chrome and proper names never pull 815 KB of non-corpus kanji', () => {
    const yuji = byFamily('Yuji Syuku');
    expect(yuji.some((f) => slice(f.file) === 'rest')).toBe(false);
    expect(yuji.some((f) => f.range.includes('U+4E00-9FFF'))).toBe(false);
  });

  it('where a `rest` face exists it is declared first (lowest precedence) and the level slices use explicit code points', () => {
    for (const family of ['DotGothic16', 'Shippori Mincho B1', 'Dela Gothic One']) {
      const list = byFamily(family);
      expect(slice(list[0]!.file), family).toBe('rest');
      expect(slice(list[list.length - 1]!.file), family).toBe('base');
      for (const f of list.filter((x) => /^n[2-5]$/.test(slice(x.file)))) expect(f.range, f.file).not.toMatch(/U\+4E00-9FFF/);
    }
  });
});
