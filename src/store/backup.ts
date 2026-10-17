/**
 * TSUZUKU — export / import (design 07 §5, 06 §7 #10). Your study data never
 * leaves the browser unless you carry it.
 *
 *  exportSave()        one JSON document `{schema, exportedAt, meta, shards, log}`
 *                      named `tsuzuku-backup-YYYY-MM-DD.json`; `{gzip:true}`
 *                      yields real gzip bytes (`CompressionStream`) as
 *                      `.tsuzuku.json.gz`. Emits `backup:exported`, bumps
 *                      `stats.exports`.
 *  previewImport(text) parses → migrates every document → a diff summary.
 *                      Accepts the envelope, a bare SaveMeta, or the design-07
 *                      `{meta, shards, log}` shape. Never writes.
 *  previewImportBlob() the file itself (gzip bytes or text) → previewImport.
 *                      Fields of the wrong type are repaired to defaults by
 *                      the migration layer and reported as one warning.
 *  applyImport(p,mode) `merge` (streak max, XP max, collections union, cards
 *                      newer-wins, ledger union) or `replace` (the backup as
 *                      is; cards included, and the backup's seed/createdAt/
 *                      contentVersion header, so art renders as on the
 *                      original device). The review log is unioned in both
 *                      modes: deduped on `t|cardKey`, sorted by time, the
 *                      ring keeps the newest 5,000 by time (never by push
 *                      order). Flushes; the caller shows the reload hint.
 */
import { BELT_IDS, type Belt, type CardKey } from '../content/types';
import { bus } from '../shared/events';
import { isoDate } from '../shared/time';
import {
  LOG_SCHEMA,
  SAVE_SCHEMA,
  SLICE_KEYS,
  type CardShard,
  type CardTuple,
  type Collections,
  type DailyRow,
  type EpochDay,
  type KageState,
  type Ledger,
  type LedgerEntry,
  type LogEntry,
  type Progress,
  type ReviewLog,
  type SaveMeta,
  type Streak,
  type WeakPoints,
} from '../shared/store-types';
import { MigrationError, migrateLog, migrateMetaChecked, migrateShard, newerCard } from './migrations';
import { LOG_RING, gunzipText, hasCompression, isCompressed, parseShardId, type ShardId } from './persist';
import { replaceHeader, replaceLog, shardOfKey, store, storeCards } from './store';
import { S } from './strings';
import { levelFor } from './xp';

export const BACKUP_SCHEMA = 'tsuzuku.backup/1' as const;
export const BACKUP_VERSION = 1;

export interface BackupDocument {
  schema: typeof BACKUP_SCHEMA;
  app: 'tsuzuku';
  exportedAt: number;
  contentVersion: string;
  meta: SaveMeta;
  shards: Record<string, CardShard>;
  log: ReviewLog;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Export                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** The store's cards grouped into shard documents (same shape as storage). */
export function collectShards(): Record<string, CardShard> {
  const out: Record<string, CardShard> = {};
  storeCards.forEach((k, t) => {
    const id = shardOfKey(k);
    let s = out[id];
    if (!s) {
      const { kind, level } = parseShardId(id);
      s = { schema: 'tsuzuku.cards/1', kind, level, cards: {} };
      out[id] = s;
    }
    s.cards[k] = t;
  });
  return out;
}

export function buildBackup(): BackupDocument {
  const meta = store.meta();
  return {
    schema: BACKUP_SCHEMA,
    app: 'tsuzuku',
    exportedAt: store.now(),
    contentVersion: meta.contentVersion,
    meta,
    shards: collectShards(),
    log: { schema: LOG_SCHEMA, entries: store.log.recent(LOG_RING) },
  };
}

type Bytes = Uint8Array<ArrayBuffer>;

async function pump(stream: ReadableStream<Bytes>): Promise<Bytes> {
  const reader = stream.getReader();
  const chunks: Bytes[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out: Bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function fromBytes(bytes: Bytes): ReadableStream<Bytes> {
  return new ReadableStream<Bytes>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

async function gzipBytes(text: string): Promise<Bytes> {
  const input: Bytes = new TextEncoder().encode(text);
  return pump(fromBytes(input).pipeThrough(new CompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>));
}

async function gunzipBytes(bytes: Bytes): Promise<string> {
  const out = await pump(fromBytes(bytes).pipeThrough(new DecompressionStream('gzip') as ReadableWritablePair<Bytes, Bytes>));
  return new TextDecoder().decode(out);
}

/** Blob → bytes; falls back to FileReader where `Blob.arrayBuffer` is missing (jsdom, old WebViews). */
export function readBlobBytes(blob: Blob): Promise<Bytes> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b) as Bytes);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer) as Bytes);
    r.readAsArrayBuffer(blob);
  });
}

