/**
 * TSUZUKU — content index (`public/content/manifest.json`).
 *
 *   node scripts/build-content-index.ts [--root <content dir>] [--version <x.y.z>] [--no-check]
 *
 * Emits a `ContentManifest` with bytes/sha256 per hand-written content file,
 * the belts and stations each file serves, per-station counts read from the
 * `stations/NN.json` bundles (which `assign-stations.ts` generates), totals,
 * `componentsPath` and `redirects` (`_meta/redirects.json` when present).
 *
 * Fails (throws / exit 1) when a station bundle is missing or any content
 * file exceeds 300 KB (measured vocab is 1.3–1.85 KB per item, so a 150-item N1
 * file is ≈ 276 KB; stories are one file per station). Output is deterministic: files sorted by path, fixed
 * key order, redirects sorted; `generatedAt` is kept from the previous
 * manifest when nothing else changed, so a re-run is byte-identical.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BELT_IDS, CONTENT_KINDS, STATIONS } from '../src/content/types.ts';
import type { Belt, ContentKind, ContentManifest, Level, ManifestFile, ManifestStation, StationBundle } from '../src/content/types.ts';

/** Hard cap for one hand-written content file (bytes). */
export const MAX_FILE_BYTES = 300 * 1024;
export const COMPONENTS_PATH = '_meta/components.json';

