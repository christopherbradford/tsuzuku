import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate, formatReport, moraCount } from './validate-content.ts';
import type { Finding, ValidateResult } from './validate-content.ts';
import { assign } from './assign-stations.ts';
import type { PlanEntry } from './assign-stations.ts';
import { writeIndex } from './build-content-index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GOOD = join(here, '__fixtures__', 'good');
const PLAN = JSON.parse(readFileSync(join(here, '__fixtures__', 'plan-good.json'), 'utf8')) as PlanEntry[];

type Json = Record<string, unknown>;
const tmps: string[] = [];

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tsuzuku-validate-'));
  cpSync(GOOD, dir, { recursive: true });
  tmps.push(dir);
  return dir;
}

function mutate(root: string, rel: string, fn: (doc: Json) => void): void {
  const p = join(root, rel);
  const doc = JSON.parse(readFileSync(p, 'utf8')) as Json;
  fn(doc);
  writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
}

function item(doc: Json, i = 0): Json {
  return (doc['items'] as Json[])[i]!;
}

function rules(findings: Finding[]): string[] {
  return [...new Set(findings.map((f) => f.rule))].sort();
}

/** Assign stations and build the manifest so strict rules (V20/V34–V36) run against bundles. */
function pipeline(root: string): void {
  assign(root, PLAN, { write: true, allowlistsDir: join(root, '..', `${root.split('/').pop()}-allowlists`) });
  writeIndex(root, '1.0.0', { generatedAt: '2026-10-17T00:00:00.000Z' });
}

function expectRule(result: ValidateResult, rule: string): void {
  const hit = result.failures.filter((f) => f.rule === rule);
  if (hit.length === 0) throw new Error(`expected a ${rule} failure; got ${JSON.stringify(rules(result.failures))}\n${formatReport(result, '')}`);
}

afterAll(() => {
  for (const d of tmps) {
    rmSync(d, { recursive: true, force: true });
    rmSync(`${d}-allowlists`, { recursive: true, force: true });
  }
});

describe('validate — good fixture', () => {
  it('passes with no failures (bundles absent → V20/V34 only warn)', () => {
    const root = copyFixture();
    const r = validate(root);
    expect(r.failures).toEqual([]);
    expect(r.files).toBe(9);
    expect(r.bundles).toBe(false);
    expect(rules(r.warnings)).toContain('V20');
    expect(rules(r.warnings)).toContain('V34');
  });

  it('passes strict after assign + index except the quota rule (tiny corpus) and keeps V35 green', () => {
    const root = copyFixture();
    pipeline(root);
    const r = validate(root, { strict: true });
    expect(r.bundles).toBe(true);
    expect(rules(r.failures)).toEqual(['V34']);
    expect(r.linked).toBe(12);
  });

  it('formatReport prints a grouped report with totals', () => {
    const root = copyFixture();
    const text = formatReport(validate(root), root);
    expect(text).toMatch(/TOTAL: 0 failures/);
    expect(text).toContain('kana/hiragana.json');
  });

  it('moraCount attaches small kana', () => {
    expect(moraCount('きゃく')).toBe(2);
    expect(moraCount('がっこう')).toBe(4);
    expect(moraCount('コーヒー')).toBe(4);
  });
});

