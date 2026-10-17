/**
 * Banned-copy lint (design 01 §3, ARCHITECTURE §8).
 *
 * Scans every strings module (`src/<folder>/**\/strings.ts`, split files
 * `strings-2.ts`, and prefixed ones such as `engine-strings.ts`) AND every
 * `.tsx` (tests excluded) as text, plus the exported string values of every
 * strings module that can be imported, plus the learner-facing copy that lives
 * in data tables outside strings files (quest and mission text in
 * `shared/catalog`, station gate names and belt titles in `content/types`, the
 * `.ics` reminder text). Files that do not exist yet are simply not scanned;
 * the report names file:line and the offending phrase.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BANNED, findBanned, lineOf } from './banned-phrases';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

const ALL = walk(SRC);
/** `strings.ts`, `strings-<n>.ts` and `<prefix>-strings.ts` (never tests). */
const STRINGS_RE = /(^|\/)(?:[\w-]+-)?strings(?:-\d+)?\.ts$/;
const STRINGS_FILES = ALL.filter((p) => STRINGS_RE.test(rel(p)));
const TSX_FILES = ALL.filter((p) => p.endsWith('.tsx') && !/\.test\.tsx$/.test(p));

function scanText(path: string, text: string): string[] {
  return findBanned(text).map((h) => `${rel(path)}:${lineOf(text, h.index)}  "${h.match}"  (rule ${h.rule.source})`);
}

function collectStrings(v: unknown, path: string, out: { path: string; value: string }[], depth = 0): void {
  if (depth > 6) return;
  if (typeof v === 'string') out.push({ path, value: v });
  else if (Array.isArray(v)) v.forEach((x, i) => collectStrings(x, `${path}[${i}]`, out, depth + 1));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) collectStrings(x, `${path}.${k}`, out, depth + 1);
  }
}

describe('banned phrases: the list itself', () => {
  const MUST_MATCH = [
    'You lost your streak',
    "Don't let Sensei down",
    'Only 3 hours left',
    'Hurry up',
    'Last chance',
    "Don't break your streak",
    'Streak at risk',
    'Oops',
    "You're on fire",
    'Game over',
    'Wrong answer!',
    'Oh no, you missed!',
    '🔥🔥🔥',
    'Keep your streak alive',
    'We miss you',
    'Time is running out',
  ];
  const MUST_PASS = [
    "Again. That's the training.",
    'Good. Now you know what to train.',
    'Not yet. The gate will still be here.',
    'The dojo kept your place.',
    'Rest is training.',
    'Enough new words for today. The dojo will be here tomorrow.',
    "Don't know",
    'The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty.',
    'Good training. Rest. つづく',
    'Ippon',
    'Only mature items are timed.',
    'A new version of the dojo is ready.',
    '一本 🎌',
    'Insert Coin',
  ];

  it('every regex is case-insensitive and has no g flag side effects', () => {
    for (const re of BANNED) {
      expect(re.flags, re.source).toContain('i');
      expect(re.flags, re.source).not.toContain('g');
    }
  });

  it.each(MUST_MATCH)('flags %j', (text) => {
    expect(findBanned(text).length, text).toBeGreaterThan(0);
  });

  it.each(MUST_PASS)('allows %j', (text) => {
    expect(findBanned(text).map((h) => h.rule.source), text).toEqual([]);
  });

  it('lineOf reports 1-based lines', () => {
    const text = 'a\nb\nOops';
    const [hit] = findBanned(text);
    expect(hit).toBeDefined();
    expect(lineOf(text, hit!.index)).toBe(3);
  });
});

describe('banned phrases: the codebase', () => {
  it('finds the strings files that exist (report)', () => {
    // Informational: lists what was scanned so a missing file is visible, not silent.
    const names = STRINGS_FILES.map(rel);
    expect(names).toContain('src/i18n/strings.ts');
    console.info(`[banned] scanning ${names.length} strings files, ${TSX_FILES.length} tsx files`);
  });

  it('no strings.ts contains a banned phrase', () => {
    const problems: string[] = [];
    for (const f of STRINGS_FILES) {
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      problems.push(...scanText(f, text));
    }
    expect(problems, `banned copy:\n${problems.join('\n')}`).toEqual([]);
  });

  it('no .tsx contains a banned phrase', () => {
    const problems: string[] = [];
    for (const f of TSX_FILES) {
      let text: string;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      problems.push(...scanText(f, text));
    }
    expect(problems, `banned copy:\n${problems.join('\n')}`).toEqual([]);
  });

  it('exported string values of every importable strings module are clean', async () => {
    const modules = import.meta.glob(['/src/**/strings.ts', '/src/**/strings-*.ts', '/src/**/*-strings.ts']);
    const problems: string[] = [];
    let scanned = 0;
    for (const [path, load] of Object.entries(modules)) {
      let mod: unknown;
      try {
        mod = await load();
      } catch (err) {
        console.warn(`[banned] skipped ${path}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      scanned++;
      const values: { path: string; value: string }[] = [];
      collectStrings(mod, path, values);
      for (const { path: p, value } of values) {
        for (const hit of findBanned(value)) problems.push(`${p} = ${JSON.stringify(value)}  (rule ${hit.rule.source})`);
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(problems, `banned copy in exported strings:\n${problems.join('\n')}`).toEqual([]);
  });

  it('learner-facing copy outside strings files (quests, missions, gates, belts, .ics) is clean and never shouts', async () => {
    const { QUESTS, MISSIONS } = await import('@/shared/catalog');
    const { STATIONS, BELTS } = await import('@/content/types');
    const { ICS_SUMMARY, ICS_DESCRIPTION } = await import('@/app/ics');
    const values: { path: string; value: string }[] = [];
    collectStrings(QUESTS, 'shared/catalog#QUESTS', values);
    collectStrings(MISSIONS, 'shared/catalog#MISSIONS', values);
    collectStrings(STATIONS, 'content/types#STATIONS', values);
    collectStrings(BELTS, 'content/types#BELTS', values);
    collectStrings({ ICS_SUMMARY, ICS_DESCRIPTION }, 'app/ics', values);
    expect(values.length).toBeGreaterThan(50);
    const problems: string[] = [];
    for (const { path: p, value } of values) {
      for (const hit of findBanned(value)) problems.push(`${p} = ${JSON.stringify(value)}  (rule ${hit.rule.source})`);
      if (value.includes('!')) problems.push(`${p} = ${JSON.stringify(value)}  (exclamation mark)`);
    }
    expect(problems, `banned copy outside strings files:\n${problems.join('\n')}`).toEqual([]);
  });
});