export interface BuildIndexOptions {
  /** ISO timestamp to stamp; defaults to now. Pass the previous value for a byte-identical rebuild. */
  generatedAt?: string;
  /** Throw on missing bundles / oversize files (default true). */
  check?: boolean;
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

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

interface Envelope {
  schema?: unknown;
  type?: unknown;
  level?: unknown;
  items?: unknown;
}

function isContentFile(rel: string, env: Envelope | null): env is Envelope & { items: unknown[] } {
  if (rel === 'manifest.json' || rel.startsWith('stations/')) return false;
  if (rel === '_meta/denylist.json' || rel === '_meta/redirects.json') return false;
  return !!env && env.schema === 'tsuzuku.content/1' && Array.isArray(env.items);
}

/** Sorted relative paths of every hand-written ContentFile under `root`. */
export function listContentFiles(root: string): string[] {
  root = resolve(root);
  const out: string[] = [];
  for (const abs of walk(root)) {
    const rel = toRel(root, abs);
    let env: Envelope | null = null;
    try {
      env = JSON.parse(readFileSync(abs, 'utf8')) as Envelope;
    } catch {
      env = null;
    }
    if (isContentFile(rel, env)) out.push(rel);
  }
  return out.sort();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function stationNumberOfStationId(id: unknown): number | null {
  const m = typeof id === 'string' ? /^st-(\d{2})$/.exec(id) : null;
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= STATIONS.length ? n : null;
}

function beltsFor(stations: number[]): Belt[] {
  const set = new Set<Belt>();
  for (const n of stations) {
    const st = STATIONS[n - 1];
    if (st) set.add(st.belt);
  }
  return BELT_IDS.filter((b) => set.has(b));
}

export function buildIndex(root: string, version: string, opts: BuildIndexOptions = {}): ContentManifest {
  root = resolve(root);
  const check = opts.check !== false;
  // Bundles.
  const bundles = new Map<number, StationBundle>();
  const missing: string[] = [];
  for (const st of STATIONS) {
    const rel = `stations/${pad2(st.number)}.json`;
    const p = join(root, rel);
    if (!existsSync(p)) {
      missing.push(rel);
      continue;
    }
    try {
      const b = JSON.parse(readFileSync(p, 'utf8')) as StationBundle;
      if (b.schema === 'tsuzuku.station/1') bundles.set(st.number, b);
      else missing.push(`${rel} (bad schema)`);
    } catch (e) {
      missing.push(`${rel} (${(e as Error).message})`);
    }
  }
  if (check && missing.length > 0) throw new Error(`missing station bundles (run content:assign): ${missing.join(', ')}`);
  const componentStations: number[] = [];
  for (const [n, b] of bundles) if (Array.isArray(b.componentIds) && b.componentIds.length > 0) componentStations.push(n);

  // Files.
  const files: ManifestFile[] = [];
  const totals = Object.fromEntries(CONTENT_KINDS.map((k) => [k, 0])) as Record<ContentKind, number>;
  const oversize: string[] = [];
  for (const rel of listContentFiles(root)) {
    const abs = join(root, rel);
    const buf = readFileSync(abs);
    const env = JSON.parse(buf.toString('utf8')) as Envelope & { items: unknown[] };
    const type = String(env.type) as ContentKind;
    if (!(CONTENT_KINDS as readonly string[]).includes(type)) continue;
    if (buf.length > MAX_FILE_BYTES) oversize.push(`${rel} (${buf.length} bytes)`);
    const stations = new Set<number>();
    if (type === 'component') {
      for (const n of componentStations) stations.add(n);
    } else {
      for (const it of env.items) {
        if (!it || typeof it !== 'object') continue;
        const rec = it as { station?: unknown; stationId?: unknown };
        if (typeof rec.station === 'number' && Number.isInteger(rec.station)) stations.add(rec.station);
        const n = stationNumberOfStationId(rec.stationId);
        if (n !== null) stations.add(n);
      }
    }
    const stationList = [...stations].sort((a, b) => a - b);
    const level = typeof env.level === 'string' ? (env.level as Level) : null;
    files.push({
      path: rel,
      type,
      level,
      count: env.items.length,
      bytes: buf.length,
      sha256: sha256(buf),
      belts: beltsFor(stationList),
      stations: stationList,
    });
    totals[type] += env.items.length;
  }
  if (check && oversize.length > 0) throw new Error(`content files over ${MAX_FILE_BYTES} bytes: ${oversize.join(', ')}`);
  totals.station = bundles.size;

  // Stations.
  const stations: ManifestStation[] = [];
  for (const st of STATIONS) {
    const b = bundles.get(st.number);
    if (!b) continue;
    stations.push({
      number: st.number,
      path: `stations/${pad2(st.number)}.json`,
      counts: {
        kana: (b.kanaIds ?? []).length,
        vocab: (b.vocabIds ?? []).length,
        kanji: (b.kanjiIds ?? []).length,
        grammar: (b.grammarIds ?? []).length,
        story: (b.storyIds ?? []).length,
        michikusa: (b.michikusaIds ?? []).length,
      },
    });
  }

  // Redirects.
  const redirects: Record<string, string> = {};
  const rp = join(root, '_meta', 'redirects.json');
  if (existsSync(rp)) {
    const raw = JSON.parse(readFileSync(rp, 'utf8')) as Record<string, unknown>;
    for (const k of Object.keys(raw).sort()) if (typeof raw[k] === 'string') redirects[k] = raw[k] as string;
  }

  return {
    schema: 'tsuzuku.manifest/1',
    contentVersion: version,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    files,
    stations,
    totals,
    componentsPath: COMPONENTS_PATH,
    redirects,
  };
}

export function stringifyManifest(m: ContentManifest): string {
  return JSON.stringify(m, null, 2) + '\n';
}

/**
 * Writes `manifest.json`, reusing the previous `generatedAt` when nothing else
 * changed so repeated runs are byte-identical. Returns the manifest written.
 */
export function writeIndex(root: string, version?: string, opts: BuildIndexOptions = {}): { manifest: ContentManifest; changed: boolean; path: string } {
  root = resolve(root);
  const p = join(root, 'manifest.json');
  let previous: ContentManifest | null = null;
  let previousText = '';
  if (existsSync(p)) {
    previousText = readFileSync(p, 'utf8');
    try {
      previous = JSON.parse(previousText) as ContentManifest;
    } catch {
      previous = null;
    }
  }
  const v = version ?? previous?.contentVersion ?? '0.0.0';
  const keep = buildIndex(root, v, { ...opts, generatedAt: opts.generatedAt ?? previous?.generatedAt ?? new Date().toISOString() });
  let manifest = keep;
  let text = stringifyManifest(keep);
  if (text !== previousText && opts.generatedAt === undefined && previous) {
    manifest = { ...keep, generatedAt: new Date().toISOString() };
    text = stringifyManifest(manifest);
  }
  const changed = text !== previousText;
  if (changed) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return { manifest, changed, path: p };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* CLI                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

function main(): void {
  const argv = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  let root = join(here, '..', 'public', 'content');
  let version: string | undefined;
  let check = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--root') root = argv[++i] ?? root;
    else if (a === '--version') version = argv[++i];
    else if (a.startsWith('--version=')) version = a.slice(10);
    else if (a === '--no-check') check = false;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: node scripts/build-content-index.ts [--root <content dir>] [--version <x.y.z>] [--no-check]\n');
      process.exit(0);
    }
  }
  if (version === undefined && process.env['CONTENT_VERSION']) version = process.env['CONTENT_VERSION'];
  try {
    const { manifest, changed, path } = writeIndex(resolve(root), version, { check });
    const t = manifest.totals;
    process.stdout.write(
      `${changed ? 'wrote' : 'unchanged'} ${path}\n` +
        `content ${manifest.contentVersion}: ${manifest.files.length} files, ${manifest.stations.length} stations · kana ${t.kana} vocab ${t.vocab} kanji ${t.kanji} grammar ${t.grammar} story ${t.story} michikusa ${t.michikusa} conjugation ${t.conjugation} component ${t.component}\n`,
    );
  } catch (e) {
    process.stderr.write(`content:index failed: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
