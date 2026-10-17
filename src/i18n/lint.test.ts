/**
 * Architecture lint over src/** (group A, ARCHITECTURE §0 / §8).
 *
 *  1. Inline English: JSX text nodes of 3+ consecutive English words in a
 *     `.tsx` (outside strings files and tests) must live in a strings.ts.
 *  2. Clock: no `Math.random` / `Date.now` outside shared/hash.ts, store/store.ts
 *     and the composition root src/main.tsx (the one place allowed to hand the
 *     wall clock to initStore).
 *  3. Default exports only in `*\/pages/*.tsx`.
 *  4. Import rule: a module imports only its own group's folder or the
 *     contract tier (docs/module-plan.json owners + [CONTRACT] entries +
 *     ARCHITECTURE §0 paths). Exceptions: src/main.tsx, src/app/pages.ts.
 *     Type-only imports are erased at build and are allowed.
 *
 * The lints are pure functions over {path, text}; inline fixtures prove each
 * one fails on a deliberate violation, then the real tree must come up clean.
 * Files that do not exist yet are simply not scanned.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

const ROOT = process.cwd();

interface SourceFile {
  /** Repo-relative, posix separators. */
  path: string;
  text: string;
}

/* ── file discovery ──────────────────────────────────────────────────── */

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

function loadSources(): SourceFile[] {
  return walk(join(ROOT, 'src'))
    .filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts'))
    .map((p) => {
      try {
        return { path: relative(ROOT, p).split(sep).join('/'), text: readFileSync(p, 'utf8') };
      } catch {
        return null;
      }
    })
    .filter((f): f is SourceFile => f !== null);
}

const isTest = (p: string): boolean => /\.test\.tsx?$/.test(p);
const isStringsFile = (p: string): boolean => /(^|\/)strings\.ts$/.test(p) || p === 'src/i18n/banned-phrases.ts';

/* ── a small lexer: blank out comments and string literals, keep newlines ── */

export function stripCommentsAndStrings(code: string, keepStrings = false): string {
  let out = '';
  let i = 0;
  const n = code.length;
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');
  let lastSignificant = '';
  while (i < n) {
    const c = code[i]!;
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== '\n') {
        if (code[j] === '\\') j++;
        j++;
      }
      const stop = Math.min(n, j + 1);
      out += keepStrings ? code.slice(i, stop) : c + blank(code.slice(i + 1, stop - 1)) + c;
      i = stop;
      lastSignificant = c;
      continue;
    }
    if (c === '`') {
      // template literal; `${ … }` expressions are blanked too (good enough for a lint)
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const ch = code[j]!;
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (depth === 0 && ch === '`') break;
        if (ch === '$' && code[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0 && ch === '}') depth--;
        j++;
      }
      const stop = Math.min(n, j + 1);
      out += keepStrings ? code.slice(i, stop) : '`' + blank(code.slice(i + 1, stop - 1)) + '`';
      i = stop;
      lastSignificant = '`';
      continue;
    }
    if (c === '/' && next !== undefined && next !== '/' && next !== '*' && /[(,=:[!&|?{};\n]|^$/.test(lastSignificant)) {
      // regex literal
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== '\n') {
        const ch = code[j]!;
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      out += '/' + blank(code.slice(i + 1, stop - 1)) + '/';
      i = stop;
      lastSignificant = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/* ── 1. inline English in JSX text nodes ─────────────────────────────── */

/** Three or more consecutive words, each ≥ 2 letters with a lowercase letter after the first. */
const THREE_WORDS = /\b[A-Za-z][a-z]+(?:[ \t ]+[A-Za-z][a-z]+){2,}\b/;
const CODE_LIKE = /[;=(){}[\]]|\b(const|let|var|return|function|import|export|if|else|for|while|type|interface|class|new|await|async|from|extends|implements)\b/;
/** Text nodes that are fine inline (units, brand, punctuation-only). */
const ALLOW: RegExp[] = [/^TSUZUKU/i, /^\d/, /^[\s·—–\-.,/]+$/];

export function inlineEnglish(file: SourceFile): string[] {
  if (!file.path.endsWith('.tsx') || isTest(file.path) || isStringsFile(file.path)) return [];
  const code = stripCommentsAndStrings(file.text);
  const hits: string[] = [];
  const re = />([^<>{}]+)</g;
  for (const m of code.matchAll(re)) {
    const seg = m[1]!;
    if (CODE_LIKE.test(seg)) continue;
    const t = seg.replace(/\s+/g, ' ').trim();
    if (!THREE_WORDS.test(t)) continue;
    if (ALLOW.some((a) => a.test(t))) continue;
    hits.push(`${file.path}:${lineAt(code, (m.index ?? 0) + 1)}  "${t}"`);
  }
  return hits;
}

/* ── 2. clock rule ───────────────────────────────────────────────────── */

const CLOCK_ALLOWED = new Set(['src/shared/hash.ts', 'src/store/store.ts', 'src/main.tsx']);
const CLOCK_RE = /\bMath\.random\b|\bDate\.now\b/g;

export function clockUse(file: SourceFile): string[] {
  if (isTest(file.path) || CLOCK_ALLOWED.has(file.path)) return [];
  const code = stripCommentsAndStrings(file.text);
  const hits: string[] = [];
  for (const m of code.matchAll(CLOCK_RE)) hits.push(`${file.path}:${lineAt(code, m.index ?? 0)}  ${m[0]}`);
  return hits;
}

/* ── 3. default exports only in pages ────────────────────────────────── */

const PAGE_FILE = /\/pages\/[^/]+\.tsx$/;

export function defaultExport(file: SourceFile): string[] {
  if (isTest(file.path)) return [];
  const code = stripCommentsAndStrings(file.text);
  const m = /^[ \t]*export\s+default\b/m.exec(code);
  if (!m) return [];
  if (PAGE_FILE.test(file.path)) return [];
  return [`${file.path}:${lineAt(code, m.index)}  export default outside */pages/*.tsx`];
}

/* ── 4. import rule ──────────────────────────────────────────────────── */

interface PlanEntry {
  path: string;
  owner_group: string;
  responsibility?: string;
}

function readPlan(): PlanEntry[] {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'docs/module-plan.json'), 'utf8')) as PlanEntry[];
  } catch {
    return [];
  }
}