describe('validate — one failing fixture per rule', () => {
  it('V01 envelope', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      d['schema'] = 'tsuzuku.content/0';
    });
    expectRule(validate(root), 'V01');
  });

  it('V01 level present iff path has a level segment', () => {
    const root = copyFixture();
    mutate(root, 'kana/hiragana.json', (d) => {
      d['level'] = 'kana';
    });
    expectRule(validate(root), 'V01');
  });

  it('V02 item count (and _meta exempt from the cap)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      d['items'] = [];
    });
    const r = validate(root);
    expectRule(r, 'V02');
    const root2 = copyFixture();
    mutate(root2, '_meta/components.json', (d) => {
      const items = d['items'] as Json[];
      for (let i = 0; i < 160; i++) items.push({ id: `c-x${i}`.replace(/\d/g, (n) => 'abcdefghij'[Number(n)]!), char: '卜', name: `x${i}`.replace(/\d/g, (n) => 'abcdefghij'[Number(n)]!) });
    });
    expect(validate(root2).failures.filter((f) => f.rule === 'V02')).toEqual([]);
  });

  it('V03 shape (unknown key, null, empty string)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['bogus'] = 1;
      item(d, 1)['notes'] = null;
      item(d, 2)['notes'] = '';
    });
    const r = validate(root);
    const msgs = r.failures.filter((f) => f.rule === 'V03').map((f) => f.message);
    expect(msgs.some((m) => m.includes('unknown key bogus'))).toBe(true);
    expect(msgs.some((m) => m.includes('null'))).toBe(true);
    expect(msgs.some((m) => m.includes('empty string'))).toBe(true);
  });

  it('V04 id grammar', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['id'] = 'v-n5-1';
    });
    expectRule(validate(root), 'V04');
  });

  it('V05 id consistency (duplicate id, jlpt mismatch, kanji id ≠ char)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 1)['id'] = 'v-n5-0001';
      item(d, 2)['jlpt'] = 4;
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['char'] = '月';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V05').length).toBeGreaterThanOrEqual(3);
  });

  it('V06 references resolve', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['kanjiIds'] = ['j-龍'];
    });
    expectRule(validate(root), 'V06');
  });

  it('V07 enums (pos, tag, component name)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pos'] = 'verb';
      item(d, 1)['tags'] = ['people', 'neutral'];
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['components'] = ['moon'];
      item(d)['mnemonic'] = 'A MOON in the window.';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V07').length).toBeGreaterThanOrEqual(3);
  });

  it('V08 path grammar and sequence gaps', () => {
    const root = copyFixture();
    renameSync(join(root, 'vocab/n5/vocab-n5-001.json'), join(root, 'vocab/n5/vocab-n5-002.json'));
    expectRule(validate(root), 'V08');
    const root2 = copyFixture();
    mkdirSync(join(root2, 'stories/n4'), { recursive: true });
    renameSync(join(root2, 'stories/n5/stories-s04.json'), join(root2, 'stories/n4/stories-s04.json'));
    expectRule(validate(root2), 'V08');
  });

  it('V10 kana-only fields', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['kana'] = '私';
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['on'] = ['にち'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V10').length).toBeGreaterThanOrEqual(2);
  });

  it('V11 ruby well-formed', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['ja'] = '{私|わたし}は{学生|がく|せい}です。';
    });
    expectRule(validate(root), 'V11');
  });

  it('V12 bare kanji / ruby in plain field', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['ja'] = '私は{学生|がくせい}です。';
      item(d, 1)['word'] = '{先生|せんせい}';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V12').length).toBeGreaterThanOrEqual(2);
  });

  it('V13 reconstruction', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['kana'] = 'わたしはがくせいでした。';
    });
    expectRule(validate(root), 'V13');
  });

  it('V14 counts', () => {
    const root = copyFixture();
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      (item(d)['examples'] as Json[]).pop();
    });
    mutate(root, 'grammar/n5/grammar-n5-001.json', (d) => {
      item(d)['mistakes'] = ['書くください → 書いてください'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V14').length).toBeGreaterThanOrEqual(2);
  });

  it('V15 length caps', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['notes'] = 'x'.repeat(201);
      (item(d, 1)['examples'] as Json[])[0]!['ja'] = 'あ'.repeat(26);
      (item(d, 1)['examples'] as Json[])[0]!['kana'] = 'あ'.repeat(26);
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V15').length).toBeGreaterThanOrEqual(2);
  });

  it('V16 target presence', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d, 4)['examples'] as Json[])[0] = { ja: 'これは{水|みず}です。', kana: 'これはみずです。', en: 'This is water.' };
    });
    expectRule(validate(root), 'V16');
  });

  it('V17 mnemonic mentions every component', () => {
    const root = copyFixture();
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d, 2)['mnemonic'] = 'The monks read the TIME from a shadow.';
    });
    expectRule(validate(root), 'V17');
  });

  it('V18 numeric sanity', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pitch'] = 7;
      delete item(d, 1)['pitchConfidence'];
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['strokes'] = 40;
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V18').length).toBeGreaterThanOrEqual(3);
    const root2 = copyFixture();
    mutate(root2, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pitchConfidence'] = 'high';
    });
    expect(rules(validate(root2).warnings)).toContain('V18');
  });

  it('V19 token integrity and writer-supplied tokenIds', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const line = (item(d)['lines'] as Json[])[0]!;
      line['tokens'] = ['ハナさん', '、', 'これ', 'は', '本', 'です', 'か'];
      const line2 = (item(d)['lines'] as Json[])[2]!;
      line2['tokenIds'] = [null];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V19').length).toBeGreaterThanOrEqual(2);
  });

  it('V20 coverage rules fail only in strict mode with bundles', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      item(d)['bridge'] = true;
      (item(d)['lines'] as Json[])[0]!['plusOne'] = ['v-n5-0005'];
    });
    expect(rules(validate(root).failures)).not.toContain('V20');
    pipeline(root);
    expectRule(validate(root, { strict: true }), 'V20');
  });

  it('V20 unknown words lower coverage below the target', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      for (const i of [0, 2, 4]) {
        const line = (item(d)['lines'] as Json[])[i]!;
        line['ja'] = 'りんごとみかんとぶどうとばななをたべますか。';
        line['kana'] = 'りんごとみかんとぶどうとばななをたべますか。';
        line['tokens'] = ['りんご', 'と', 'みかん', 'と', 'ぶどう', 'と', 'ばなな', 'を', 'たべます', 'か', '。'];
      }
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    expect(r.failures.some((f) => f.rule === 'V20' && /coverage/.test(f.message))).toBe(true);
  });

  it('V21 comprehension', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const q = (item(d)['comprehension'] as Json[])[0]!;
      q['choices'] = ['A book', 'A book', 'Water', 'Bread'];
      (item(d)['comprehension'] as Json[])[1]!['q'] = '本ですか。';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V21').length).toBeGreaterThanOrEqual(2);
  });

  it('V22 register heuristic warns', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      for (const it of (d['items'] as Json[]).slice(0, 6)) {
        (it['examples'] as Json[])[0]!['ja'] = `${(it['examples'] as Json[])[0]!['ja'] as string}`.replace('です。', 'だ。');
        (it['examples'] as Json[])[0]!['kana'] = `${(it['examples'] as Json[])[0]!['kana'] as string}`.replace('です。', 'だ。');
      }
    });
    expect(rules(validate(root).warnings)).toContain('V22');
  });

  it('V23 grammar graph', () => {
    const root = copyFixture();
    mutate(root, 'grammar/n5/grammar-n5-001.json', (d) => {
      item(d)['related'] = ['g-n5-001', 'g-n5-002', 'g-n5-002'];
      item(d, 1)['unlocksForms'] = ['masu', 'subjunctive'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V23').length).toBeGreaterThanOrEqual(3);
  });

  it('V24 kana consistency', () => {
    const root = copyFixture();
    mutate(root, 'kana/hiragana.json', (d) => {
      item(d, 3)['row'] = 's';
      item(d, 9)['type'] = 'basic';
      item(d, 11)['id'] = 'k-h-kiya';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V24').length).toBeGreaterThanOrEqual(3);
  });

  it('V25 story form', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      delete (item(d)['lines'] as Json[])[0]!['speaker'];
      item(d)['names'] = ['アオ'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V25').length).toBeGreaterThanOrEqual(2);
  });

  it('V26 conjugation', () => {
    const root = copyFixture();
    mutate(root, 'conjugation/conjugation-001.json', (d) => {
      item(d)['form'] = 'adj-neg';
      item(d, 2)['alt'] = ['大きくない'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V26').length).toBeGreaterThanOrEqual(2);
  });

  it('V27 dialogue fields', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const learner = (item(d)['lines'] as Json[])[1]!;
      (learner['options'] as Json[])[0]!['kind'] = 'ok';
      learner['mustInclude'] = ['水'];
      (item(d)['lines'] as Json[])[0]!['registerTarget'] = 'casual';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V27').length).toBeGreaterThanOrEqual(3);
  });

  it('V30 denylist (term, katakana form, pattern) and absent-list warning', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['notes'] = 'like Pikachu';
      item(d, 1)['notes'] = 'ピカチュウのように';
      item(d, 2)['notes'] = 'a Pokémon reference';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V30').length).toBe(3);
    const root2 = copyFixture();
    rmSync(join(root2, '_meta/denylist.json'));
    expect(rules(validate(root2).warnings)).toContain('V30');
  });

  it('V31 script hygiene', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['ja'] = '{私|わたし}は3{年生|ねんせい}です。';
      (item(d)['examples'] as Json[])[0]!['kana'] = 'わたしは3ねんせいです。';
      item(d, 1)['notes'] = 'ＡＢＣ';
      item(d, 2)['notes'] = ' padded ';
      item(d, 3)['notes'] = 'ﾃｽﾄ';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V31').length).toBeGreaterThanOrEqual(4);
  });

  it('V32 dedupe (word+kana, kanji char, kana glyph) and homograph exemption', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 1)['word'] = '私';
      item(d, 1)['kana'] = 'わたし';
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d, 1)['char'] = '日';
      item(d, 1)['id'] = 'j-日';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V32').length).toBeGreaterThanOrEqual(2);
    const root2 = copyFixture();
    mutate(root2, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['tags'] = ['people', 'homograph'];
      item(d, 1)['word'] = '私';
      item(d, 1)['kana'] = 'わたし';
      item(d, 1)['tags'] = ['people', 'homograph'];
    });
    expect(validate(root2).failures.filter((f) => f.rule === 'V32')).toEqual([]);
  });

  it('V33 gloss style warns', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 6)['meanings'] = ['drink.'];
      (item(d, 7)['examples'] as Json[])[0]!['en'] = 'Water please';
    });
    const r = validate(root);
    expect(r.warnings.filter((f) => f.rule === 'V33').length).toBeGreaterThanOrEqual(3);
  });

  it('V34 quotas: warn without --strict, fail with --strict after assignment', () => {
    const root = copyFixture();
    pipeline(root);
    expect(rules(validate(root).failures)).not.toContain('V34');
    expect(rules(validate(root).warnings)).toContain('V34');
    expectRule(validate(root, { strict: true }), 'V34');
  });

  it('V35 manifest must regenerate byte-identically', () => {
    const root = copyFixture();
    pipeline(root);
    expect(validate(root, { strict: true }).failures.filter((f) => f.rule === 'V35')).toEqual([]);
    mutate(root, 'manifest.json', (d) => {
      (d['files'] as Json[])[0]!['bytes'] = 1;
    });
    expectRule(validate(root, { strict: true }), 'V35');
    const root2 = copyFixture();
    pipeline(root2);
    mutate(root2, 'stations/04.json', (d) => {
      d['grammarIds'] = [];
    });
    expectRule(validate(root2, { strict: true }), 'V35');
  });

  it('V36 J-J definitions', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['definitionJa'] = { ja: '{飲|の}む{水|みず}のこと。', kana: 'のむみずのこと。' };
    });
    pipeline(root);
    expectRule(validate(root, { strict: true }), 'V36');
    expect(rules(validate(root).failures)).not.toContain('V36');
  });
});

