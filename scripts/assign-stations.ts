/**
 * TSUZUKU — station assigner (docs/station-allocation.md §5).
 *
 *   node scripts/assign-stations.ts [--root <content dir>] [--plan <content-plan.json>] [--allowlists <dir>] [--dry-run]
 *
 * 1. Walks `docs/content-plan.json` Pass-1 vocab/kanji/grammar files per level
 *    in plan order (vocab sorted by `frequencyRank` within a level when present).
 * 2. Kanji: stable topological sort so a character never precedes a kanji that
 *    is one of its components (same level only).
 * 3. Walks STATIONS in road order popping each station's quota from the level
 *    stream (N5 vocab also feeds Stations 1–3); the level's last station absorbs
 *    surplus / deficit.
 * 4. Kana by station: 1 ← hiragana basic/dakuten/handakuten, 2 ← hiragana yōon +
 *    katakana basic, 3 ← remaining katakana.
 * 5. Components (`_meta/components.json`) land one station ahead of the first
 *    kanji that uses them; the N5 set is spread over Stations 2–3; never Station 1.
 * 6. Writes `station` IN PLACE (pretty JSON, key order preserved), emits
 *    `stations/NN.json` StationBundles and `docs/allowlists/station-NN.json`.
 *
 * Idempotent: a second run rewrites byte-identical files. Bundles are derived
 * from the `station` fields on disk (`bundlesFromCorpus`), which is also what
 * the validator's V35 check regenerates.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { STATIONS } from '../src/content/types.ts';
import { hasKanji } from '../src/content/ruby.ts';
import type {
  ComponentDef,
  ContentKind,
  GrammarItem,
  KanaItem,
  KanjiItem,
  Level,
  MichikusaItem,
  StationBundle,
  StationDef,
  StoryItem,
  VocabItem,
} from '../src/content/types.ts';
/* ────────────────────────────────────────────────────────────────────────── */
/* Public types                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** One row of `docs/content-plan.json`. */
export interface PlanEntry {
  /** `public/content/vocab/n5/vocab-n5-001.json` (or relative to the content root). */
  path: string;
  type: ContentKind | 'denylist';
  pass: number;
  belt: string | null;
  jlpt: number | null;
  count: number;
  idPrefix: string;
  idStart: number;
  brief?: string;
  task?: string;
}

export interface Allowlist {
  station: number;
  vocab: string[];
  grammar: string[];
  kana: string[];
  names: string[];
  /** surface (word / kana / altForm) → vocab id, cumulative ≤ station. */
  surfaces: Record<string, string>;
}

export interface AssignOptions {
  /** Write station fields, bundles and allowlists (default true). */
  write?: boolean;
  /** Directory for `station-NN.json` allowlists (default `<root>/../../docs/allowlists`). */
  allowlistsDir?: string;
}

export interface AssignResult {
  bundles: StationBundle[];
  allowlists: Record<number, Allowlist>;
  report: string;
  /** Items that received a station, per kind. */
  assigned: Record<'vocab' | 'kanji' | 'grammar' | 'kana', number>;
  /** Plan files that do not exist on disk yet. */
  missingFiles: string[];
  /** Story lines linked with tokenIds (0 on a dry run). */
  linked: number;
}

/** Fixed Tabi Nikki cast (CONTENT_GUIDE §14.1): always allowlisted names. */
export const CAST_NAMES: ReadonlySet<string> = new Set(['ハナ', 'ケン', 'アオ', '田中', '田中さん']);

