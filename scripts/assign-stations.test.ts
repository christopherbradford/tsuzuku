import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATIONS } from '../src/content/types.ts';
import type { ComponentDef, GrammarItem, KanjiItem, StationBundle, VocabItem } from '../src/content/types.ts';
import { assign, bundlesFromCorpus, buildMatchPool, matchToken, orderRankedVocab, placeComponents, stemApplies, topoSortKanji, vocabSurfaceList } from './assign-stations.ts';
import type { PlanEntry } from './assign-stations.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GOOD = join(here, '__fixtures__', 'good');
const tmps: string[] = [];

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}

function writeJson(p: string, v: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

/* ── synthetic N5 corpus big enough to fill Stations 1–15 ────────────────── */

const KANA = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ'];
/** Unique kana-only surface for item n (bijective base-45 encoding, ≥ 2 chars). */
function kanaWord(n: number): string {
  let s = '';
  let x = n;
  do {
    s = KANA[x % KANA.length]! + s;
    x = Math.floor(x / KANA.length);
  } while (x > 0);
  return s.length < 2 ? 'ん' + s : s;
}

function vocabItem(level: number, n: number, extra: Partial<VocabItem> = {}): VocabItem {
  const w = kanaWord(n + level * 10000);
  return {
    id: `v-n${level}-${String(n).padStart(4, '0')}`,
    word: w,
    kana: w,
    meanings: ['thing'],
    pos: 'n',
    jlpt: level as VocabItem['jlpt'],
    tags: ['objects'],
    examples: [{ ja: `${w}です。`, kana: `${w}です。`, en: 'It is a thing.' }],
    ...extra,
  };
}

const PRIMS: [string, string][] = [
  ['sun', '日'], ['one', '一'], ['tree', '木'], ['earth', '土'], ['inch', '寸'], ['temple', '寺'], ['person', '人'], ['mouth', '口'],
  ['rice field', '田'], ['power', '力'], ['moon', '月'], ['water', '水'], ['fire', '火'], ['gold', '金'], ['mountain', '山'], ['river', '川'],
];
const COMPONENTS: ComponentDef[] = PRIMS.map(([name, char]) => ({ id: `c-${name.replace(/ /g, '-')}`, char, name }));

/** 100 synthetic N5 kanji: one glyph per CJK code point, components from PRIMS, with dependency edges. */
function kanjiCorpus(): KanjiItem[] {
  const out: KanjiItem[] = [];
  for (let i = 0; i < 100; i++) {
    const ch = String.fromCharCode(0x4e00 + 0x100 + i);
    const comps = [PRIMS[i % PRIMS.length]![0], PRIMS[(i * 7 + 3) % PRIMS.length]![0]];
    out.push({
      id: `j-${ch}`,
      char: ch,
      meanings: ['x'],
      on: ['カ'],
      kun: [],
      strokes: 5,
      jlpt: 5,
      components: comps,
      mnemonic: `${comps[0]!.toUpperCase()} and ${comps[1]!.toUpperCase()}: X.`,
      examples: [{ word: `${ch}日`, kana: 'かにち', en: 'x' }, { word: `${ch}人`, kana: 'かじん', en: 'x' }],
    });
  }
  // Dependency edges: kanji #0 is itself a component glyph (寺) of kanji #5 and #40; put the dependents FIRST in corpus order.
  out[5]!.components = ['sun', '寺'];
  out[40]!.components = ['寺', 'tree'];
  out[0]!.char = '寺';
  out[0]!.id = 'j-寺';
  out[0]!.components = ['earth', 'inch'];
  // kanji #70 depends on kanji #90 (a glyph that is a listed PRIM with a ComponentDef: 川 'river').
  out[90]!.char = '川';
  out[90]!.id = 'j-川';
  out[90]!.components = ['river'];
  out[70]!.components = ['river', 'sun'];
  return out;
}

function grammarItem(n: number): GrammarItem {
  return {
    id: `g-n5-${String(n).padStart(3, '0')}`,
    pattern: `〜ぱたーん${n}`,
    meaning: 'x',
    formation: ['x'],
    explanation: 'x',
    jlpt: 5,
    register: 'neutral',
    examples: [
      { ja: 'あです。', kana: 'あです。', en: 'A.' },
      { ja: 'いです。', kana: 'いです。', en: 'I.' },
      { ja: 'うです。', kana: 'うです。', en: 'U.' },
    ],
    clozeHints: ['です'],
    mistakes: [],
    related: [],
    tags: [],
  };
}

interface Synth {
  root: string;
  plan: PlanEntry[];
}

function synthCorpus(opts: { ranked?: boolean } = {}): Synth {
  const root = tmp('tsuzuku-assign-');
  cpSync(join(GOOD, 'kana'), join(root, 'kana'), { recursive: true });
  writeJson(join(root, '_meta/components.json'), { schema: 'tsuzuku.content/1', type: 'component', items: COMPONENTS });
  const plan: PlanEntry[] = [];
  const entry = (path: string, type: PlanEntry['type'], count: number, idStart: number): PlanEntry => ({ path, type, pass: 1, belt: null, jlpt: 5, count, idPrefix: '', idStart });
  // vocab n5: 6 files (135,135,135,135,130,130) = 800
  const sizes = [135, 135, 135, 135, 130, 130];
  let n = 1;
  for (let f = 0; f < sizes.length; f++) {
    const items: VocabItem[] = [];
    for (let i = 0; i < sizes[f]!; i++, n++) {
      const extra: Partial<VocabItem> = {};
      if (opts.ranked) extra.frequencyRank = 801 - n; // reverse order: the LAST item is the most frequent
      if (n === 10) extra.altForms = ['下さい'];
      if (n === 11) {
        extra.pos = 'v5';
        extra.word = '飲む';
        extra.kana = 'のむ';
      }
      items.push(vocabItem(5, n, extra));
    }
    const rel = `vocab/n5/vocab-n5-${String(f + 1).padStart(3, '0')}.json`;
    writeJson(join(root, rel), { schema: 'tsuzuku.content/1', type: 'vocab', level: 'n5', items });
    plan.push(entry(`public/content/${rel}`, 'vocab', sizes[f]!, n - sizes[f]!));
  }
  writeJson(join(root, 'kanji/n5/kanji-n5-001.json'), { schema: 'tsuzuku.content/1', type: 'kanji', level: 'n5', items: kanjiCorpus() });
  plan.push(entry('public/content/kanji/n5/kanji-n5-001.json', 'kanji', 100, 0));
  const gsizes = [23, 22, 23, 22];
  let g = 1;
  for (let f = 0; f < gsizes.length; f++) {
    const items: GrammarItem[] = [];
    for (let i = 0; i < gsizes[f]!; i++, g++) items.push(grammarItem(g));
    const rel = `grammar/n5/grammar-n5-${String(f + 1).padStart(3, '0')}.json`;
    writeJson(join(root, rel), { schema: 'tsuzuku.content/1', type: 'grammar', level: 'n5', items });
    plan.push(entry(`public/content/${rel}`, 'grammar', gsizes[f]!, g - gsizes[f]!));
  }
  // a story + michikusa at station 4 so storyIds/michikusaIds get filled
  writeJson(join(root, 'stories/n5/stories-s04.json'), {
    schema: 'tsuzuku.content/1',
    type: 'story',
    level: 'n5',
    items: [{ id: 's-04-1', stationId: 'st-04', titleJa: 'あ', titleEn: 'A', kind: 'story', register: 'polite', lines: [{ ja: `${kanaWord(50001)}です。`, kana: `${kanaWord(50001)}です。`, en: 'x', tokens: [kanaWord(50001), 'です', '。'] }], vocabIds: [], grammarIds: [], comprehension: [], recapEn: 'x', names: ['ミカ'] }],
  });
  writeJson(join(root, 'michikusa/michikusa-s04.json'), {
    schema: 'tsuzuku.content/1',
    type: 'michikusa',
    items: [{ id: 'm-04-1', stationId: 'st-04', kind: 'culture', titleEn: 'x', bodyEn: 'x' }],
  });
  return { root, plan };
}

function readItems<T>(root: string, rel: string): T[] {
  return (JSON.parse(readFileSync(join(root, rel), 'utf8')) as { items: T[] }).items;
}

function allVocab(root: string): VocabItem[] {
  const out: VocabItem[] = [];
  for (const f of readdirSync(join(root, 'vocab/n5')).sort()) out.push(...readItems<VocabItem>(root, `vocab/n5/${f}`));
  return out;
}

/* ── tests ───────────────────────────────────────────────────────────────── */

describe('assign-stations — synthetic N5 corpus', () => {
  it('fills Stations 1–15 within ±10 % of quota and writes station in place', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: join(root, '..', 'allow-' + root.split('/').pop()) });
    tmps.push(join(root, '..', 'allow-' + root.split('/').pop()));
    expect(r.missingFiles).toEqual([]);
    expect(r.assigned.vocab).toBe(800);
    expect(r.assigned.kanji).toBe(100);
    expect(r.assigned.grammar).toBe(90);
    expect(r.assigned.kana).toBe(21);
    for (const st of STATIONS.slice(0, 15)) {
      const b = r.bundles[st.number - 1]!;
      for (const kind of ['vocab', 'kanji', 'grammar'] as const) {
        const have = b[`${kind}Ids`].length;
        expect(Math.abs(have - st.quota[kind])).toBeLessThanOrEqual(st.quota[kind] * 0.1);
      }
    }
    for (const b of r.bundles.slice(15)) expect(b.vocabIds.length + b.kanjiIds.length + b.grammarIds.length).toBe(0);
    // written in place, key order preserved (station appended last)
    const first = allVocab(root)[0]!;
    expect(first.station).toBe(1);
    expect(Object.keys(first).at(-1)).toBe('station');
    expect(allVocab(root).filter((v) => v.station === 3).length).toBe(40);
    // kana by station
    const hira = readItems<{ id: string; station?: number; type: string }>(root, 'kana/hiragana.json');
    expect(hira.find((k) => k.id === 'k-h-a')!.station).toBe(1);
    expect(hira.find((k) => k.type === 'yoon')!.station).toBe(2);
    const kata = readItems<{ id: string; station?: number; type: string }>(root, 'kana/katakana.json');
    expect(kata.find((k) => k.type === 'basic')!.station).toBe(2);
    expect(kata.find((k) => k.type === 'extended')!.station).toBe(3);
    // stories / michikusa / files
    expect(r.bundles[3]!.storyIds).toEqual(['s-04-1']);
    expect(r.bundles[3]!.michikusaIds).toEqual(['m-04-1']);
    expect(r.bundles[3]!.files).toContain('stories/n5/stories-s04.json');
    expect(r.bundles[0]!.files).toEqual(['kana/hiragana.json', 'vocab/n5/vocab-n5-001.json']);
    expect(r.report).toMatch(/04 Hodogaya/);
    expect(existsSync(join(root, 'stations/53.json'))).toBe(true);
  });

  it('never places a kanji before its component kanji (station and in-bundle order)', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const kanji = readItems<KanjiItem>(root, 'kanji/n5/kanji-n5-001.json');
    const byChar = new Map(kanji.map((k) => [k.char, k]));
    const indexInBundles = new Map<string, number>();
    r.bundles.forEach((b) => b.kanjiIds.forEach((id, i) => indexInBundles.set(id, i)));
    const check = (dependent: string, dep: string) => {
      const a = byChar.get(dependent)!;
      const d = byChar.get(dep)!;
      expect(d.station!).toBeLessThanOrEqual(a.station!);
      if (d.station === a.station) expect(indexInBundles.get(d.id)!).toBeLessThan(indexInBundles.get(a.id)!);
    };
    check(kanji[5]!.char, '寺');
    check(kanji[40]!.char, '寺');
    check(kanji[70]!.char, '川');
    // topoSortKanji is stable for independent items
    const sorted = topoSortKanji(kanji, COMPONENTS);
    expect(sorted.indexOf(byChar.get('寺')!)).toBeLessThan(sorted.indexOf(kanji[5]!));
    expect(sorted.filter((k) => ![kanji[0], kanji[5], kanji[40], kanji[70], kanji[90]].includes(k)).map((k) => k.id)).toEqual(
      kanji.filter((k) => ![kanji[0], kanji[5], kanji[40], kanji[70], kanji[90]].includes(k)).map((k) => k.id),
    );
  });

  it('places every component one station ahead of its first kanji, N5 set across Stations 2–3, never Station 1', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const kanji = readItems<KanjiItem>(root, 'kanji/n5/kanji-n5-001.json');
    const firstUse = new Map<string, number>();
    for (const k of [...kanji].sort((a, b) => a.station! - b.station!)) for (const name of k.components) {
      const c = COMPONENTS.find((x) => x.name === name);
      if (c && !firstUse.has(c.id)) firstUse.set(c.id, k.station!);
    }
    expect(r.bundles[0]!.componentIds).toEqual([]);
    const placedAt = new Map<string, number>();
    for (const b of r.bundles) for (const id of b.componentIds) placedAt.set(id, b.number);
    expect(placedAt.size).toBe(firstUse.size);
    for (const [id, st] of placedAt) {
      expect(st).toBeGreaterThanOrEqual(2);
      expect(st).toBeLessThan(firstUse.get(id)!);
      expect([2, 3]).toContain(st); // all first used by N5 kanji
    }
    expect(r.bundles[1]!.componentIds.length).toBeGreaterThan(0);
    expect(r.bundles[2]!.componentIds.length).toBeGreaterThan(0);
    // placeComponents: a later-level first use lands at station − 1
    const late = placeComponents([{ item: { ...kanji[1]!, station: 20, components: ['moon'] } }], COMPONENTS);
    expect(late.byStation.get(19)).toEqual(['c-moon']);
  });

  it('surfaces resolve every allowlisted word / kana / altForm and are cumulative', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const vocab = allVocab(root);
    for (const b of r.bundles) {
      for (const v of vocab) {
        if (v.station! > b.number) continue;
        for (const s of vocabSurfaceList(v)) expect(b.surfaces[s]).toBeDefined();
      }
    }
    expect(r.bundles[0]!.surfaces['下さい']).toBe('v-n5-0010');
    expect(r.bundles[0]!.surfaces['飲む']).toBe('v-n5-0011');
    expect(Object.keys(r.bundles[52]!.surfaces)).toEqual(Object.keys(r.bundles[52]!.surfaces).sort());
  });

  it('orders vocab by frequencyRank within a level when present', () => {
    const { root, plan } = synthCorpus({ ranked: true });
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    expect(r.bundles[0]!.vocabIds).toContain('v-n5-0800');
    expect(r.bundles[0]!.vocabIds).not.toContain('v-n5-0001');
    expect(allVocab(root).find((v) => v.id === 'v-n5-0001')!.station).toBe(15);
  });

  it('is idempotent and bundlesFromCorpus regenerates the written bundles byte-identically', () => {
    const { root, plan } = synthCorpus();
    const allow = tmp('allow-');
    assign(root, plan, { allowlistsDir: allow });
    const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
    const before = { stations: snapshot(join(root, 'stations')), vocab: snapshot(join(root, 'vocab/n5')), allow: snapshot(allow) };
    const second = assign(root, plan, { allowlistsDir: allow });
    expect(second.report).toMatch(/wrote 0 changed content file/);
    expect(snapshot(join(root, 'stations'))).toEqual(before.stations);
    expect(snapshot(join(root, 'vocab/n5'))).toEqual(before.vocab);
    expect(snapshot(allow)).toEqual(before.allow);
    const regenerated = bundlesFromCorpus(root);
    regenerated.forEach((b: StationBundle) => {
      expect(JSON.stringify(b, null, 2) + '\n').toBe(before.stations[`${String(b.number).padStart(2, '0')}.json`]);
    });
  });

  it('writes cumulative allowlists; Stations 1–3 share the White set; names include the cast and story names', () => {
    const { root, plan } = synthCorpus();
    const allow = tmp('allow-');
    const r = assign(root, plan, { allowlistsDir: allow });
    expect(readdirSync(allow).length).toBe(53);
    const a1 = r.allowlists[1]!;
    const a3 = r.allowlists[3]!;
    const a4 = r.allowlists[4]!;
    expect(a1.vocab).toEqual(a3.vocab);
    expect(a3.vocab.length).toBe(80);
    expect(a4.vocab.length).toBe(140);
    expect(a4.grammar.length).toBe(8);
    expect(a4.kana.length).toBe(21);
    expect(a4.names).toContain('ハナ');
    expect(a4.names).toContain('ミカ');
    expect(a3.names).not.toContain('ミカ');
    expect(a4.surfaces[kanaWord(1 + 50000)]).toBe('v-n5-0001');
    const onDisk = JSON.parse(readFileSync(join(allow, 'station-04.json'), 'utf8')) as { vocab: string[] };
    expect(onDisk.vocab).toEqual(a4.vocab);
  });

  it('dry run writes nothing and reports missing plan files', () => {
    const { root, plan } = synthCorpus();
    const extra: PlanEntry = { path: 'public/content/vocab/n4/vocab-n4-001.json', type: 'vocab', pass: 1, belt: null, jlpt: 4, count: 1, idPrefix: '', idStart: 1 };
    const r = assign(root, [...plan, extra], { write: false, allowlistsDir: tmp('allow-') });
    expect(r.missingFiles).toEqual(['vocab/n4/vocab-n4-001.json']);
    expect(existsSync(join(root, 'stations'))).toBe(false);
    expect(allVocab(root).every((v) => v.station === undefined)).toBe(true);
    expect(r.bundles[0]!.vocabIds.length).toBe(20);
    expect(r.report).toMatch(/dry run/);
  });

  it('ranked level: files ordered by median rank, items by rank within a file, so a station spans ≤ 3 files', () => {
    const { root, plan } = synthCorpus({ ranked: true });
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const fileOf = new Map<string, string>();
    for (const f of readdirSync(join(root, 'vocab/n5')).sort()) for (const v of readItems<VocabItem>(root, `vocab/n5/${f}`)) fileOf.set(v.id, f);
    for (const b of r.bundles.slice(0, 15)) {
      const files = new Set(b.vocabIds.map((id) => fileOf.get(id)));
      expect(files.size).toBeLessThanOrEqual(3);
    }
    // ranks run 800 → 1 across the corpus, so file 6 (ranks 1–130) comes first and fills Station 1 alone
    expect(r.bundles[0]!.vocabIds.length).toBeGreaterThan(0);
    expect(r.bundles[0]!.vocabIds.every((id) => fileOf.get(id) === 'vocab-n5-006.json')).toBe(true);
    const a = allVocab(root);
    const station = (id: string) => a.find((v) => v.id === id)!.station!;
    expect(station('v-n5-0800')).toBe(1);
    expect(station('v-n5-0671')).toBeLessThanOrEqual(station('v-n5-0670')); // file 6 (least ranks) before file 5
    expect(station('v-n5-0671')).toBeLessThan(station('v-n5-0536')); // … and before the rest of file 5
    expect(station('v-n5-0001')).toBe(15);
  });

  it('orderRankedVocab: median-ordered files, rank within a file, unranked last; an unranked level keeps plan order', () => {
    const mk = (rel: string, ranks: (number | undefined)[]) => ranks.map((r, i) => ({ item: { ...vocabItem(5, i + 1), ...(r === undefined ? {} : { frequencyRank: r }) }, file: { rel } }));
    const a = mk('a', [50, 10, 30]); // median 30
    const b = mk('b', [5, 200, 7]); // median 7 → first
    const out = orderRankedVocab([...a, ...b]);
    expect(out.map((p) => `${p.file.rel}${p.item.frequencyRank}`)).toEqual(['b5', 'b7', 'b200', 'a10', 'a30', 'a50']);
    expect(orderRankedVocab(mk('a', [undefined, 3, undefined])).map((p) => p.item.frequencyRank)).toEqual([3, undefined, undefined]);
    const plain = [...mk('a', [undefined, undefined]), ...mk('b', [undefined])];
    expect(orderRankedVocab(plain)).toEqual(plain);
    // a file without ranks sorts after every ranked file
    expect(orderRankedVocab([...mk('z', [undefined]), ...mk('y', [9])]).map((p) => p.file.rel)).toEqual(['y', 'z']);
  });

  it('a single-kanji stem links only before okurigana: 有名 is not ある while 食べ始めた is still 食べる', () => {
    const aru = vocabItem(5, 9001, { word: 'ある', kana: 'ある', pos: 'v5', altForms: ['有る', '在る'] });
    const taberu = vocabItem(5, 9002, { word: '食べる', kana: 'たべる', pos: 'v1' });
    const maku = vocabItem(5, 9003, { word: '巻く', kana: 'まく', pos: 'v5' });
    const amai = vocabItem(5, 9004, { word: '甘い', kana: 'あまい', pos: 'adj-i' });
    const miru = vocabItem(5, 9005, { word: '見る', kana: 'みる', pos: 'v1' });
    const tateru = vocabItem(5, 9006, { word: '建てる', kana: 'たてる', pos: 'v1' });
    const pool = buildMatchPool([aru, taberu, maku, amai, miru, tateru], []);
    expect(matchToken(pool, '有名')).toEqual({ id: null, known: false, punct: false });
    expect(matchToken(pool, '有った').id).toBe(aru.id);
    expect(matchToken(pool, '在りました').id).toBe(aru.id);
    expect(matchToken(pool, 'あった').known).toBe(true); // function token
    expect(matchToken(pool, '食べ始めた').id).toBe(taberu.id);
    expect(matchToken(pool, '食べ方').id).toBe(taberu.id);
    expect(matchToken(pool, '建て直した').id).toBe(tateru.id);
    expect(matchToken(pool, '巻物').id).toBeNull();
    expect(matchToken(pool, '巻いて').id).toBe(maku.id);
    expect(matchToken(pool, '甘酒').id).toBeNull();
    expect(matchToken(pool, '甘くて').id).toBe(amai.id);
    expect(matchToken(pool, '見').id).toBe(miru.id); // bare ren'yōkei (見に行く)
    expect(matchToken(pool, '見物').id).toBeNull();
    expect(stemApplies('有', '有名')).toBe(false);
    expect(stemApplies('有', '有る')).toBe(true);
    expect(stemApplies('食べ', '食べ始めた')).toBe(true);
  });

  it('links story tokenIds against the cumulative allowlist (matchToken semantics)', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    expect(r.linked).toBe(1);
    const story = readItems<{ lines: { tokens: string[]; tokenIds: (string | null)[] }[] }>(root, 'stories/n5/stories-s04.json')[0]!;
    expect(story.lines[0]!.tokenIds).toEqual(['v-n5-0001', null, null]);
    const pool = buildMatchPool(allVocab(root).slice(0, 20), [grammarItem(1)]);
    expect(matchToken(pool, '飲みます').id).toBe('v-n5-0011');
    expect(matchToken(pool, '下さい').id).toBe('v-n5-0010');
    expect(matchToken(pool, 'ハナさん').known).toBe(true);
    expect(matchToken(pool, '三').known).toBe(true);
    expect(matchToken(pool, '。').punct).toBe(true);
    expect(matchToken(pool, 'りんご').known).toBe(false);
  });

  it('POS floors pull core verbs to Station 6 and い/な-adjectives to Station 7 without moving later boundaries', () => {
    const { root, plan } = synthCorpus();
    // vocab-n5-003 (v-n5-0271…0405) is where the N5 briefs put every verb and adjective.
    const rel = 'vocab/n5/vocab-n5-003.json';
    const items = readItems<VocabItem>(root, rel);
    items.forEach((v, i) => {
      if (i < 20) v.pos = 'v5'; // v-n5-0271…0290
      else if (i < 28) v.pos = 'adj-i'; // v-n5-0291…0298
      else if (i < 34) v.pos = 'adj-na'; // v-n5-0299…0304
    });
    writeJson(join(root, rel), { schema: 'tsuzuku.content/1', type: 'vocab', level: 'n5', items });
    const plain = assign(root, plan, { allowlistsDir: tmp('allow-'), write: false, posFloors: [] });
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const posOf = new Map(allVocab(root).map((v) => [v.id, v.pos]));
    const count = (b: StationBundle, pos: string) => b.vocabIds.filter((id) => posOf.get(id) === pos).length;
    // plan order alone leaves Station 6 verbless (the Vます station)
    expect(count(plain.bundles[5]!, 'v5')).toBe(0);
    expect(count(plain.bundles[6]!, 'adj-na')).toBe(6);
    // floors: the first 12 verbs land at Station 6, the remaining 8 at 7; 8 い- and 6 な-adjectives at Station 7
    expect(count(r.bundles[5]!, 'v5')).toBe(12);
    expect(r.bundles[5]!.vocabIds).toContain('v-n5-0271');
    expect(r.bundles[5]!.vocabIds).toContain('v-n5-0282');
    expect(count(r.bundles[6]!, 'v5')).toBe(8);
    expect(count(r.bundles[6]!, 'adj-i')).toBe(8);
    expect(count(r.bundles[6]!, 'adj-na')).toBe(6);
    // the displaced tail of Station 6 moved to 7; quotas and every later boundary are unchanged
    expect(r.bundles[6]!.vocabIds).toContain('v-n5-0249');
    for (const b of r.bundles) expect(b.vocabIds.length).toBe(plain.bundles[b.number - 1]!.vocabIds.length);
    const upTo = (bs: StationBundle[], n: number) => bs.filter((b) => b.number <= n).flatMap((b) => b.vocabIds).sort();
    expect(upTo(r.bundles, 6)).not.toEqual(upTo(plain.bundles, 6));
    expect(upTo(r.bundles, 7)).toEqual(upTo(plain.bundles, 7));
    for (const b of r.bundles.slice(7)) expect([...b.vocabIds].sort()).toEqual([...plain.bundles[b.number - 1]!.vocabIds].sort());
    expect(allVocab(root).find((v) => v.id === 'v-n5-0271')!.station).toBe(6);
    expect(allVocab(root).find((v) => v.id === 'v-n5-0253')!.station).toBe(7);
  });
});
