/**
 * TSUZUKU — counters (design 06 §2 badge inputs, 05 §11 Perapera inputs).
 *
 *  stats     flat lifetime counters (`STAT_KEYS`); arcade reps (Rapid Fire,
 *            Gojūon Fighter) never touch `reviews` or `bestCombo`.
 *  daily     one row per EpochDay {reps, ok, minutes, xp, input}; created on
 *            the first rep of the day. `input` minutes arrive through the
 *            ledger (`ledger:entry`), so in-app story/listening minutes and
 *            outside minutes are counted once, in one place.
 *  medianMs  per-drill rolling median latency (`updateMedian`, a frugal
 *            streaming estimator: the stored value steps toward each sample
 *            by 1–5 % of itself, so it tracks the median of roughly the last
 *            200 reps without storing them).
 *  honesty   Judge passes ÷ checks as a rolling mean over the last 200
 *            checks (`stats.honesty`, 0–1; `honesty(m)` is null before any check).
 */
import { DRILL_IDS, type ContentItem, type DrillId, type VocabItem } from '../content/types';
import { content } from '../content/loader';
import { bus } from '../shared/events';
import { isKatakana } from '../shared/jp';
import { STAT_KEYS, type DailyRow, type EpochDay, type ItemBelt, type SaveMeta, type StatKey, type Store } from '../shared/store-types';

export { STAT_KEYS };

export const HONESTY_WINDOW = 200;
export const MEDIAN_WINDOW = 200;
/** Gojūon Fighter perfect round: 46 kana, 0 misses, under 60 s (badge `gojuon-perfect`). */
export const GOJUON_ROUND = 46;
export const GOJUON_PERFECT_MS = 60_000;
/** Listening Arena "fast" rate (badge `fast-ear`). */
export const FAST_RATE = 1.25;
/** Dictation at 1.0× = speed tier 3. */
export const TIER_1X = 3;

const ARCADE: ReadonlySet<string> = new Set(['rapid-fire', 'gojuon-fighter']);
const DRILLS: ReadonlySet<string> = new Set(DRILL_IDS);
const BELT_RANK: Record<ItemBelt, number> = { white: 0, yellow: 1, green: 2, brown: 3, black: 4 };

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Streaming median: step toward the sample by 10 % of the gap, clamped to
 * 1–5 % of the current estimate. At equilibrium half the samples push up and
 * half down, so the estimate hovers within a few percent of the median.
 */
export function updateMedian(prev: number | undefined, ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return prev ?? 0;
  if (prev === undefined || prev <= 0) return Math.round(ms);
  const gap = ms - prev;
  const step = Math.min(0.05 * prev, Math.max(0.01 * prev, 0.1 * Math.abs(gap)));
  return Math.round(gap > 0 ? prev + step : prev - step);
}

/** Incremental mean over a window: exact until `n` reaches `window`, exponential after. */
export function rollingMean(prev: number, sample: number, n: number, window = HONESTY_WINDOW): number {
  const k = Math.min(Math.max(1, n), window);
  return prev + (sample - prev) / k;
}

export function honesty(m: SaveMeta): number | null {
  return m.stats.judgeChecks > 0 ? Math.min(1, Math.max(0, m.stats.honesty)) : null;
}

export function emptyRow(): DailyRow {
  return { reps: 0, ok: 0, minutes: 0, xp: 0, input: 0 };
}