const CONTRACT_PATHS: RegExp[] = [
  /^src\/shared\//,
  /^src\/content\/(types|loader|ruby)\.ts$/,
  /^src\/content\/fixtures\//,
  /^src\/store\/(index|derived|testing)\.ts$/,
  /^src\/learn\/(index|apply)\.ts$/,
];
const IMPORT_EXCEPTIONS = new Set(['src/main.tsx', 'src/app/pages.ts']);

export interface Ownership {
  ownerOf(path: string): string | null;
  isContract(path: string): boolean;
}

export function buildOwnership(plan: PlanEntry[]): Ownership {
  const exact = new Map<string, string>();
  const dirGroups = new Map<string, Set<string>>();
  const contract = new Set<string>();
  for (const e of plan) {
    exact.set(e.path, e.owner_group);
    if (/\[CONTRACT\]/.test(e.responsibility ?? '')) contract.add(e.path);
    let dir = posix.dirname(e.path);
    // every ancestor dir up to src/<group-folder>
    while (dir.startsWith('src/')) {
      let set = dirGroups.get(dir);
      if (!set) {
        set = new Set();
        dirGroups.set(dir, set);
      }
      set.add(e.owner_group);
      dir = posix.dirname(dir);
    }
  }
  return {
    ownerOf(path) {
      const o = exact.get(path);
      if (o) return o;
      let dir = posix.dirname(path);
      while (dir.startsWith('src/')) {
        const set = dirGroups.get(dir);
        if (set && set.size === 1) return Array.from(set)[0]!;
        if (set && set.size > 1) return null; // shared folder: ambiguous, contract-tier anyway
        dir = posix.dirname(dir);
      }
      return null;
    },
    isContract(path) {
      return contract.has(path) || CONTRACT_PATHS.some((re) => re.test(path));
    },
  };
}

const IMPORT_RE = /\b(import|export)\s+(type\s+)?(?:[\w*$]+\s*,?\s*)?(?:\{[^}]*\}\s*)?(?:\*\s+as\s+\w+\s*)?(?:from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveSpecifier(from: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith('@/')) p = `src/${spec.slice(2)}`;
  else if (spec.startsWith('.')) p = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null; // package
  if (/\.(css|json|svg|png|woff2?)$/.test(p)) return null;
  p = p.replace(/\.(ts|tsx|js|jsx)$/, '');
  const candidates = [`${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`];
  for (const c of candidates) if (existsSync(join(ROOT, c))) return c;
  return candidates[0]!;
}

export function importViolations(file: SourceFile, own: Ownership): string[] {
  if (isTest(file.path) || IMPORT_EXCEPTIONS.has(file.path)) return [];
  const importer = own.ownerOf(file.path);
  if (!importer) return [];
  const code = stripCommentsAndStrings(file.text, true);
  const hits: string[] = [];
  const check = (spec: string, index: number, typeOnly: boolean): void => {
    if (typeOnly) return;
    const target = resolveSpecifier(file.path, spec);
    if (!target || own.isContract(target)) return;
    const owner = own.ownerOf(target);
    if (!owner || owner === importer) return;
    hits.push(`${file.path}:${lineAt(code, index)}  imports ${spec} (group ${owner}) from group ${importer}`);
  };
  for (const m of code.matchAll(IMPORT_RE)) check(m[3]!, m.index ?? 0, m[2] !== undefined);
  for (const m of code.matchAll(DYNAMIC_RE)) check(m[1]!, m.index ?? 0, false);
  return hits;
}

