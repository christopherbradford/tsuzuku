/**
 * TSUZUKU — exercise registry barrel for group D (ARCHITECTURE §4).
 *
 * `registerAll()` registers the 26 D-owned drills with the shared registry
 * (`@/shared/exercise-types`). ExerciseFrame / Feedback / JudgeCard live in
 * `src/shared/ui` and are not re-exported here.
 *
 * EXPORT CONVENTION for every drill file `src/exercises/<area>/<Name>.tsx`:
 *   export const meta: ExerciseMeta = { id: '<drill-id>', facet, needsTts, needsStt, selfGraded, timeable, keys };
 *   export function <Name>(props: ExerciseProps): JSX.Element;   // named exactly like the file
 * The barrel discovers drill files with `import.meta.glob` (eager, tests
 * excluded) and registers `meta` with the export named after the file. A
 * folder helper `.tsx` without `meta` is ignored; a file with `meta` but no
 * matching component, a non-D id or a facet that differs from the pinned
 * table is reported (`registerReport()`), and in dev the latter two throw,
 * so a naming slip never fails silently. Registration is idempotent and
 * never touches the 9 F-owned drills or the runner ids.
 */
import type { DrillId, Facet } from '@/content/types';
import { DRILL_IDS, FACETS } from '@/content/types';
import { isRegistered, registerExercise, type ExerciseComponent, type ExerciseMeta } from '@/shared/exercise-types';

/** The 26 drills group D registers (module plan), in design-04 order. */
export const D_DRILL_IDS = [
  'kana-flash',
  'kana-ear',
  'kana-forge',
  'gojuon-fighter',
  'meaning-guard',
  'meaning-recall',
  'meaning-judge',
  'audio-flash',
  'production-forge',
  'pitch-ear',
  'component-flash',
  'component-assembly',
  'kanji-read',
  'lookalike-duel',
  'kanji-write',
  'pattern-cloze',
  'particle-duel',
  'form-forge',
  'form-chain',
  'transform',
  'scramble',
  'judgment-call',
  'sentence-listen',
  'minimal-pair',
  'rapid-fire',
  'nemesis-duel',
] as const satisfies readonly DrillId[];

export type DDrillId = (typeof D_DRILL_IDS)[number];

/** Facet each D drill tests (design 04 §1–§9, 05 §2); `null` = not scheduled by itself. */
export const D_DRILL_FACETS: Record<DDrillId, Facet | null> = {
  'kana-flash': 'rec',
  'kana-ear': 'prod',
  'kana-forge': 'prod',
  'gojuon-fighter': null,
  'meaning-guard': 'rec',
  'meaning-recall': 'rec',
  'meaning-judge': 'rec',
  'audio-flash': 'listen',
  'production-forge': 'prod',
  'pitch-ear': 'pitch',
  'component-flash': 'rec',
  'component-assembly': 'comp',
  'kanji-read': 'read',
  'lookalike-duel': 'read',
  'kanji-write': null,
  'pattern-cloze': 'cloze',
  'particle-duel': 'cloze',
  'form-forge': 'prod',
  'form-chain': 'prod',
  transform: 'prod',
  scramble: 'cloze',
  'judgment-call': 'cloze',
  'sentence-listen': null,
  'minimal-pair': null,
  'rapid-fire': null,
  'nemesis-duel': null,
};

const D_SET: ReadonlySet<string> = new Set(D_DRILL_IDS);
const DRILL_SET: ReadonlySet<string> = new Set(DRILL_IDS);
const FACET_SET: ReadonlySet<string> = new Set(FACETS);
const KEYS = new Set(['choices', 'text', 'kana', 'none']);

/** Shape of a drill module as the glob sees it. */
export interface ExerciseModule {
  meta?: unknown;
  [name: string]: unknown;
}

export interface RegisterReport {
  /** Ids registered (or already registered) by this call, in path order. */
  registered: DrillId[];
  /** Modules that carried a `meta` but could not be registered. */
  skipped: { path: string; reason: string }[];
  /** Registered despite a deviation from the pinned table. */
  warnings: string[];
}

export function isExerciseMeta(x: unknown): x is ExerciseMeta {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    DRILL_SET.has(m.id) &&
    (m.facet === null || (typeof m.facet === 'string' && FACET_SET.has(m.facet))) &&
    typeof m.needsTts === 'boolean' &&
    typeof m.needsStt === 'boolean' &&
    typeof m.selfGraded === 'boolean' &&
    typeof m.timeable === 'boolean' &&
    typeof m.keys === 'string' &&
    KEYS.has(m.keys)
  );
}

/** `./kana/KanaFlash.tsx` → `KanaFlash`. */
export function componentNameOf(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.tsx?$/, '');
}

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/** Registers every drill module in `modules` (see the header for the rules). Pure apart from the registry. */
export function registerFrom(modules: Record<string, ExerciseModule>): RegisterReport {
  const report: RegisterReport = { registered: [], skipped: [], warnings: [] };
  for (const path of Object.keys(modules).sort()) {
    const mod = modules[path];
    if (!mod || mod.meta === undefined) continue; // helper component, not a drill
    const meta = mod.meta;
    if (!isExerciseMeta(meta)) {
      report.skipped.push({ path, reason: 'meta is not an ExerciseMeta' });
      continue;
    }
    if (!D_SET.has(meta.id)) {
      const reason = `"${meta.id}" is not a D-owned drill id`;
      if (isDev()) throw new Error(`exercises/index: ${path}: ${reason}`);
      report.skipped.push({ path, reason });
      continue;
    }
    const name = componentNameOf(path);
    const comp = mod[name];
    if (typeof comp !== 'function') {
      report.skipped.push({ path, reason: `missing export "${name}" (component named like the file)` });
      continue;
    }
    const want = D_DRILL_FACETS[meta.id as DDrillId];
    if (meta.facet !== want) {
      const w = `${path}: facet ${String(meta.facet)} differs from the pinned ${String(want)}`;
      if (isDev()) throw new Error(`exercises/index: ${w}`);
      report.warnings.push(w);
    }
    if (!isRegistered(meta.id)) registerExercise(meta, comp as ExerciseComponent);
    report.registered.push(meta.id);
  }
  return report;
}

// Every `src/exercises/<area>/<Name>.tsx` except tests. Evaluated once at import.
const MODULES = import.meta.glob<ExerciseModule>(['./*/*.tsx', '!./*/*.test.tsx'], { eager: true });

let lastReport: RegisterReport | null = null;

/** Registers every D drill found on disk. Idempotent. */
export function registerAll(): void {
  lastReport = registerFrom(MODULES);
}

/** What the last `registerAll()` did, or `null` before the first call. */
export function registerReport(): RegisterReport | null {
  return lastReport;
}

/** D drills not registered yet (the builder skips unregistered exercises, ARCHITECTURE §8). */
export function missingDrills(): DDrillId[] {
  return D_DRILL_IDS.filter((id) => !isRegistered(id));
}

/** Drill module paths the glob found (for diagnostics and tests). */
export function discoveredModules(): string[] {
  return Object.keys(MODULES).sort();
}