export function isStatKey(k: string): k is StatKey {
  return (STAT_KEYS as readonly string[]).includes(k);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface StatsOptions {
  /** Item lookup for the katakana check on a Brown promotion (default: the content loader's sync cache). */
  lookup?: (id: string) => ContentItem | undefined;
}

export function startStats(store: Store, o: StatsOptions = {}): () => void {
  const lookup = o.lookup ?? ((id: string) => content.get(id));

  function bump(delta: Partial<Record<StatKey, number>>): void {
    const keys = Object.keys(delta) as StatKey[];
    if (keys.length === 0) return;
    store.patch('stats', (s) => {
      let changed = false;
      const out = { ...s };
      for (const k of keys) {
        const d = delta[k] ?? 0;
        if (d === 0) continue;
        out[k] = (s[k] ?? 0) + d;
        changed = true;
      }
      return changed ? out : s;
    });
  }

  function setMax(k: StatKey, value: number): void {
    store.patch('stats', (s) => ((s[k] ?? 0) >= value ? s : { ...s, [k]: value }));
  }

  function set(k: StatKey, value: number): void {
    store.patch('stats', (s) => (s[k] === value ? s : { ...s, [k]: value }));
  }

  function daily(fn: (row: DailyRow) => DailyRow, day: EpochDay = store.today()): void {
    store.patch('daily', (d) => {
      const prev = d[day] ?? emptyRow();
      const next = fn(prev);
      if (next === prev) return d;
      return { ...d, [day]: next };
    });
  }

  function brownCounters(itemId: string, kind: string): Partial<Record<StatKey, number>> {
    switch (kind) {
      case 'kanji':
        return { kanjiBrown: 1 };
      case 'grammar':
        return { grammarBrown: 1 };
      case 'kana':
        return { kanaBrown: 1 };
      case 'vocab':
      case 'chunk': {
        const out: Partial<Record<StatKey, number>> = { vocabBrown: 1 };
        const item = lookup(itemId) as VocabItem | undefined;
        if (item && typeof item.word === 'string' && item.word.length > 0 && isKatakana(item.word)) out.katakanaBrown = 1;
        return out;
      }
      default:
        return {};
    }
  }

  const offs = [
    bus.on('session:started', () => {
      daily((r) => r);
    }),
    bus.on('session:finished', (p) => {
      const minutes = Math.max(0, Math.round((p.endedAt - p.startedAt) / 60_000));
      const delta: Partial<Record<StatKey, number>> = { sessions: 1, minutes };
      if (p.zen) delta.zenSessions = 1;
      const arcade = p.mode === 'rapid' || p.mode === 'gojuon';
      if (p.mode === 'kata' && p.steps.length >= 15 && p.steps.every((s) => s.correct)) delta.katasUnscathed = 1;
      bump(delta);
      if (!arcade) setMax('bestCombo', p.tally.bestCombo);
      if (minutes > 0) daily((r) => ({ ...r, minutes: r.minutes + minutes }));
    }),
    bus.on('attempt:graded', (p) => {
      if (DRILLS.has(p.exercise) && p.ms > 0 && !p.guard && !p.timedOut) {
        const id = p.exercise as DrillId;
        store.patch('medianMs', (m) => {
          const next = updateMedian(m[id], p.ms);
          return m[id] === next ? m : { ...m, [id]: next };
        });
      }
      if (p.judge !== undefined) {
        const checks = store.stats.value.judgeChecks + 1;
        const h = rollingMean(store.stats.value.honesty, p.judge === 'pass' ? 1 : 0, checks);
        bump({ judgeChecks: 1, judgePasses: p.judge === 'pass' ? 1 : 0 });
        set('honesty', Math.round(h * 10_000) / 10_000);
      }
      if (ARCADE.has(p.exercise)) return;
      const delta: Partial<Record<StatKey, number>> = {};
      if (p.rating !== null) delta.reviews = 1;
      if (p.ippon) delta.ippon = 1;
      if (p.recovery && p.correct) delta.recoveries = 1;
      if (p.exercise === 'form-chain') {
        delta.formChains = 1;
        if (p.correct && p.rating === 3 && !p.hintUsed) delta.formChainsPerfect = 1;
      }
      if (p.exercise === 'particle-duel') {
        delta.particleSlots = 1;
        if (p.correct) delta.particleSlotsCorrect = 1;
      }
      if (p.exercise === 'minimal-pair') {
        delta.minimalPairTrials = 1;
        if (p.correct) delta.minimalPairCorrect = 1;
      }
      bump(delta);
      setMax('bestCombo', p.combo);
      daily((r) => ({ ...r, reps: r.reps + 1, ok: r.ok + (p.correct ? 1 : 0) }));
    }),
    bus.on('xp:gained', (p) => {
      if (p.amount > 0) daily((r) => ({ ...r, xp: r.xp + p.amount }));
    }),
    bus.on('item:introduced', () => bump({ itemsIntroduced: 1 })),
    bus.on('item:promoted', (p) => {
      const delta: Partial<Record<StatKey, number>> = {};
      if (BELT_RANK[p.to] >= BELT_RANK.brown && BELT_RANK[p.from] < BELT_RANK.brown) Object.assign(delta, brownCounters(p.itemId, p.kind));
      if (p.to === 'black') delta.itemsBlack = 1;
      bump(delta);
    }),
    bus.on('scroll:completed', (p) => bump({ scrolls: 1, scrollsFlawless: p.flawless ? 1 : 0 })),
    bus.on('michikusa:read', () => bump({ michikusaRead: 1 })),
    bus.on('story:read', (p) => {
      const passed = p.total > 0 && p.correct / p.total >= 2 / 3;
      if (p.mode === 'speed') {
        const ok = p.total > 0 && p.correct >= p.total;
        bump({ speedReads: 1 });
        if (ok) setMax('speedReadBestCpm', Math.round(p.cpm));
        return;
      }
      const delta: Partial<Record<StatKey, number>> = {};
      if (passed) delta.episodesRead = 1;
      if (passed && p.chars >= 300 && p.glossTaps <= 2) delta.episodesDictionaryFree = 1;
      bump(delta);
    }),
    bus.on('listening:set', (p) => {
      const passed = p.total > 0 && p.correct / p.total >= 2 / 3;
      bump({ listeningSets: 1, listeningFastPasses: passed && p.rate >= FAST_RATE ? 1 : 0 });
    }),
    bus.on('line:scored', (p) => {
      if (p.kind === 'dictation') {
        bump({ dictationLines: 1, dictation95at1x: p.score >= 0.95 && (p.tier ?? TIER_1X) >= TIER_1X ? 1 : 0 });
      } else {
        bump({ shadowLines: 1, shadowPass: p.pass ? 1 : 0 });
      }
    }),
    bus.on('roleplay:done', (p) => {
      bump({
        rolePlays: 1,
        rolePlaysAllBest: p.total > 0 && p.best >= p.total ? 1 : 0,
        rolePlaysAizuchi: p.aizuchiTotal > 0 && p.aizuchiHit / p.aizuchiTotal >= 0.8 ? 1 : 0,
      });
    }),
    bus.on('output:done', (p) => {
      switch (p.kind) {
        case 'three-ways':
          bump({ threeWays: 1, threeWaysCorrect: p.registersCorrect === 3 ? 1 : 0 });
          break;
        case 'monologue':
          bump({ monologues: 1 });
          if (p.words !== undefined) setMax('monologueBestWords', Math.round(p.words));
          break;
        case 'reduce-expand':
          bump({ reduceExpand: 1 });
          break;
        case 'writing':
          bump({ writings: 1 });
          break;
      }
    }),
    bus.on('weak-point:set-done', () => bump({ weakSetsCleared: 1 })),
    bus.on('arcade:done', (p) => {
      if (p.mode === 'rapid') {
        bump({ rapidRuns: 1 });
        setMax('rapidBest', p.correct);
      } else {
        const perfect = p.correct >= GOJUON_ROUND && p.misses === 0 && p.ms > 0 && p.ms < GOJUON_PERFECT_MS;
        bump({ gojuonRuns: 1, gojuonPerfects: perfect ? 1 : 0 });
        setMax('gojuonBest', p.correct);
      }
    }),
    bus.on('nemesis:defeated', () => bump({ nemesisDefeated: 1 })),
    bus.on('kage:result', () => bump({ kageRuns: 1 })),
    bus.on('gate:result', (p) => {
      if (p.outcome === 'revenge') bump({ revengeWins: 1 });
    }),
    bus.on('field-mission:done', (p) => bump({ fieldMissions: 1, conversations: p.conversation ? 1 : 0 })),
    bus.on('welcome-back:done', () => bump({ comebacks: 1 })),
    bus.on('quest:completed', (p) => {
      if (p.allDone) bump({ fullDays: 1 });
    }),
    bus.on('ledger:entry', (p) => {
      const minutes = Math.max(0, Math.round(p.minutes));
      if (minutes > 0) daily((r) => ({ ...r, input: r.input + minutes }));
    }),
  ];

  return () => {
    for (const off of offs) off();
  };
}
