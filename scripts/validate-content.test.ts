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
    // `pitchConfidence: "high"` is what the pitch post-pass writes (review round 2b), so it is not a warning
    const root2 = copyFixture();
    mutate(root2, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pitchConfidence'] = 'high';
    });
    expect(rules(validate(root2).warnings)).not.toContain('V18');
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

  it('V36 strips the 〜 marker and takes a single-kanji target only with its own reading', () => {
    const root = copyFixture();
    const setDef = (ja: string, kana: string) =>
      mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
        const it = item(d, 7); // 水 みず → an affix-shaped 〜水 / 〜みず
        it['word'] = '〜水';
        it['kana'] = '〜みず';
        it['definitionJa'] = { ja, kana };
      });
    const target = (r: ValidateResult) => r.failures.filter((f) => f.rule === 'V36' && /contains the target/.test(f.message)).map((f) => f.message);
    setDef('{飲|の}む{水|みず}のこと。', 'のむみずのこと。');
    pipeline(root);
    expect(target(validate(root, { strict: true }))).toEqual(['definitionJa contains the target "〜水"']);
    // the same kanji under another reading is a different word (泊 in 泊まる for 〜泊): not the target
    setDef('{飲|の}む{水|すい}のこと。', 'のむすいのこと。');
    expect(target(validate(root, { strict: true }))).toEqual([]);
    // the reading alone (≥ 2 chars) still counts
    setDef('のむみずのこと。', 'のむみずのこと。');
    expect(target(validate(root, { strict: true }))).toEqual(['definitionJa contains the target "〜みず"']);
  });

  it('V36 allowlist check: a single-kanji stem before kanji is a W, not an F', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      // 飲 is the one-kanji stem of 飲む (v-n5-0007); 本 is allowlisted on its own. The old segmentation
      // resolved 飲本 as 飲|本; now the compound surfaces as a warning while nothing fails.
      item(d, 7)['definitionJa'] = { ja: '{飲本|のみほん}のこと。', kana: 'のみほんのこと。' };
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    expect(r.failures.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008')).toEqual([]);
    const w = r.warnings.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008').map((f) => f.message);
    expect(w).toEqual(['definitionJa resolves "飲" only by letting a single-kanji verb/adjective stem swallow the next kanji (likely a compound outside the Station 1 allowlist)']);
    // a span nothing resolves is still an F
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['definitionJa'] = { ja: '{飲龍|のみりゅう}のこと。', kana: 'のみりゅうのこと。' };
    });
    const r2 = validate(root, { strict: true });
    expect(r2.failures.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008').map((f) => f.message)).toEqual(['definitionJa uses words outside the Station 1 allowlist: 龍']);
    expect(r2.warnings.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008').map((f) => f.message)).toEqual(['definitionJa resolves "飲龍" only by letting a single-kanji verb/adjective stem swallow the next kanji (likely a compound outside the Station 1 allowlist)']);
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

  it('links inflected forms through the fixture: 飲んで → 飲む, いきます / いった → 行く, たべました → 食べる; auxiliary spellings need no vocabIds entry', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const lines = item(d)['lines'] as Json[];
      Object.assign(lines[2]!, { ja: '{水|みず}を{飲|の}んで、{学校|がっこう}へいきます。', kana: 'みずをのんで、がっこうへいきます。', tokens: ['水', 'を', '飲んで', '、', '学校', 'へ', 'いきます', '。'] });
      Object.assign(lines[4]!, { ja: '{友達|ともだち}はパンをたべました。', kana: 'ともだちはパンをたべました。', tokens: ['友達', 'は', 'パン', 'を', 'たべました', '。'] });
      Object.assign(lines[8]!, { ja: '{学校|がっこう}へいった。', kana: 'がっこうへいった。', tokens: ['学校', 'へ', 'いった', '。'] });
      // the one kanji 行きます becomes the auxiliary spelling too, so 行く is used only as いきます / いった
      const last = lines[11]!;
      const swap = (t: string) => t.replace('行きます', 'いきます');
      Object.assign(last, { ja: 'はい、{大|おお}きいです。{私|わたし}は{学校|がっこう}へいきます。', kana: swap(String(last['kana'])), tokens: (last['tokens'] as string[]).map(swap), mustInclude: ['学校', 'いきます'] });
      last['options'] = (last['options'] as Json[]).map((o) => ({ ...o, text: swap(String(o['text'])), ...(o['recast'] ? { recast: swap(String(o['recast'])) } : {}) }));
      last['accept'] = (last['accept'] as string[]).map(swap);
      item(d)['vocabIds'] = (item(d)['vocabIds'] as string[]).filter((x) => x !== 'v-n5-0007' && x !== 'v-n5-0012');
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
    const lines = item(story)['lines'] as Json[];
    expect(lines[2]!['tokenIds']).toEqual(['v-n5-0008', null, 'v-n5-0007', null, 'v-n5-0013', null, 'v-n5-0012', null]);
    expect(lines[4]!['tokenIds']).toEqual(['v-n5-0003', null, 'v-n5-0011', null, 'v-n5-0010', null]);
    expect(lines[8]!['tokenIds']).toEqual(['v-n5-0013', null, 'v-n5-0012', null]);
    expect(lines[5]!['tokenIds']).toEqual(['v-n5-0014', null, 'v-n5-0004', null, null, 'v-n5-0002', null, null]); // no copula item: ではありません stays a function token
    // V20: 飲む (飲んで, a content use) is asked for in vocabIds; 行く is not, since いきます / いった are auxiliary spellings
    const missing = r.warnings.filter((f) => f.rule === 'V20' && /missing from vocabIds/.test(f.message)).map((f) => /word (v-n5-\d{4})/.exec(f.message)?.[1]);
    expect(missing).toEqual(['v-n5-0007']);
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

/* ── round 2: V30 matcher equivalence, V37/V38, V20/V26/V33/V35 accuracy ─── */

import { compileDenylist, findDenylisted, DEFECTIVE_VERB_FORMS, ICHIDAN_ENDING_RE, KNOWN_ICHIDAN } from './validate-content.ts';
import type { Denylist } from './validate-content.ts';
import { deriveContentVersion } from './build-content-index.ts';
import { readdirSync, statSync } from 'node:fs';

/** The matcher V30 used before round 2: one regex per Latin term, `includes` per other term, then patterns. */
function legacyDenyMatch(d: Denylist, s: string): boolean {
  for (const t of d.terms) {
    if (!t) continue;
    if (/^[\x20-\x7e]+$/.test(t)) {
      if (new RegExp(`(^|[^A-Za-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i').test(s)) return true;
    } else if (s.includes(t)) return true;
  }
  for (const p of d.patterns) if (new RegExp(p, 'iu').test(s)) return true;
  return false;
}

/** Every string value in every JSON file under `dir` (except the denylist itself, which the validator never scans). */
function allStrings(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allStrings(p, out);
    else if (name.endsWith('.json') && name !== 'denylist.json') {
      const walk = (v: unknown): void => {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
      };
      walk(JSON.parse(readFileSync(p, 'utf8')));
    }
  }
  return out;
}

describe('V30 denylist matcher', () => {
  const fixtureList = JSON.parse(readFileSync(join(GOOD, '_meta/denylist.json'), 'utf8')) as { terms: string[]; patterns: string[] };
  const denylist: Denylist = {
    // the fixture list plus terms with every awkward shape the real list has: regex metacharacters,
    // digits, spaces, mixed case, non-ASCII Latin, a CJK term that is a prefix of another, an empty term
    terms: [...fixtureList.terms, 'Dr. Stone', 'K-On', 'Jump+', 'PS5', 'Ranma 1/2', 'THE IDOLM@STER', 'Persona', 'Persona 3', 'Pokémon', 'HUNTER×HUNTER', 'ロケット団', 'ロケット', '999', ''],
    patterns: [...fixtureList.patterns, '[A-Z]{2,4}48(?!\\d)'],
  };
  const probes = [
    ...allStrings(GOOD),
    'like Pikachu', 'PIKACHU!', 'pikachu', 'Pikachus', 'xPikachu', 'a Pokémon reference', 'Pokemon Go', 'pokémon', 'ピカチュウのように', 'ピカチュ',
    'Dr. Stone is on', 'Dr Stone', 'dr. stone!', 'K-On', 'K-On!', 'K-Online', 'Jump+ app', 'Jump', 'PS5 game', 'PS50', 'ranma 1/2', 'THE IDOLM@STER',
    'Persona 3 Reload', 'personable', 'persona', 'HUNTER×HUNTER', 'Hunter×Hunter', 'ロケット団の人', 'ロケット', 'ロケッ', 'Totoro', 'トトロ', 'トト',
    'Nintendo Switch', 'nintendo', 'Switch', 'AKB48', 'akb48', 'AKB480', '999 bottles', 'room 9999', '', ' ', '日本の本です。',
  ];

  it('the alternation/bucket matcher flags exactly the strings the per-term matcher flagged', () => {
    const compiled = compileDenylist(denylist);
    expect(compiled.latin.length).toBeGreaterThan(0);
    expect(compiled.other.size).toBeGreaterThan(0);
    expect(compiled.latinNeedsLetter).toBe(false); // '999' has no letter, so the Latin fast path is off
    const legacy = probes.filter((s) => legacyDenyMatch(denylist, s));
    const fresh = probes.filter((s) => findDenylisted(compiled, s) !== null);
    expect(fresh).toEqual(legacy);
    expect(legacy).toContain('like Pikachu');
    expect(legacy).toContain('Pokemon Go');
    expect(legacy).toContain('ロケット団の人');
    expect(legacy).not.toContain('Pikachus');
    expect(legacy).not.toContain('K-Online');
    expect(legacy).toContain('PS50'); // the boundary is letter-only (digits adjoin), as before
    expect(legacy).not.toContain('日本の本です。');
    // the fixture corpus itself is clean under both
    expect(allStrings(GOOD).filter((s) => legacyDenyMatch(denylist, s))).toEqual([]);
  });

  it('reports the term as the denylist spells it, longest first, and keeps the Latin fast path when every term has a letter', () => {
    const c = compileDenylist({ terms: ['Persona', 'Persona 3', 'ピカチュウ', 'Dr. Stone'], patterns: ['\\bPok[eé]mon\\b', '('] });
    expect(c.latinNeedsLetter).toBe(true);
    expect(c.invalidPatterns).toEqual(['(']);
    expect(findDenylisted(c, 'persona 3 reload')).toEqual({ kind: 'term', value: 'Persona 3' });
    expect(findDenylisted(c, 'PERSONA!')).toEqual({ kind: 'term', value: 'Persona' });
    expect(findDenylisted(c, 'DR. STONE')).toEqual({ kind: 'term', value: 'Dr. Stone' });
    expect(findDenylisted(c, 'Dr Stone')).toBeNull();
    expect(findDenylisted(c, 'あのピカチュウ')).toEqual({ kind: 'term', value: 'ピカチュウ' });
    expect(findDenylisted(c, 'a Pokémon')).toEqual({ kind: 'pattern', value: '\\bPok[eé]mon\\b' });
    expect(findDenylisted(c, 'personable')).toBeNull();
    expect(findDenylisted(c, '日本')).toBeNull();
  });

  it('an invalid pattern is a V30 warning on the denylist file, not a crash', () => {
    const root = copyFixture();
    const r = validate(root, { denylist: { terms: ['Pikachu'], patterns: ['('] } });
    expect(r.warnings.some((w) => w.rule === 'V30' && w.file === '_meta/denylist.json' && /invalid pattern/.test(w.message))).toBe(true);
  });
});

describe('V37 pos vs verb ending (W only)', () => {
  it('the good fixture carries no V37/V38 warnings', () => {
    const r = validate(copyFixture());
    expect(rules(r.warnings)).not.toContain('V37');
    expect(rules(r.warnings)).not.toContain('V38');
  });

  it('ICHIDAN_ENDING_RE accepts い/え-row + る in both scripts and rejects everything else', () => {
    for (const k of ['たべる', 'みる', 'おきる', 'でる', 'ウケる', 'かりる', 'ねる']) expect(ICHIDAN_ENDING_RE.test(k)).toBe(true);
    for (const k of ['のむ', 'いく', 'つくる', 'ある', 'する', 'たべ', 'かう', 'のる']) expect(ICHIDAN_ENDING_RE.test(k)).toBe(false);
    expect(ICHIDAN_ENDING_RE.test('はしる')).toBe(true); // い-row + る looks ichidan; 走る is a godan exception, which is why v5 needs KNOWN_ICHIDAN
    expect(KNOWN_ICHIDAN.has('食べる')).toBe(true);
    expect(KNOWN_ICHIDAN.has('帰る')).toBe(false);
  });

  it('flags v1 with a godan ending, v1 ending in する/くる, and v5 that is a known ichidan verb; never fails', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 11)['pos'] = 'v1'; // 行く いく
      item(d, 9)['pos'] = 'v5'; // 食べる たべる (known ichidan, not in the fixture conjugation table)
      item(d, 14)['word'] = '勉強する';
      item(d, 14)['kana'] = 'べんきょうする';
      item(d, 14)['pos'] = 'v1';
      (item(d, 14)['examples'] as Json[])[0] = { ja: '{毎日|まいにち}{勉強|べんきょう}します。', kana: 'まいにちべんきょうします。', en: 'I study every day.' };
      item(d, 14)['meanings'] = ['to study'];
    });
    const r = validate(root);
    const w = r.warnings.filter((f) => f.rule === 'V37');
    expect(r.failures.filter((f) => f.rule === 'V37')).toEqual([]);
    expect(w.find((f) => f.id === 'v-n5-0012')?.message).toMatch(/suggested pos v5/);
    expect(w.find((f) => f.id === 'v-n5-0010')?.message).toMatch(/known ichidan verb; suggested pos v1/);
    expect(w.find((f) => f.id === 'v-n5-0015')?.message).toMatch(/ends in する\/くる; suggested pos v-irr/);
    expect(w.length).toBe(3);
  });

  it('uses the conjugation table as ground truth where the head word appears', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 6)['pos'] = 'v1'; // 飲む is v5 in conjugation-001
    });
    mutate(root, 'conjugation/conjugation-001.json', (d) => {
      (d['items'] as Json[]).push({ id: 'cj-0004', word: '食べる', kana: 'たべる', pos: 'v1', form: 'masu', answer: '食べます', answerKana: 'たべます' });
      (d['items'] as Json[]).push({ id: 'cj-0005', word: '帰る', kana: 'かえる', pos: 'v5', form: 'masu', answer: '帰ります', answerKana: 'かえります' });
    });
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      // 帰る: え-mora + る but attested v5 → silent; 食べる attested v1 → silent even though the ending check would pass anyway
      item(d, 12)['word'] = '帰る';
      item(d, 12)['kana'] = 'かえる';
      item(d, 12)['pos'] = 'v5';
      item(d, 12)['meanings'] = ['to go home'];
      (item(d, 12)['examples'] as Json[])[0] = { ja: '{家|いえ}に{帰|かえ}ります。', kana: 'いえにかえります。', en: 'I go home.' };
    });
    const r = validate(root);
    const w = r.warnings.filter((f) => f.rule === 'V37');
    expect(w.map((f) => f.id)).toEqual(['v-n5-0007']);
    expect(w[0]!.message).toMatch(/conjugation table lists "飲む" as v5; suggested pos v5/);
  });

  it('a v5 whose ending looks ichidan but is not a known ichidan verb stays silent', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 12)['word'] = '走る';
      item(d, 12)['kana'] = 'はしる';
      item(d, 12)['pos'] = 'v5';
      item(d, 11)['word'] = '切る';
      item(d, 11)['kana'] = 'きる';
      item(d, 11)['pos'] = 'v5';
    });
    expect(validate(root).warnings.filter((f) => f.rule === 'V37')).toEqual([]);
  });
});

describe('V38 repeated kanji component (W only)', () => {
  it('warns once per kanji, names the repeated part and does not dedupe or fail', () => {
    const root = copyFixture();
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d, 3)['components'] = ['tree', 'one', 'tree'];
    });
    const r = validate(root);
    expect(r.failures).toEqual([]);
    const w = r.warnings.filter((f) => f.rule === 'V38');
    expect(w.length).toBe(1);
    expect(w[0]!.id).toBe('j-本');
    expect(w[0]!.message).toMatch(/repeats "tree" \(tree, one, tree\)/);
    const doc = JSON.parse(readFileSync(join(root, 'kanji/n5/kanji-n5-001.json'), 'utf8')) as Json;
    expect(item(doc, 3)['components']).toEqual(['tree', 'one', 'tree']);
  });
});

describe('V40 unlocksForms with nothing to conjugate (W only)', () => {
  it('warns when a station declares a verb form but its cumulative allowlist has no verb; silent on the good fixture and without bundles; never fails', () => {
    expect(validate(copyFixture()).warnings.filter((f) => f.rule === 'V40')).toEqual([]);
    const root = copyFixture();
    pipeline(root);
    expect(validate(root, { strict: true }).warnings.filter((f) => f.rule === 'V40')).toEqual([]);
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      for (const it of d['items'] as Json[]) if (it['pos'] === 'v1' || it['pos'] === 'v5') it['pos'] = 'n';
    });
    const r = validate(root, { strict: true });
    const w = r.warnings.filter((f) => f.rule === 'V40');
    expect(w.map((f) => f.id)).toEqual(['g-n5-003']);
    expect(w[0]!.file).toBe('grammar/n5/grammar-n5-001.json');
    expect(w[0]!.message).toMatch(/unlocksForms masu at Station 4, but the cumulative allowlist has no conjugable verb/);
    expect(r.failures.filter((f) => f.rule === 'V40')).toEqual([]);
    // an adjective form with no adjective in the allowlist is the other half
    mutate(root, 'grammar/n5/grammar-n5-001.json', (d) => {
      item(d, 2)['unlocksForms'] = ['adj-neg'];
    });
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      for (const it of d['items'] as Json[]) if (it['pos'] === 'adj-i') it['pos'] = 'n';
    });
    const adj = validate(root).warnings.filter((f) => f.rule === 'V40');
    expect(adj.map((f) => f.message)).toEqual([expect.stringMatching(/unlocksForms adj-neg at Station 4, but the cumulative allowlist has no adjective/)]);
  });
});

describe('V39 duplicated michikusa card (W only)', () => {
  it('the good fixture carries no V39 warnings', () => {
    expect(validate(copyFixture()).warnings.filter((f) => f.rule === 'V39')).toEqual([]);
  });

  it('warns both items when the same ja (different ruby split) or kana is collected at another station, never fails', () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'michikusa/michikusa-s05.json'),
      JSON.stringify(
        {
          schema: 'tsuzuku.content/1',
          type: 'michikusa',
          writer: 'fixture',
          items: [
            { id: 'm-05-1', stationId: 'st-05', kind: 'proverb', titleEn: 'Time is money, again', bodyEn: 'The same saying, collected a second time at Totsuka.', ja: '{時|とき}は{金|かね}なり。', kana: 'ときはかねなり。' },
            { id: 'm-05-2', stationId: 'st-05', kind: 'culture', titleEn: 'Fifty-three again', bodyEn: 'A different card with a different Japanese word.', ja: '{宿場|しゅくば}', kana: 'しゅくば' },
          ],
        },
        null,
        2,
      ) + '\n',
    );
    const r = validate(root);
    expect(r.failures).toEqual([]);
    const w = r.warnings.filter((f) => f.rule === 'V39');
    expect(w.map((f) => f.id).sort()).toEqual(['m-04-2', 'm-05-1']);
    expect(w.find((f) => f.id === 'm-04-2')!.message).toMatch(/also collected at m-05-1/);
    expect(w.find((f) => f.id === 'm-05-1')!.file).toBe('michikusa/michikusa-s05.json');
  });

  it('does not warn for two cards at the same station', () => {
    const root = copyFixture();
    mutate(root, 'michikusa/michikusa-s04.json', (d) => {
      item(d, 0)['ja'] = '{時|とき}は{金|かね}なり。';
      item(d, 0)['kana'] = 'ときはかねなり。';
    });
    expect(validate(root).warnings.filter((f) => f.rule === 'V39')).toEqual([]);
  });
});

describe('validator accuracy (round 2)', () => {
  it('V20 warns when vocabIds covers < 60 % of the allowlisted words detected in the text, even in strict mode', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      item(d)['vocabIds'] = ['v-n5-0005'];
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    const w = r.warnings.filter((f) => f.rule === 'V20' && /vocabIds covers/.test(f.message));
    expect(w.length).toBe(1);
    expect(w[0]!.id).toBe('s-04-1');
    expect(w[0]!.message).toMatch(/covers 1 of \d+ allowlisted words .* % < 60 %/);
    expect(r.failures.filter((f) => f.rule === 'V20' && /vocabIds covers/.test(f.message))).toEqual([]);
    // the full list passes silently
    const root2 = copyFixture();
    pipeline(root2);
    expect(validate(root2, { strict: true }).warnings.filter((f) => f.rule === 'V20' && /vocabIds covers/.test(f.message))).toEqual([]);
  });

  it('V33 exempts proper nouns (weekdays, months, nationalities, festivals, places, acronyms) but still warns on ordinary words', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 1)['meanings'] = ['Monday', 'Japanese person', 'Western-style clothes', 'Obon', "New Year's Eve", 'Europe', 'TV', 'United Nations', 'Buddhist temple', 'Tanabata'];
      item(d, 2)['meanings'] = ['Friend', 'Big book'];
    });
    const r = validate(root);
    const upper = r.warnings.filter((f) => f.rule === 'V33' && /starts uppercase/.test(f.message));
    expect(upper.map((f) => f.id)).toEqual(['v-n5-0003', 'v-n5-0003']);
    expect(upper.map((f) => /"(.*)"$/.exec(f.message)?.[1])).toEqual(['Friend', 'Big book']);
  });

  it('V26 does not ask for forms a defective verb lacks (ある, 要る) but still reports its real gaps', () => {
    const root = copyFixture();
    mutate(root, 'conjugation/conjugation-001.json', (d) => {
      (d['items'] as Json[]).push(
        { id: 'cj-0004', word: 'ある', kana: 'ある', pos: 'v5', form: 'masu', answer: 'あります', answerKana: 'あります' },
        { id: 'cj-0005', word: '要る', kana: 'いる', pos: 'v5', form: 'masu', answer: '要ります', answerKana: 'いります' },
      );
    });
    const r = validate(root);
    const aru = r.warnings.find((f) => f.rule === 'V26' && f.id === 'cj-0004')!;
    expect(aru).toBeDefined();
    for (const fm of DEFECTIVE_VERB_FORMS['ある']!) expect(aru.message).not.toMatch(new RegExp(`\\b${fm}\\b`));
    expect(aru.message).toMatch(/\bte\b/);
    expect(aru.message).toMatch(/\bnai\b/);
    const iru = r.warnings.find((f) => f.rule === 'V26' && f.id === 'cj-0005')!;
    expect(iru.message).not.toMatch(/imperative|volitional|passive|causative|prohibitive|tai|te-iru/);
    // a regular verb keeps the full list
    const nomu = r.warnings.find((f) => f.rule === 'V26' && f.id === 'cj-0001')!;
    expect(nomu.message).toMatch(/potential/);
    expect(nomu.message).toMatch(/imperative/);
  });

  it('V35 flags a derived contentVersion that no longer matches the content', () => {
    const root = copyFixture();
    assign(root, PLAN, { write: true, allowlistsDir: join(root, '..', `${root.split('/').pop()}-allowlists`) });
    writeIndex(root, undefined, { generatedAt: '2026-10-17T00:00:00.000Z' });
    const before = validate(root, { strict: true });
    expect(before.failures.filter((f) => f.rule === 'V35')).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { contentVersion: string };
    expect(manifest.contentVersion).toBe(deriveContentVersion(root));
    const p = join(root, 'michikusa/michikusa-s04.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('Hodogaya was', 'Hodogaya is'));
    const after = validate(root, { strict: true });
    expect(after.failures.some((f) => f.rule === 'V35' && /contentVersion .* is stale/.test(f.message))).toBe(true);
    // an overridden version is never compared
    writeIndex(root, '2026.10.1', { generatedAt: '2026-10-17T00:00:00.000Z' });
    expect(validate(root, { strict: true }).failures.filter((f) => f.rule === 'V35')).toEqual([]);
  });
});