describe('validate — linker and options', () => {
  it('writes tokenIds parallel to tokens in strict mode (and content:assign already linked them)', () => {
    const root = copyFixture();
    pipeline(root);
    const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
    const lines = item(story)['lines'] as Json[];
    for (const ln of lines) expect((ln['tokenIds'] as unknown[]).length).toBe((ln['tokens'] as unknown[]).length);
    expect(lines[0]!['tokenIds']).toEqual([null, null, null, 'v-n5-0006', null, 'v-n5-0005', null, null, null]);
    expect(lines[6]!['tokenIds']).toEqual(['v-n5-0008', null, 'v-n5-0007', null, null]);
    const r = validate(root, { strict: true });
    expect(r.linked).toBe(12);
  });

  it('--fix-tokenids rewrites stale tokenIds; without it they fail V19', () => {
    const root = copyFixture();
    pipeline(root);
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      (item(d)['lines'] as Json[])[0]!['tokenIds'] = [null, null, null, null, null, null, null, null, null];
    });
    expectRule(validate(root), 'V19');
    const r = validate(root, { fixTokenIds: true });
    expect(r.failures.filter((f) => f.rule === 'V19')).toEqual([]);
    const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
    expect(((item(story)['lines'] as Json[])[0]!['tokenIds'] as unknown[])[3]).toBe('v-n5-0006');
  });

  it('--only filters findings to matching files', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pos'] = 'verb';
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['strokes'] = 99;
    });
    expect(rules(validate(root, { only: 'kanji/**' }).failures)).toEqual(['V18']);
    expect(rules(validate(root, { only: 'vocab/n5/vocab-n5-001.json' }).failures)).toEqual(['V07']);
  });

  it('components/denylist overrides are honoured', () => {
    const root = copyFixture();
    const r = validate(root, { components: [{ id: 'c-sun', char: '日', name: 'sun' }], denylist: ['katana'] });
    expect(rules(r.failures)).toContain('V07');
    expect(rules(r.failures)).toContain('V30');
    expect(existsSync(join(root, '_meta/denylist.json'))).toBe(true);
  });
});