/** Blob → text (UTF-8). */
export async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await readBlobBytes(blob));
}

export function backupFilename(day: EpochDay, gzip: boolean): string {
  return `${S.backupFilename}-${isoDate(day)}${gzip ? '.tsuzuku.json.gz' : '.json'}`;
}

export async function exportSave(o: { gzip?: boolean } = {}): Promise<{ blob: Blob; filename: string }> {
  // Count the export first so the file itself carries it (a restore keeps 備えあれば).
  store.patch('stats', (s) => ({ ...s, exports: s.exports + 1 }));
  const json = JSON.stringify(buildBackup());
  const gzip = !!o.gzip && hasCompression();
  let blob: Blob;
  if (gzip) {
    const bytes = await gzipBytes(json);
    blob = new Blob([bytes as BlobPart], { type: 'application/gzip' });
  } else {
    blob = new Blob([json], { type: 'application/json' });
  }
  bus.emit('backup:exported', {});
  return { blob, filename: backupFilename(store.today(), gzip) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Preview                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ImportData {
  meta: SaveMeta;
  cards: Record<CardKey, CardTuple>;
  /** Shard id per card (placement hint for kanji on `replace`). */
  shardOf: Record<CardKey, ShardId>;
  log: LogEntry[];
}

export interface ImportSummary {
  /** [current, incoming] */
  streak: [number, number];
  xp: [number, number];
  cards: [number, number];
  badges: [number, number];
  days: [number, number];
  /** Cards in the backup this browser does not have. */
  cardsGained: number;
  /** Cards this browser has that the backup lacks (lost on `replace`, kept on `merge`). */
  cardsLost: number;
}

export interface ImportPreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: ImportSummary;
  exportedAt?: number;
  contentVersion?: string;
  data?: ImportData;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function emptySummary(): ImportSummary {
  const m = store.meta();
  const c = storeCards.count();
  return {
    streak: [m.streak.current, 0],
    xp: [m.profile.xp, 0],
    cards: [c, 0],
    badges: [Object.keys(m.collections.badges).length, 0],
    days: [m.streak.totalDays, 0],
    cardsGained: 0,
    cardsLost: c,
  };
}

function invalid(errors: string[], warnings: string[] = []): ImportPreview {
  return { valid: false, errors, warnings, summary: emptySummary() };
}

/** Gzip magic read as text: 0x1f then 0x8b (Latin-1) or U+FFFD (UTF-8 decoding of the invalid byte). */
function looksBinary(text: string): boolean {
  const second = text.charCodeAt(1);
  return text.charCodeAt(0) === 0x1f && (second === 0x8b || second === 0xfffd);
}

export function previewImport(json: string): ImportPreview {
  const text = json.trim();
  if (text.length === 0) return invalid([S.importNotJson]);
  if (isCompressed(text) || looksBinary(text)) return invalid([S.importCompressed]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid([S.importNotJson]);
  }
  if (!isObject(parsed)) return invalid([S.importNotBackup]);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof parsed.schema === 'string' && parsed.schema.startsWith('tsuzuku.backup/')) {
    const v = Number(parsed.schema.slice('tsuzuku.backup/'.length));
    if (Number.isFinite(v) && v > BACKUP_VERSION) return invalid([S.importNewer]);
  }

  let rawMeta: unknown;
  let rawShards: unknown;
  let rawLog: unknown;
  if (isObject(parsed.meta)) {
    rawMeta = parsed.meta;
    rawShards = parsed.shards;
    rawLog = parsed.log;
  } else if (isObject(parsed.profile) && isObject(parsed.settings)) {
    rawMeta = parsed;
  } else {
    return invalid([S.importNotBackup]);
  }

  let meta: SaveMeta;
  try {
    const checked = migrateMetaChecked(rawMeta);
    meta = checked.meta;
    if (checked.coerced.length > 0) warnings.push(S.importRepaired);
  } catch (e) {
    if (e instanceof MigrationError && /newer/.test(e.message)) return invalid([S.importNewer]);
    return invalid([S.importNotBackup]);
  }

  const cards: Record<CardKey, CardTuple> = {};
  const shardOf: Record<CardKey, ShardId> = {};
  const shardList: unknown[] = Array.isArray(rawShards) ? rawShards : isObject(rawShards) ? Object.values(rawShards) : [];
  for (const raw of shardList) {
    try {
      const shard = migrateShard(raw);
      const id: ShardId = `${shard.kind}.${shard.level}`;
      for (const [k, t] of Object.entries(shard.cards) as [CardKey, CardTuple][]) {
        const prev = cards[k];
        cards[k] = prev ? newerCard(prev, t) : t;
        shardOf[k] = id;
      }
    } catch {
      warnings.push(S.importNoShard);
    }
  }

  let log: LogEntry[] = [];
  if (rawLog !== undefined && rawLog !== null) {
    try {
      log = migrateLog(rawLog);
    } catch {
      warnings.push(S.importNoLog);
    }
  }

  const cur = store.meta();
  const incomingKeys = Object.keys(cards) as CardKey[];
  let gained = 0;
  for (const k of incomingKeys) if (!storeCards.get(k)) gained++;
  let lost = 0;
  storeCards.forEach((k) => {
    if (!cards[k]) lost++;
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      streak: [cur.streak.current, meta.streak.current],
      xp: [cur.profile.xp, meta.profile.xp],
      cards: [storeCards.count(), incomingKeys.length],
      badges: [Object.keys(cur.collections.badges).length, Object.keys(meta.collections.badges).length],
      days: [cur.streak.totalDays, meta.streak.totalDays],
      cardsGained: gained,
      cardsLost: lost,
    },
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : undefined,
    contentVersion: meta.contentVersion,
    data: { meta, cards, shardOf, log },
  };
}

/** The file itself: gzip bytes, `gz1:` base64 text, or plain JSON text. */
export async function previewImportBlob(src: Blob | ArrayBuffer | Uint8Array | string): Promise<ImportPreview> {
  if (typeof src === 'string') {
    if (isCompressed(src)) {
      if (!hasCompression()) return invalid([S.importCompressed]);
      try {
        return previewImport(await gunzipText(src));
      } catch {
        return invalid([S.importNotJson]);
      }
    }
    return previewImport(src);
  }
  let bytes: Bytes;
  if (src instanceof Uint8Array) bytes = new Uint8Array(src) as Bytes;
  else if (src instanceof ArrayBuffer) bytes = new Uint8Array(src) as Bytes;
  else bytes = await readBlobBytes(src);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (!hasCompression()) return invalid([S.importCompressed]);
    try {
      return previewImport(await gunzipBytes(bytes));
    } catch {
      return invalid([S.importNotJson]);
    }
  }
  return previewImportBlob(new TextDecoder().decode(bytes));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Merge (pure)                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function union<T>(a: readonly T[], b: readonly T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}

function beltRank(b: Belt): number {
  return BELT_IDS.indexOf(b);
}

function minPositive(a: number, b: number): number {
  if (a <= 0) return b;
  if (b <= 0) return a;
  return Math.min(a, b);
}

function mergeStreak(a: Streak, b: Streak): Streak {
  const later = b.lastDay > a.lastDay ? b : a;
  const out: Streak = {
    ...later,
    current: Math.max(a.current, b.current),
    longest: Math.max(a.longest, b.longest),
    lastDay: Math.max(a.lastDay, b.lastDay),
    totalDays: Math.max(a.totalDays, b.totalDays),
    freezes: Math.min(3, Math.max(a.freezes, b.freezes)),
    repairs: Math.max(a.repairs, b.repairs),
    restDaysTaken: Math.max(a.restDaysTaken, b.restDaysTaken),
    weekly: Math.max(a.weekly, b.weekly),
    emberRestores: Math.max(a.emberRestores, b.emberRestores),
  };
  return out;
}

function mergeProgress(a: Progress, b: Progress): Progress {
  const attempts: Record<number, number> = { ...a.gateAttempts };
  for (const [k, v] of Object.entries(b.gateAttempts)) attempts[Number(k)] = Math.max(attempts[Number(k)] ?? 0, v);
  const further = b.station > a.station ? b : a;
  const out: Progress = {
    ...a,
    station: Math.max(a.station, b.station),
    stationsCleared: union(a.stationsCleared, b.stationsCleared).sort((x, y) => x - y),
    perfectGates: Math.max(a.perfectGates, b.perfectGates),
    assisted: union(a.assisted, b.assisted).sort((x, y) => x - y),
    gateAttempts: attempts,
    grudge: union(a.grudge, b.grudge),
    shinsaPassed: union(a.shinsaPassed, b.shinsaPassed).sort((x, y) => beltRank(x) - beltRank(y)),
    shinsaNotes: further.shinsaNotes ?? a.shinsaNotes ?? b.shinsaNotes,
  };
  if (a.storiesRead || b.storiesRead) out.storiesRead = union(a.storiesRead ?? [], b.storiesRead ?? []);
  if (a.gateAttemptDay || b.gateAttemptDay) {
    const days: Record<number, EpochDay> = { ...(a.gateAttemptDay ?? {}) };
    for (const [k, v] of Object.entries(b.gateAttemptDay ?? {})) days[Number(k)] = Math.max(days[Number(k)] ?? 0, v);
    out.gateAttemptDay = days;
  }
  if (a.gateAttemptAt || b.gateAttemptAt) {
    const at: Record<number, number> = { ...(a.gateAttemptAt ?? {}) };
    for (const [k, v] of Object.entries(b.gateAttemptAt ?? {})) at[Number(k)] = Math.max(at[Number(k)] ?? 0, v);
    out.gateAttemptAt = at;
  }
  return out;
}

function mergeCollections(a: Collections, b: Collections): Collections {
  const badges: Collections['badges'] = { ...a.badges };
  for (const [id, day] of Object.entries(b.badges) as [keyof Collections['badges'], EpochDay][]) {
    const cur = badges[id];
    badges[id] = cur === undefined ? day : Math.min(cur, day);
  }
  const wallpapers: Collections['wallpapers'] = { ...a.wallpapers };
  for (const [id, w] of Object.entries(b.wallpapers) as [keyof Collections['wallpapers'], NonNullable<Collections['wallpapers'][keyof Collections['wallpapers']]>][]) {
    const cur = wallpapers[id];
    if (!cur) {
      wallpapers[id] = w;
      continue;
    }
    const merged = {
      ...cur,
      at: Math.min(cur.at, w.at),
      reforges: Math.max(cur.reforges, w.reforges),
      revealed: Math.max(cur.revealed, w.revealed) as 0 | 1 | 2 | 3 | 4,
    };
    const lr = Math.max(cur.lastReforgeDay ?? 0, w.lastReforgeDay ?? 0);
    if (lr > 0) merged.lastReforgeDay = lr;
    if (!merged.sentenceOfChoice && w.sentenceOfChoice) merged.sentenceOfChoice = w.sentenceOfChoice;
    if (!merged.sealKanji && w.sealKanji) merged.sealKanji = w.sealKanji;
    wallpapers[id] = merged;
  }
  const stamps: Collections['stamps'] = { ...a.stamps };
  for (const [k, s] of Object.entries(b.stamps)) {
    const n = Number(k);
    const cur = stamps[n];
    stamps[n] = cur ? { at: Math.min(cur.at, s.at), perfect: cur.perfect || s.perfect, assisted: cur.assisted && s.assisted } : s;
  }
  return { badges, wallpapers, stamps, michikusa: union(a.michikusa, b.michikusa) };
}

function mergeKage(a: KageState, b: KageState): KageState {
  const byWeek = new Map<number, number>();
  for (const [w, s] of [...a.history, ...b.history]) byWeek.set(w, Math.max(byWeek.get(w) ?? 0, s));
  const history = Array.from(byWeek.entries()).sort((x, y) => x[0] - y[0]) as [number, number][];
  const out: KageState = {
    week: Math.max(a.week, b.week),
    best4: history.slice(-4).map(([, s]) => s),
    wins: Math.max(a.wins, b.wins),
    history,
  };
  const beaten = Math.max(a.beatenWeek ?? 0, b.beatenWeek ?? 0);
  if (beaten > 0) out.beatenWeek = beaten;
  return out;
}

function mergeWeakPoints(a: WeakPoints, b: WeakPoints): WeakPoints {
  const out = { ...a } as WeakPoints;
  for (const tag of Object.keys(b) as (keyof WeakPoints)[]) {
    const x = a[tag];
    const y = b[tag];
    if (!x || (y && y.n > x.n)) out[tag] = y;
  }
  return out;
}

function mergeLedger(a: Ledger, b: Ledger): Ledger {
  const seen = new Set<string>();
  const entries: LedgerEntry[] = [];
  for (const e of [...a.entries, ...b.entries]) {
    const key = e.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }
  entries.sort((x, y) => x[0] - y[0]);
  const monthly: Record<string, number> = { ...a.monthly };
  for (const [k, v] of Object.entries(b.monthly)) monthly[k] = Math.max(monthly[k] ?? 0, v);
  const mseen = new Set(a.missions.map((m) => `${m.day}|${m.tier}`));
  const missions = [...a.missions];
  for (const m of b.missions) {
    const key = `${m.day}|${m.tier}`;
    if (mseen.has(key)) continue;
    mseen.add(key);
    missions.push(m);
  }
  missions.sort((x, y) => x.day - y.day);
  return { entries, monthly, missions };
}

function mergeDaily(a: Record<EpochDay, DailyRow>, b: Record<EpochDay, DailyRow>): Record<EpochDay, DailyRow> {
  const out: Record<EpochDay, DailyRow> = { ...a };
  for (const [k, row] of Object.entries(b)) {
    const d = Number(k);
    const cur = out[d];
    if (!cur || row.reps > cur.reps || (row.reps === cur.reps && row.minutes > cur.minutes)) out[d] = row;
  }
  return out;
}

/** Design 07 §5 merge: streak max, XP max, collections union, ledger union; settings stay this browser's. */
export function mergeSaves(cur: SaveMeta, inc: SaveMeta, now: number): SaveMeta {
  const xp = Math.max(cur.profile.xp, inc.profile.xp);
  const stats = { ...cur.stats };
  for (const k of Object.keys(inc.stats) as (keyof SaveMeta['stats'])[]) stats[k] = Math.max(cur.stats[k] ?? 0, inc.stats[k] ?? 0);
  const medianMs = { ...inc.medianMs, ...cur.medianMs };
  const profile: SaveMeta['profile'] = {
    ...cur.profile,
    xp,
    level: levelFor(xp),
    belt: beltRank(inc.profile.belt) > beltRank(cur.profile.belt) ? inc.profile.belt : cur.profile.belt,
    dan: Math.max(cur.profile.dan, inc.profile.dan),
    startedAt: minPositive(cur.profile.startedAt, inc.profile.startedAt),
    goals: cur.profile.goals.length > 0 ? cur.profile.goals : inc.profile.goals,
    kanaKnown: union(cur.profile.kanaKnown, inc.profile.kanaKnown),
  };
  const chosen = cur.profile.chosenKanji ?? inc.profile.chosenKanji;
  if (chosen !== undefined) profile.chosenKanji = chosen;
  return {
    schema: SAVE_SCHEMA,
    seed: cur.seed,
    createdAt: minPositive(cur.createdAt, inc.createdAt),
    updatedAt: now,
    contentVersion: cur.contentVersion || inc.contentVersion,
    profile,
    settings: cur.settings,
    streak: mergeStreak(cur.streak, inc.streak),
    progress: mergeProgress(cur.progress, inc.progress),
    quests: inc.quests.day > cur.quests.day ? inc.quests : cur.quests,
    collections: mergeCollections(cur.collections, inc.collections),
    kage: mergeKage(cur.kage, inc.kage),
    weakPoints: mergeWeakPoints(cur.weakPoints, inc.weakPoints),
    ledger: mergeLedger(cur.ledger, inc.ledger),
    stats,
    medianMs,
    captured: union(cur.captured, inc.captured),
    bookmarks: union(cur.bookmarks, inc.bookmarks),
    perapera: { months: { ...inc.perapera.months, ...cur.perapera.months } },
    daily: mergeDaily(cur.daily, inc.daily),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Apply                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/** Slices through `patch()`, then the header (seed, createdAt, contentVersion) that lives outside them. */
function applyMeta(next: SaveMeta): void {
  for (const k of SLICE_KEYS) store.patch(k, () => next[k] as never);
  replaceHeader({ seed: next.seed, createdAt: next.createdAt, contentVersion: next.contentVersion });
}

/** Union by `t|cardKey`, ordered by time; the ring keeps the newest 5,000 by time. */
export function unionLogs(current: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const merged: LogEntry[] = [];
  for (const e of [...current, ...incoming]) {
    const k = `${e[0]}|${e[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  merged.sort((a, b) => a[0] - b[0]);
  return merged.length > LOG_RING ? merged.slice(merged.length - LOG_RING) : merged;
}

function unionLog(incoming: LogEntry[]): void {
  if (incoming.length === 0) return;
  replaceLog(unionLogs(store.log.recent(LOG_RING), incoming));
}

/**
 * Write the previewed save. Returns `true` when something was applied
 * (false for an invalid preview). Flushes persistence; the page should
 * offer a reload so every live view re-reads from the new save.
 */
export function applyImport(p: ImportPreview, mode: 'merge' | 'replace'): boolean {
  if (!p.valid || !p.data) return false;
  const { meta, cards, shardOf, log } = p.data;
  const cur = store.meta();
  const next = mode === 'replace' ? { ...meta, seed: meta.seed || cur.seed, updatedAt: store.now() } : mergeSaves(cur, meta, store.now());
  next.stats = { ...next.stats, imports: (next.stats.imports ?? 0) + 1 };
  applyMeta(next);

  if (mode === 'replace') {
    const keep = new Set(Object.keys(cards));
    const drop: CardKey[] = [];
    storeCards.forEach((k) => {
      if (!keep.has(k)) drop.push(k);
    });
    for (const k of drop) storeCards.delete(k);
    for (const [k, t] of Object.entries(cards) as [CardKey, CardTuple][]) {
      const id = shardOf[k];
      storeCards.set(k, t, id ? { level: parseShardId(id).level } : undefined);
    }
  } else {
    for (const [k, t] of Object.entries(cards) as [CardKey, CardTuple][]) {
      const prev = storeCards.get(k);
      const id = shardOf[k];
      if (!prev) storeCards.set(k, t, id ? { level: parseShardId(id).level } : undefined);
      else if (newerCard(prev, t) !== prev) storeCards.set(k, t);
    }
  }
  unionLog(log);
  void store.flush();
  return true;
}
