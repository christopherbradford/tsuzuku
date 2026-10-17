/**
 * params.ts — `splitBunsetsu` over the real grammar corpus (public/content/grammar/**).
 * Skipped when the corpus is not on disk (CI without content). The fixture corpus is
 * too small to catch word-internal particle cuts (ありが|とう), so this reads the files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPlain } from '../content/ruby';
import { isHiragana } from '../shared/jp';
import { PARTICLES, splitBunsetsu } from './params';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'content', 'grammar');

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p));
    else if (f.endsWith('.json')) out.push(p);
  }
  return out.sort();
}

interface GrammarFile {
  items: { id: string; examples: { ja: string }[] }[];
}

/** Words a Scramble tile boundary must never fall inside. */
const WHOLE_WORDS = ['ありがとう', 'ございます', 'ございました', 'ながら', 'とき', 'べからず', 'ともなく', 'いえども'];

describe.skipIf(!existsSync(ROOT))('splitBunsetsu over the grammar corpus', () => {
  it('tiles rejoin to the sentence, never straddle a known word, and a lone kana tile is only an interjection before punctuation', () => {
    let examples = 0;
    for (const file of jsonFiles(ROOT)) {
      const { items } = JSON.parse(readFileSync(file, 'utf8')) as GrammarFile;
      for (const g of items) {
        for (const ex of g.examples) {
          const plain = toPlain(ex.ja);
          const tiles = splitBunsetsu(plain);
          examples++;
          expect(tiles.join(''), `${g.id} rejoin`).toBe(plain);
          const bounds = new Set<number>();
          let at = 0;
          for (const t of tiles) {
            at += t.length;
            bounds.add(at);
          }
          for (const w of WHOLE_WORDS) {
            for (let k = plain.indexOf(w); k >= 0; k = plain.indexOf(w, k + 1)) {
              for (let b = k + 1; b < k + w.length; b++) expect(bounds.has(b), `${g.id}: ${w} cut in 「${plain}」 → ${tiles.join(' | ')}`).toBe(false);
            }
          }
          tiles.forEach((t, i) => {
            if (t.length !== 1 || !isHiragana(t)) return;
            const next = tiles[i + 1] ?? '';
            expect(PARTICLES.includes(t) || /^[、。！？]/.test(next), `${g.id}: lone kana tile 「${t}」 in 「${plain}」 → ${tiles.join(' | ')}`).toBe(true);
          });
        }
      }
    }
    expect(examples).toBeGreaterThan(1000);
  });
});