/* ── fixtures: each lint must catch a deliberate violation ───────────── */

const PLAN = readPlan();
const OWN = buildOwnership(PLAN);

const BAD: SourceFile = {
  path: 'src/exercises/kana/BadFixture.tsx',
  text: [
    "import { store } from '@/store';",
    "import { Hud } from '@/session/Hud';",
    "import type { Step } from '@/session/runner';",
    "const label = 'Rest. Reload.'; // Hurry is only in a comment",
    'export default function Bad(): JSX.Element {',
    '  const seed = Math.random();',
    '  return <div title={label}>Hello there my friend</div>;',
    '}',
  ].join('\n'),
};
const GOOD: SourceFile = {
  path: 'src/exercises/kana/GoodFixture.tsx',
  text: [
    "import { store } from '@/store';",
    "import { rngFor } from '@/shared/hash';",
    "import { S } from '../strings';",
    "import { ChoiceGrid } from '../ChoiceGrid';",
    'export function Good(p: { n: number }): JSX.Element {',
    '  const rows = useMemo<Array<string | null>>(() => [], []);',
    '  const t = p.n > 3 ? S.a : S.b;',
    '  return <div lang="ja">{S.title}<span>{t}</span> 一本 <b>XP</b> 12 reps</div>;',
    '}',
  ].join('\n'),
};

describe('lint fixtures', () => {
  it('module plan is readable and owns src/exercises for D, src/session for E', () => {
    expect(PLAN.length).toBeGreaterThan(100);
    expect(OWN.ownerOf('src/exercises/kana/Anything.tsx')).toBe('D');
    expect(OWN.ownerOf('src/session/Hud.ts')).toBe('E');
    expect(OWN.isContract('src/store/index.ts')).toBe(true);
    expect(OWN.isContract('src/shared/ui/Ruby.tsx')).toBe(true);
    expect(OWN.isContract('src/session/Hud.ts')).toBe(false);
  });

  it('flags inline English, the clock, the default export and the cross-group import', () => {
    expect(inlineEnglish(BAD)).toHaveLength(1);
    expect(inlineEnglish(BAD)[0]).toContain('Hello there my friend');
    expect(clockUse(BAD)).toHaveLength(1);
    expect(defaultExport(BAD)).toHaveLength(1);
    const imports = importViolations(BAD, OWN);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('@/session/Hud');
  });

  it('passes a well-behaved module (contract imports, own folder, strings via S, generics)', () => {
    expect(inlineEnglish(GOOD)).toEqual([]);
    expect(clockUse(GOOD)).toEqual([]);
    expect(defaultExport(GOOD)).toEqual([]);
    expect(importViolations(GOOD, OWN)).toEqual([]);
  });

  it('stripCommentsAndStrings keeps line numbers and blanks literals', () => {
    const src = "const a = 'x\\'y'; // Hurry\nconst re = /don't/i; const b = `t ${a} u`;\n/* block\n */ const c = 1;";
    const out = stripCommentsAndStrings(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('Hurry');
    expect(out).not.toContain("don't");
    expect(out).toContain('const c = 1;');
  });
});

/* ── the real tree ───────────────────────────────────────────────────── */

describe('src/** architecture lint', () => {
  const files = loadSources();

  it('scans the sources that exist', () => {
    expect(files.length).toBeGreaterThan(10);
    console.info(`[lint] ${files.length} source files`);
  });

  it('no inline English copy in JSX text nodes (use the folder strings.ts)', () => {
    const hits = files.flatMap(inlineEnglish);
    expect(hits, `inline copy:\n${hits.join('\n')}`).toEqual([]);
  });

  it('no Math.random / Date.now outside shared/hash.ts, store/store.ts, main.tsx', () => {
    const hits = files.flatMap(clockUse);
    expect(hits, `clock use:\n${hits.join('\n')}`).toEqual([]);
  });

  it('default exports only in */pages/*.tsx', () => {
    const hits = files.flatMap(defaultExport);
    expect(hits, `default exports:\n${hits.join('\n')}`).toEqual([]);
  });

  it('cross-group imports target only the contract tier', () => {
    const hits = files.flatMap((f) => importViolations(f, OWN));
    expect(hits, `import rule:\n${hits.join('\n')}`).toEqual([]);
  });
});