/* ────────────────────────────────────────────────────────────────────────── */
/* JSON helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Canonical serialization for every generated/rewritten JSON file. */
export function stringifyJson(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n';
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

function writeIfChanged(p: string, text: string): boolean {
  if (existsSync(p) && readFileSync(p, 'utf8') === text) return false;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return true;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

interface Envelope<T> {
  schema: string;
  type: ContentKind;
  level?: Level;
  items: T[];
  [k: string]: unknown;
}

interface ContentFileOnDisk<T> {
  rel: string;
  abs: string;
  env: Envelope<T>;
}

function kindOfRel(rel: string): ContentKind | null {
  const seg = rel.split('/')[0] ?? '';
  if (seg === 'stories') return 'story';
  if (seg === '_meta') return rel === '_meta/components.json' ? 'component' : null;
  if (['kana', 'vocab', 'kanji', 'grammar', 'conjugation', 'michikusa'].includes(seg)) return seg as ContentKind;
  return null;
}

function loadFiles<T>(root: string, kinds: ReadonlySet<ContentKind>): ContentFileOnDisk<T>[] {
  const out: ContentFileOnDisk<T>[] = [];
  for (const abs of walk(root)) {
    const rel = toRel(root, abs);
    if (rel === 'manifest.json' || rel.startsWith('stations/')) continue;
    const kind = kindOfRel(rel);
    if (!kind || !kinds.has(kind)) continue;
    try {
      const env = readJson<Envelope<T>>(abs);
      if (env && Array.isArray(env.items)) out.push({ rel, abs, env });
    } catch {
      /* the validator reports broken JSON */
    }
  }
  return out;
}

function planRel(path: string): string {
  return path.replace(/^\.?\/?public\/content\//, '').replace(/^\//, '');
}

function levelOfRel(rel: string): Level | null {
  const m = /^(?:vocab|kanji|grammar|stories)\/(kana|n[1-5]|dan)\//.exec(rel);
  return m ? (m[1] as Level) : null;
}

function stationLevel(st: StationDef): Level {
  return st.jlpt === null ? 'n5' : (`n${st.jlpt}` as Level);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Assignment                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

interface Placed<T> {
  item: T;
  file: ContentFileOnDisk<T>;
}

type Kind3 = 'vocab' | 'kanji' | 'grammar';

/** Stable dependency-first order: a kanji follows every same-level kanji among its components. */
export function topoSortKanji(items: KanjiItem[], components: ComponentDef[]): KanjiItem[] {
  const nameToChars = new Map<string, string[]>();
  for (const c of components) {
    const chars = [c.char, ...(c.variants ?? [])].filter((x): x is string => typeof x === 'string');
    nameToChars.set(String(c.name).toLowerCase(), chars);
  }
  const byChar = new Map<string, KanjiItem>();
  for (const k of items) if (typeof k.char === 'string') byChar.set(k.char, k);
  const deps = (k: KanjiItem): KanjiItem[] => {
    const out: KanjiItem[] = [];
    for (const name of k.components ?? []) {
      const chars = nameToChars.get(String(name).toLowerCase()) ?? [];
      // A component name can also be the kanji character itself (self-primitive) — skip self.
      for (const ch of chars) {
        const dep = byChar.get(ch);
        if (dep && dep !== k && !out.includes(dep)) out.push(dep);
      }
      // Kanji whose own char appears as a component glyph of another item (no ComponentDef lookup).
      const direct = byChar.get(String(name));
      if (direct && direct !== k && !out.includes(direct)) out.push(direct);
    }
    return out;
  };
  const state = new Map<KanjiItem, 1 | 2>(); // 1 visiting, 2 done
  const out: KanjiItem[] = [];
  const visit = (k: KanjiItem) => {
    const s = state.get(k);
    if (s === 2) return;
    if (s === 1) return; // cycle: ignore the edge
    state.set(k, 1);
    for (const d of deps(k)) visit(d);
    state.set(k, 2);
    out.push(k);
  };
  for (const k of items) visit(k);
  return out;
}

function kanaStation(k: KanaItem): number | null {
  if (k.script === 'hiragana') return k.type === 'yoon' ? 2 : 1;
  if (k.script === 'katakana') return k.type === 'basic' ? 2 : 3;
  return null;
}

export function assign(root: string, plan: PlanEntry[], opts: AssignOptions = {}): AssignResult {
  root = resolve(root);
  const write = opts.write !== false;
  const allowlistsDir = resolve(opts.allowlistsDir ?? join(root, '..', '..', 'docs', 'allowlists'));
  const components = loadComponents(root);
  const missingFiles: string[] = [];
  const reportLines: string[] = [];

  // 1. Streams per (kind, level) in plan order.
  const streams = new Map<string, Placed<VocabItem | KanjiItem | GrammarItem>[]>();
  const touched = new Map<string, ContentFileOnDisk<VocabItem | KanjiItem | GrammarItem | KanaItem>>();
  const planFiles = plan.filter((e) => e.pass === 1 && (e.type === 'vocab' || e.type === 'kanji' || e.type === 'grammar'));
  for (const e of planFiles) {
    const rel = planRel(e.path);
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      missingFiles.push(rel);
      continue;
    }
    let env: Envelope<VocabItem | KanjiItem | GrammarItem>;
    try {
      env = readJson(abs);
    } catch {
      missingFiles.push(`${rel} (unreadable)`);
      continue;
    }
    if (!Array.isArray(env.items)) continue;
    const level = levelOfRel(rel) ?? env.level ?? null;
    if (!level) continue;
    const file: ContentFileOnDisk<VocabItem | KanjiItem | GrammarItem> = { rel, abs, env };
    touched.set(rel, file as ContentFileOnDisk<VocabItem | KanjiItem | GrammarItem | KanaItem>);
    const key = `${e.type}/${level}`;
    const arr = streams.get(key) ?? [];
    for (const item of env.items) arr.push({ item, file });
    streams.set(key, arr);
  }
  // Vocab: frequencyRank within level when present (stable; unranked after ranked).
  for (const [key, arr] of streams) {
    if (!key.startsWith('vocab/')) continue;
    if (!arr.some((p) => typeof (p.item as VocabItem).frequencyRank === 'number')) continue;
    const ranked = arr.map((p, i) => ({ p, i, r: typeof (p.item as VocabItem).frequencyRank === 'number' ? ((p.item as VocabItem).frequencyRank as number) : Number.POSITIVE_INFINITY }));
    ranked.sort((a, b) => a.r - b.r || a.i - b.i);
    streams.set(key, ranked.map((x) => x.p));
  }
  // 2. Kanji topological sort per level.
  for (const [key, arr] of streams) {
    if (!key.startsWith('kanji/')) continue;
    const byItem = new Map<KanjiItem, Placed<VocabItem | KanjiItem | GrammarItem>>();
    for (const p of arr) byItem.set(p.item as KanjiItem, p);
    const sorted = topoSortKanji(arr.map((p) => p.item as KanjiItem), components);
    streams.set(key, sorted.map((k) => byItem.get(k)!));
  }

  // 3. Walk stations.
  const assignment = new Map<Kind3, Map<number, Placed<VocabItem | KanjiItem | GrammarItem>[]>>([
    ['vocab', new Map()],
    ['kanji', new Map()],
    ['grammar', new Map()],
  ]);
  const cursors = new Map<string, number>();
  const lastStationOfLevel = new Map<string, number>(); // `${kind}/${level}` → last station with quota > 0
  for (const st of STATIONS) {
    const lvl = stationLevel(st);
    for (const kind of ['vocab', 'kanji', 'grammar'] as const) {
      if (st.quota[kind] > 0) lastStationOfLevel.set(`${kind}/${lvl}`, st.number);
    }
  }
  for (const st of STATIONS) {
    const lvl = stationLevel(st);
    for (const kind of ['vocab', 'kanji', 'grammar'] as const) {
      const key = `${kind}/${lvl}`;
      const stream = streams.get(key) ?? [];
      let cur = cursors.get(key) ?? 0;
      const take = st.quota[kind];
      const slice = stream.slice(cur, cur + take);
      cur += slice.length;
      if (lastStationOfLevel.get(key) === st.number && cur < stream.length) {
        // surplus → last station of the level
        slice.push(...stream.slice(cur));
        cur = stream.length;
      }
      cursors.set(key, cur);
      if (slice.length > 0) assignment.get(kind)!.set(st.number, slice);
    }
  }
  // Streams whose level has no station quota at all (e.g. kanji/n1 hook): stay unassigned.
  const unassigned: string[] = [];
  for (const [key, stream] of streams) {
    const cur = cursors.get(key) ?? 0;
    if (cur < stream.length) unassigned.push(`${key}: ${stream.length - cur} items left without a station`);
  }

  // Apply station fields.
  const stationOf = new Map<unknown, number>();
  for (const [, perStation] of assignment) for (const [n, arr] of perStation) for (const p of arr) stationOf.set(p.item, n);
  const assignedCount = { vocab: 0, kanji: 0, grammar: 0, kana: 0 };
  for (const [key, stream] of streams) {
    const kind = key.split('/')[0] as Kind3;
    for (const p of stream) {
      const n = stationOf.get(p.item);
      const rec = p.item as unknown as Record<string, unknown>;
      if (n === undefined) delete rec['station'];
      else {
        rec['station'] = n;
        assignedCount[kind]++;
      }
    }
  }
  // 4. Kana.
  const kanaFiles = loadFiles<KanaItem>(root, new Set<ContentKind>(['kana']));
  for (const f of kanaFiles) {
    for (const k of f.env.items) {
      const n = kanaStation(k);
      const rec = k as unknown as Record<string, unknown>;
      if (n === null) delete rec['station'];
      else {
        rec['station'] = n;
        assignedCount.kana++;
      }
    }
    touched.set(f.rel, f as ContentFileOnDisk<VocabItem | KanjiItem | GrammarItem | KanaItem>);
  }
  // 6. Write items in place.
  let rewritten = 0;
  if (write) {
    for (const f of touched.values()) if (writeIfChanged(f.abs, stringifyJson(f.env))) rewritten++;
  }

  // 5 + bundles (+ components) derived from the station fields.
  const derived = write ? bundlesFromCorpusDetailed(root, components) : bundlesFromItems(collectItems(root, touched), components);
  const bundles = derived.bundles;
  if (write) {
    for (const b of bundles) writeIfChanged(join(root, 'stations', `${pad2(b.number)}.json`), stringifyJson(b));
  }
  // Allowlists.
  const allowlists = buildAllowlists(bundles, derived.storyNames);
  if (write) {
    for (const [n, a] of Object.entries(allowlists)) writeIfChanged(join(allowlistsDir, `station-${pad2(Number(n))}.json`), stringifyJson(a));
  }
  // Linker: StoryLine.tokenIds from the V20 match (must precede content:index so the manifest hashes linked files).
  const link = write ? linkStories(root, bundles, true) : { linked: 0, changed: [] };

  // Quota report.
  reportLines.push('station  belt    vocab      kanji     grammar   kana  comp  stories  michikusa');
  for (const st of STATIONS) {
    const b = bundles[st.number - 1]!;
    const cell = (have: number, q: number) => {
      const flag = q === 0 ? (have > 0 ? '!' : ' ') : Math.abs(have - q) > q * 0.1 ? '!' : ' ';
      return `${String(have).padStart(3)}/${String(q).padEnd(3)}${flag}`;
    };
    reportLines.push(
      `${pad2(st.number)} ${st.nameRomaji.padEnd(12).slice(0, 12)} ${st.belt.padEnd(7)} ${cell(b.vocabIds.length, st.quota.vocab)} ${cell(b.kanjiIds.length, st.quota.kanji)} ${cell(
        b.grammarIds.length,
        st.quota.grammar,
      )} ${String(b.kanaIds.length).padStart(4)}  ${String(b.componentIds.length).padStart(4)}  ${String(b.storyIds.length).padStart(3)}/${st.quota.stories}     ${String(b.michikusaIds.length).padStart(2)}`,
    );
  }
  const totals = bundles.reduce(
    (acc, b) => {
      acc.vocab += b.vocabIds.length;
      acc.kanji += b.kanjiIds.length;
      acc.grammar += b.grammarIds.length;
      acc.kana += b.kanaIds.length;
      acc.components += b.componentIds.length;
      acc.stories += b.storyIds.length;
      acc.michikusa += b.michikusaIds.length;
      return acc;
    },
    { vocab: 0, kanji: 0, grammar: 0, kana: 0, components: 0, stories: 0, michikusa: 0 },
  );
  reportLines.push(`totals: vocab ${totals.vocab}/6350 · kanji ${totals.kanji}/1000 · grammar ${totals.grammar}/450 · kana ${totals.kana}/238 · components ${totals.components}/${components.length} · stories ${totals.stories}/137 · michikusa ${totals.michikusa}/212`);
  if (derived.unplacedComponents.length > 0) reportLines.push(`components used by no kanji (not placed): ${derived.unplacedComponents.length}`);
  for (const u of unassigned) reportLines.push(`unassigned: ${u}`);
  if (missingFiles.length > 0) reportLines.push(`plan files missing on disk: ${missingFiles.length} (${missingFiles.slice(0, 5).join(', ')}${missingFiles.length > 5 ? ', …' : ''})`);
  reportLines.push(write ? `wrote ${rewritten} changed content file(s), ${bundles.length} bundles, ${Object.keys(allowlists).length} allowlists → ${allowlistsDir}` : 'dry run: nothing written');
  reportLines.push(write ? `linked ${link.linked} story line(s); ${link.changed.length} story file(s) rewritten with tokenIds` : 'dry run: stories not linked');
  reportLines.push('("!" = outside ±10 % of quota)');
  return { bundles, allowlists, report: reportLines.join('\n'), assigned: assignedCount, missingFiles, linked: link.linked };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Bundles derived from the corpus                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export function loadComponents(root: string): ComponentDef[] {
  const p = join(root, '_meta', 'components.json');
  if (!existsSync(p)) return [];
  try {
    const env = readJson<Envelope<ComponentDef>>(p);
    return Array.isArray(env.items) ? env.items : [];
  } catch {
    return [];
  }
}

interface CorpusItems {
  vocab: { item: VocabItem; rel: string }[];
  kanji: { item: KanjiItem; rel: string }[];
  grammar: { item: GrammarItem; rel: string }[];
  kana: { item: KanaItem; rel: string }[];
  stories: { item: StoryItem; rel: string }[];
  michikusa: { item: MichikusaItem; rel: string }[];
}

function emptyCorpus(): CorpusItems {
  return { vocab: [], kanji: [], grammar: [], kana: [], stories: [], michikusa: [] };
}

function collectFromDisk(root: string): CorpusItems {
  const c = emptyCorpus();
  for (const f of loadFiles<unknown>(root, new Set<ContentKind>(['vocab', 'kanji', 'grammar', 'kana', 'story', 'michikusa']))) {
    const kind = kindOfRel(f.rel);
    for (const item of f.env.items) {
      if (!item || typeof item !== 'object') continue;
      switch (kind) {
        case 'vocab':
          c.vocab.push({ item: item as VocabItem, rel: f.rel });
          break;
        case 'kanji':
          c.kanji.push({ item: item as KanjiItem, rel: f.rel });
          break;
        case 'grammar':
          c.grammar.push({ item: item as GrammarItem, rel: f.rel });
          break;
        case 'kana':
          c.kana.push({ item: item as KanaItem, rel: f.rel });
          break;
        case 'story':
          c.stories.push({ item: item as StoryItem, rel: f.rel });
          break;
        case 'michikusa':
          c.michikusa.push({ item: item as MichikusaItem, rel: f.rel });
          break;
        default:
          break;
      }
    }
  }
  return c;
}

/** In-memory variant for dry runs: items already mutated in `touched`, the rest from disk. */
function collectItems(root: string, touched: Map<string, ContentFileOnDisk<unknown>>): CorpusItems {
  const disk = collectFromDisk(root);
  const c = emptyCorpus();
  const keep = (rel: string) => !touched.has(rel);
  c.vocab = disk.vocab.filter((x) => keep(x.rel));
  c.kanji = disk.kanji.filter((x) => keep(x.rel));
  c.grammar = disk.grammar.filter((x) => keep(x.rel));
  c.kana = disk.kana.filter((x) => keep(x.rel));
  c.stories = disk.stories;
  c.michikusa = disk.michikusa;
  for (const f of touched.values()) {
    const kind = kindOfRel(f.rel);
    for (const item of f.env.items) {
      if (kind === 'vocab') c.vocab.push({ item: item as VocabItem, rel: f.rel });
      else if (kind === 'kanji') c.kanji.push({ item: item as KanjiItem, rel: f.rel });
      else if (kind === 'grammar') c.grammar.push({ item: item as GrammarItem, rel: f.rel });
      else if (kind === 'kana') c.kana.push({ item: item as KanaItem, rel: f.rel });
    }
  }
  const byRel = (a: { rel: string }, b: { rel: string }) => a.rel.localeCompare(b.rel);
  c.vocab.sort(byRel);
  c.kanji.sort(byRel);
  c.grammar.sort(byRel);
  c.kana.sort(byRel);
  return c;
}

export interface DerivedBundles {
  bundles: StationBundle[];
  /** vocab id → item (for allowlist surfaces). */
  vocab: Map<string, VocabItem>;
  /** station → names used by stories at that station. */
  storyNames: Map<number, string[]>;
  unplacedComponents: string[];
}

/** Component placement from kanji `station` fields (station-allocation §5 step 2b). */
export function placeComponents(kanji: { item: KanjiItem }[], components: ComponentDef[]): { byStation: Map<number, string[]>; unplaced: string[] } {
  const byName = new Map<string, ComponentDef>();
  for (const c of components) byName.set(String(c.name).toLowerCase(), c);
  // first station per component, in order of first use (station, then kanji order, then component order)
  const firstUse = new Map<string, number>();
  const order: string[] = [];
  const sorted = [...kanji].filter((k) => typeof k.item.station === 'number').sort((a, b) => (a.item.station as number) - (b.item.station as number));
  for (const k of sorted) {
    for (const name of k.item.components ?? []) {
      const c = byName.get(String(name).toLowerCase());
      if (!c) continue;
      if (!firstUse.has(c.id)) {
        firstUse.set(c.id, k.item.station as number);
        order.push(c.id);
      }
    }
  }
  const byStation = new Map<number, string[]>();
  const push = (n: number, id: string) => {
    const arr = byStation.get(n) ?? [];
    arr.push(id);
    byStation.set(n, arr);
  };
  const n5First = order.filter((id) => {
    const st = firstUse.get(id)!;
    const def = STATIONS[st - 1];
    return def !== undefined && def.jlpt === 5;
  });
  const half = Math.ceil(n5First.length / 2);
  n5First.forEach((id, i) => push(i < half ? 2 : 3, id));
  for (const id of order) {
    if (n5First.includes(id)) continue;
    const st = firstUse.get(id)!;
    push(Math.max(2, st - 1), id);
  }
  const placed = new Set(order);
  const unplaced = components.map((c) => c.id).filter((id) => !placed.has(id));
  return { byStation, unplaced };
}

function bundlesFromItems(c: CorpusItems, components: ComponentDef[]): DerivedBundles {
  const vocabById = new Map<string, VocabItem>();
  const perStation = new Map<number, { kana: string[]; vocab: string[]; kanji: string[]; grammar: string[]; files: Set<string> }>();
  const slot = (n: number) => {
    let s = perStation.get(n);
    if (!s) {
      s = { kana: [], vocab: [], kanji: [], grammar: [], files: new Set() };
      perStation.set(n, s);
    }
    return s;
  };
  for (const { item, rel } of c.kana) if (typeof item.station === 'number') {
    const s = slot(item.station);
    s.kana.push(item.id);
    s.files.add(rel);
  }
  for (const { item, rel } of c.vocab) {
    vocabById.set(item.id, item);
    if (typeof item.station === 'number') {
      const s = slot(item.station);
      s.vocab.push(item.id);
      s.files.add(rel);
    }
  }
  for (const { item, rel } of c.kanji) if (typeof item.station === 'number') {
    const s = slot(item.station);
    s.kanji.push(item.id);
    s.files.add(rel);
  }
  for (const { item, rel } of c.grammar) if (typeof item.station === 'number') {
    const s = slot(item.station);
    s.grammar.push(item.id);
    s.files.add(rel);
  }
  const stories = new Map<number, { ids: string[]; files: Set<string> }>();
  const storyNames = new Map<number, string[]>();
  for (const { item, rel } of c.stories) {
    const n = Number(/^st-(\d{2})$/.exec(String(item.stationId))?.[1] ?? NaN);
    if (!Number.isInteger(n) || n < 1 || n > STATIONS.length) continue;
    const s = stories.get(n) ?? { ids: [], files: new Set() };
    s.ids.push(item.id);
    s.files.add(rel);
    stories.set(n, s);
    if (Array.isArray(item.names)) storyNames.set(n, [...(storyNames.get(n) ?? []), ...item.names]);
  }
  const michikusa = new Map<number, { ids: string[]; files: Set<string> }>();
  for (const { item, rel } of c.michikusa) {
    const n = Number(/^st-(\d{2})$/.exec(String(item.stationId))?.[1] ?? NaN);
    if (!Number.isInteger(n) || n < 1 || n > STATIONS.length) continue;
    const s = michikusa.get(n) ?? { ids: [], files: new Set() };
    s.ids.push(item.id);
    s.files.add(rel);
    michikusa.set(n, s);
  }
  const comps = placeComponents(c.kanji, components);
  // Kanji inside a station keep dependency order (a component kanji precedes the kanji built from it).
  const kanjiById = new Map<string, KanjiItem>();
  for (const { item } of c.kanji) kanjiById.set(item.id, item);
  for (const s of perStation.values()) {
    if (s.kanji.length < 2) continue;
    const items = s.kanji.map((id) => kanjiById.get(id)).filter((k): k is KanjiItem => k !== undefined);
    s.kanji = topoSortKanji(items, components).map((k) => k.id);
  }

  const bundles: StationBundle[] = [];
  const surfaces: Record<string, string> = {};
  for (const st of STATIONS) {
    const n = st.number;
    const s = perStation.get(n) ?? { kana: [], vocab: [], kanji: [], grammar: [], files: new Set<string>() };
    for (const id of s.vocab) {
      const v = vocabById.get(id);
      if (!v) continue;
      for (const surf of vocabSurfaceList(v)) if (!(surf in surfaces)) surfaces[surf] = id;
    }
    const files = new Set(s.files);
    const sts = stories.get(n);
    const mk = michikusa.get(n);
    for (const f of sts?.files ?? []) files.add(f);
    for (const f of mk?.files ?? []) files.add(f);
    const componentIds = comps.byStation.get(n) ?? [];
    if (componentIds.length > 0) files.add('_meta/components.json');
    bundles.push({
      schema: 'tsuzuku.station/1',
      number: n,
      kanaIds: s.kana,
      vocabIds: s.vocab,
      kanjiIds: s.kanji,
      grammarIds: s.grammar,
      componentIds,
      storyIds: [...(sts?.ids ?? [])].sort(),
      michikusaIds: [...(mk?.ids ?? [])].sort(),
      files: [...files].sort(),
      surfaces: sortedRecord(surfaces),
    });
  }
  return { bundles, vocab: vocabById, storyNames, unplacedComponents: comps.unplaced };
}

/** Surfaces a vocab item contributes to `StationBundle.surfaces`: word, kana, altForms (〜 stripped). */
export function vocabSurfaceList(v: VocabItem): string[] {
  const bare = (s: string) => s.replace(/^〜/, '').replace(/〜$/, '');
  const out: string[] = [];
  for (const s of [v.word, v.kana, ...(v.altForms ?? [])]) {
    if (typeof s !== 'string') continue;
    const b = bare(s);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

function sortedRecord(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(r).sort()) out[k] = r[k]!;
  return out;
}

/**
 * Derives the 53 StationBundles from the `station` fields on disk (plus
 * stories/michikusa by `stationId` and component placement). Deterministic:
 * ids are ordered by file path then item order, surfaces sorted.
 */
export function bundlesFromCorpus(root: string, components?: ComponentDef[]): StationBundle[] {
  return bundlesFromCorpusDetailed(root, components).bundles;
}

export function bundlesFromCorpusDetailed(root: string, components?: ComponentDef[]): DerivedBundles {
  root = resolve(root);
  return bundlesFromItems(collectFromDisk(root), components ?? loadComponents(root));
}

function buildAllowlists(bundles: StationBundle[], storyNames: Map<number, string[]>): Record<number, Allowlist> {
  const out: Record<number, Allowlist> = {};
  const cumVocab: string[] = [];
  const cumGrammar: string[] = [];
  const cumKana: string[] = [];
  const cumNames: string[] = [...CAST_NAMES];
  for (const b of bundles) {
    cumVocab.push(...b.vocabIds);
    cumGrammar.push(...b.grammarIds);
    cumKana.push(...b.kanaIds);
    for (const nm of storyNames.get(b.number) ?? []) if (!cumNames.includes(nm)) cumNames.push(nm);
    out[b.number] = {
      station: b.number,
      vocab: [...cumVocab],
      grammar: [...cumGrammar],
      kana: [...cumKana],
      names: [...cumNames],
      surfaces: b.surfaces,
    };
  }
  // Stations 1–3 share the White allowlist (the whole set assigned to 1–3).
  const white = out[3];
  if (white) {
    for (const n of [1, 2]) {
      const a = out[n];
      if (!a) continue;
      a.vocab = [...white.vocab];
      a.surfaces = white.surfaces;
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Linker: token → item id (CONTENT_GUIDE §14.2 / V20), shared with the validator */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Function tokens that never count as unknown in V20: particles, copula and
 * ます-forms, て-form auxiliaries (dictionary, ます and て forms), する-forms and
 * name suffixes (CONTENT_GUIDE §14.2, extended with their inflections).
 */
export const FUNCTION_TOKENS: ReadonlySet<string> = new Set([
  // particles
  'は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も', 'か', 'ね', 'よ', 'な', 'わ', 'って',
  'や', 'し', 'ば', 'ても', 'でも', 'のに', 'ので', 'けど', 'けれど', 'けれども', 'のは', 'のが', 'には', 'では', 'とは', 'へは',
  'からは', 'までは', 'とか', 'だけ', 'しか', 'ほど', 'くらい', 'ぐらい', 'ずつ', 'など', 'なんて', 'かな', 'よね', 'ぞ', 'ぜ', 'さ', 'っけ',
  // copula and ます-forms
  'です', 'だ', 'でした', 'だった', 'じゃない', 'ではない', 'じゃありません', 'ではありません', 'じゃなかった', 'ではなかった',
  'でしょう', 'だろう', 'ます', 'ません', 'ました', 'ましょう', 'ませんでした', 'ましょうか', 'ませんか', 'なら', 'なの', 'なん',
  // て-form auxiliaries
  'いる', 'います', 'いた', 'いました', 'いない', 'いません', 'いて', 'ある', 'あります', 'あった', 'ありました', 'ない', 'ありません', 'あって',
  'おく', 'おきます', 'おいた', 'おいて', 'みる', 'みます', 'みた', 'みて', 'しまう', 'しまいます', 'しまった', 'しまって',
  'くれる', 'くれます', 'くれた', 'くれて', 'もらう', 'もらいます', 'もらった', 'もらって', 'あげる', 'あげます', 'あげた', 'あげて',
  'いく', 'いきます', 'いった', 'いって', 'くる', 'きます', 'きた', 'きて', 'する', 'します', 'した', 'して', 'しない', 'しません',
  // name suffixes
  'さん', 'ちゃん', 'くん', '様', 'さま', 'たち',
]);

const PUNCT_TOKEN_RE = /^[\p{P}\p{S}\s]+$/u;
const KANJI_NUMERAL_RE = /^[〇零一二三四五六七八九十百千万億兆]+$/;

export interface MatchPool {
  /** exact surface → vocab id */
  exact: Map<string, string>;
  /** inflection stems (longest first) → vocab id */
  prefixes: { s: string; id: string }[];
  /** counter surfaces (numeral prefix required) → vocab id */
  counters: { s: string; id: string }[];
  /** grammar clozeHints (longest first) → grammar id */
  hints: { h: string; id: string }[];
  /** plusOne vocab ids included in the pool */
  plusOne: Set<string>;
}

export interface TokenMatch {
  /** vocab/grammar id the token resolved to, or null (function token, name, numeral, punctuation, unknown). */
  id: string | null;
  known: boolean;
  punct: boolean;
}

function bareSurface(s: string): string {
  return s.replace(/^〜/, '').replace(/〜$/, '');
}

export function buildMatchPool(vocab: Iterable<VocabItem>, grammar: Iterable<GrammarItem>, plusOne: Iterable<VocabItem> = []): MatchPool {
  const pool: MatchPool = { exact: new Map(), prefixes: [], counters: [], hints: [], plusOne: new Set() };
  const add = (v: VocabItem) => {
    const word = typeof v.word === 'string' ? v.word : '';
    const kana = typeof v.kana === 'string' ? v.kana : '';
    const alts = Array.isArray(v.altForms) ? v.altForms.filter((a): a is string => typeof a === 'string') : [];
    if (v.pos === 'counter') {
      for (const s of [word, kana, ...alts]) if (s) pool.counters.push({ s: bareSurface(s), id: v.id });
      return;
    }
    const surfaces = [word, kana, ...alts].map(bareSurface).filter(Boolean);
    for (const s of surfaces) if (!pool.exact.has(s)) pool.exact.set(s, v.id);
    if (v.pos === 'v1' || v.pos === 'v5' || v.pos === 'adj-i') {
      for (const s of surfaces) {
        const stem = s.slice(0, -1);
        if (stem.length > 0 && (hasKanji(stem) || stem.length >= 2)) pool.prefixes.push({ s: stem, id: v.id });
      }
    } else if (v.pos === 'adj-na' || v.pos === 'n-suru') {
      for (const s of surfaces) if (s.length >= 2 || hasKanji(s)) pool.prefixes.push({ s, id: v.id });
    } else if (v.pos === 'v-irr' && word.endsWith('来る')) {
      pool.prefixes.push({ s: word.slice(0, -1), id: v.id });
    }
  };
  for (const v of vocab) add(v);
  for (const v of plusOne) {
    pool.plusOne.add(v.id);
    add(v);
  }
  pool.prefixes.sort((a, b) => b.s.length - a.s.length);
  for (const g of grammar) {
    if (!Array.isArray(g.clozeHints)) continue;
    for (const h of g.clozeHints) if (typeof h === 'string' && h.length >= 2) pool.hints.push({ h, id: g.id });
  }
  pool.hints.sort((a, b) => b.h.length - a.h.length);
  return pool;
}

export function matchToken(pool: MatchPool, token: string, names: ReadonlySet<string> = new Set()): TokenMatch {
  if (PUNCT_TOKEN_RE.test(token)) return { id: null, known: true, punct: true };
  const exact = pool.exact.get(token);
  if (exact !== undefined) return { id: exact, known: true, punct: false };
  if (FUNCTION_TOKENS.has(token)) return { id: null, known: true, punct: false };
  if (names.has(token) || CAST_NAMES.has(token)) return { id: null, known: true, punct: false };
  if (KANJI_NUMERAL_RE.test(token)) return { id: null, known: true, punct: false };
  for (const p of pool.prefixes) if (token.startsWith(p.s)) return { id: p.id, known: true, punct: false };
  for (const c of pool.counters) {
    if (token.endsWith(c.s) && token.length > c.s.length && KANJI_NUMERAL_RE.test(token.slice(0, -c.s.length))) return { id: c.id, known: true, punct: false };
  }
  for (const h of pool.hints) if (token === h.h || token.includes(h.h) || (token.length >= 2 && h.h.includes(token))) return { id: h.id, known: true, punct: false };
  for (const nm of [...names, ...CAST_NAMES]) if (token.startsWith(nm) && FUNCTION_TOKENS.has(token.slice(nm.length))) return { id: null, known: true, punct: false };
  return { id: null, known: false, punct: false };
}

/** Allowlist station for a text: Stations 1–3 share the White set. */
export function allowlistStationFor(station: number): number {
  return station <= 3 ? 3 : station;
}

export function cumulativeIds(bundles: readonly StationBundle[], upTo: number, key: 'kanaIds' | 'vocabIds' | 'grammarIds'): Set<string> {
  const out = new Set<string>();
  for (const b of bundles) if (b.number <= upTo) for (const id of b[key] ?? []) out.add(id);
  return out;
}

export interface LinkResult {
  /** Story lines whose tokenIds were computed. */
  linked: number;
  /** Story files rewritten. */
  changed: string[];
}

/**
 * The linker: writes `StoryLine.tokenIds` for every story on disk from the
 * V20 match against the cumulative allowlist of its station (plus plusOne).
 * Idempotent; only files whose tokenIds differ are rewritten.
 */
export function linkStories(root: string, bundles: readonly StationBundle[], write = true): LinkResult {
  root = resolve(root);
  const c = collectFromDisk(root);
  const vocabById = new Map<string, VocabItem>();
  for (const { item } of c.vocab) vocabById.set(item.id, item);
  const grammarById = new Map<string, GrammarItem>();
  for (const { item } of c.grammar) grammarById.set(item.id, item);
  const result: LinkResult = { linked: 0, changed: [] };
  for (const f of loadFiles<StoryItem>(root, new Set<ContentKind>(['story']))) {
    let changed = false;
    for (const s of f.env.items) {
      if (!s || !Array.isArray(s.lines)) continue;
      const n = Number(/^st-(\d{2})$/.exec(String(s.stationId))?.[1] ?? NaN);
      if (!Number.isInteger(n) || n < 1 || n > STATIONS.length) continue;
      const upTo = allowlistStationFor(n);
      const vocab = [...cumulativeIds(bundles, upTo, 'vocabIds')].map((id) => vocabById.get(id)).filter((v): v is VocabItem => v !== undefined);
      const grammar = [...cumulativeIds(bundles, upTo, 'grammarIds')].map((id) => grammarById.get(id)).filter((g): g is GrammarItem => g !== undefined);
      const plusIds = new Set<string>();
      for (const ln of s.lines) if (ln && Array.isArray(ln.plusOne)) for (const p of ln.plusOne) if (typeof p === 'string') plusIds.add(p);
      const plus = [...plusIds].map((id) => vocabById.get(id)).filter((v): v is VocabItem => v !== undefined);
      const pool = buildMatchPool(vocab, grammar, plus);
      const names = new Set(Array.isArray(s.names) ? s.names.filter((x): x is string => typeof x === 'string') : []);
      for (const ln of s.lines) {
        if (!ln || !Array.isArray(ln.tokens)) continue;
        const ids = ln.tokens.map((t) => (typeof t === 'string' ? matchToken(pool, t, names).id : null));
        const same = Array.isArray(ln.tokenIds) && ln.tokenIds.length === ids.length && ln.tokenIds.every((x, j) => x === ids[j]);
        if (!same) {
          ln.tokenIds = ids;
          changed = true;
        }
        result.linked++;
      }
    }
    if (changed && write) {
      writeFileSync(f.abs, stringifyJson(f.env));
      result.changed.push(f.rel);
    } else if (changed) result.changed.push(f.rel);
  }
  return result;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CLI                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function main(): void {
  const argv = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  let root = join(here, '..', 'public', 'content');
  let planPath = join(here, '..', 'docs', 'content-plan.json');
  let allowlistsDir = join(here, '..', 'docs', 'allowlists');
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--root') root = argv[++i] ?? root;
    else if (a === '--plan') planPath = argv[++i] ?? planPath;
    else if (a === '--allowlists') allowlistsDir = argv[++i] ?? allowlistsDir;
    else if (a === '--dry-run') dry = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: node scripts/assign-stations.ts [--root <content dir>] [--plan <content-plan.json>] [--allowlists <dir>] [--dry-run]\n');
      process.exit(0);
    }
  }
  const plan = readJson<PlanEntry[]>(resolve(planPath));
  const result = assign(resolve(root), plan, { write: !dry, allowlistsDir: resolve(allowlistsDir) });
  process.stdout.write(result.report + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
