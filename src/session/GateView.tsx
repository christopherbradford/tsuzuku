/**
 * TSUZUKU — `<GateView>`: the Gatekeeper (関守) boss (design 04 §11, 02 §1, 06 §4).
 *
 *  intro (keeper, phases, readiness, rematch rules) → fight: four phases run
 *  by one `SessionRunner` through `<SessionView>`; a phase card with the
 *  keeper's name opens each phase (the runner is paused while it shows, so
 *  Flash/Strike timers never run against a card the learner is not reading)
 *  and reveals the Grudge List so far; a 壁 Wall bar chips with every hit →
 *  result: stamp or "Not yet", phase scores, Grudge List, rematch / Assisted
 *  Gate / Revenge Match per `rematchAllowed`. `finishGate` writes progress and
 *  emits `gate:result`; B stamps and G's StampPress fires through the bus.
 *  No lives, no hearts, no retreat: leaving mid-fight abandons the run (the
 *  Leave button and unmounting alike), and the fight's runner never touches the
 *  training snapshot (`persist: false`). Intro, result and the Station page
 *  all read `rematchAllowed`, so the rematch copy agrees everywhere.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { content as appContent, type ContentLoader } from '../content/loader';
import { STATIONS, type ContentItem, type DrillId, type StationDef } from '../content/types';
import { hashSeed } from '../shared/hash';
import { parseCardKey } from '../shared/ids';
import type { SessionPlan, Step, StepResult } from '../shared/session-types';
import { store } from '../store';
import { BELT_NAME, S as ES, fill } from './engine-strings';
import { GATE_ASSISTED_PASS, GATE_PASS, GATE_PHASE_PASS, buildGate, finishGate, gateAvailable, gateOutcome, rematchAllowed, scoreGate, stepHit, type GateScore } from './gatekeeper';
import { dayStartMs } from '../shared/time';
import { SessionRunner } from './runner';
import { SessionHost, type SessionViewComponent } from './ScrollView';
import { S } from './pages/strings';
import './GateView.css';

export interface GateViewProps {
  station: number;
  onExit(): void;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
  /** Additive: a prebuilt plan (tests); skips `buildGate`. */
  plan?: SessionPlan;
  /** Additive: called with each runner this view creates (hosts, tests). */
  onRunner?(r: SessionRunner): void;
}

export type GateStage = 'loading' | 'intro' | 'building' | 'failed' | 'empty' | 'fight' | 'result';

export interface FightMode {
  assisted: boolean;
  revenge: boolean;
}

/** Display surface of an item for the Grudge List. */
export function itemHead(item: ContentItem | undefined, id: string): string {
  if (!item) return id;
  if ('word' in item && typeof item.word === 'string') return item.word;
  if ('pattern' in item) return item.pattern;
  if ('char' in item) return item.char;
  if ('kana' in item && typeof item.kana === 'string') return item.kana;
  return id;
}

/** Block (phase) index of a step: by id, else by `params.phase`. */
export function phaseIndexOf(plan: SessionPlan, step: Step | null | undefined): number {
  if (!step) return -1;
  const i = plan.blocks.findIndex((b) => b.stepIds.includes(step.id));
  if (i >= 0) return i;
  return step.params.phase ? Math.min(plan.blocks.length - 1, step.params.phase - 1) : 0;
}

const PHASE_LINE: Record<1 | 2 | 3 | 4, string> = { 1: S.phaseFlashLine, 2: S.phaseStrikeLine, 3: S.phaseEarLine, 4: S.phaseFinalLine };

function phaseLine(plan: SessionPlan, bi: number, assisted: boolean): string {
  const first = plan.steps.find((s) => plan.blocks[bi]?.stepIds[0] === s.id);
  const ph = first?.params.phase ?? ((bi + 1) as 1 | 2 | 3 | 4);
  if (ph === 4 && assisted) return S.phaseAssistedLine;
  return PHASE_LINE[ph];
}

/**
 * Grudge reps logged since `t` (ms) and today. Kept for callers that hold the
 * fight's end time; `rematchAllowed` applies the same rule from the save.
 */
export function grudgeRepsSince(t: number): number {
  const grudge = new Set(store.progress.value.grudge);
  if (grudge.size === 0) return 0;
  const dayStart = dayStartMs(store.today(), store.profile.value.tz);
  let n = 0;
  for (const e of store.log.recent(5000)) if (e[0] > t && e[0] >= dayStart && grudge.has(e[1])) n++;
  return n;
}

/** Misses so far among the given step ids (unanswered steps are not misses yet). */
export function missesIn(plan: SessionPlan, results: readonly StepResult[], stepIds: readonly string[]): string[] {
  const byId = new Map(results.map((r) => [r.stepId, r] as const));
  const stepById = new Map(plan.steps.map((s) => [s.id, s] as const));
  const out: string[] = [];
  for (const id of stepIds) {
    const r = byId.get(id);
    if (!r) continue;
    const s = stepById.get(id);
    if (stepHit(s, r)) continue;
    const key = s?.cardKey ?? r.cardKey;
    const itemId = key ? parseCardKey(key).itemId : s?.itemId;
    if (itemId && !out.includes(itemId)) out.push(itemId);
  }
  return out;
}

function Wall(p: { plan: SessionPlan; results: readonly StepResult[] }): JSX.Element {
  const stepById = new Map(p.plan.steps.map((s) => [s.id, s] as const));
  const total = p.plan.steps.length;
  const hits = p.results.filter((r) => stepHit(stepById.get(r.stepId), r)).length;
  const left = Math.max(0, total - hits);
  const pct = total > 0 ? Math.round((left / total) * 100) : 100;
  return (
    <div class="gate-wall" role="progressbar" aria-label={S.wallAria} aria-valuemin={0} aria-valuemax={total} aria-valuenow={left}>
      <span class="gate-wall__label" lang="ja">
        {S.wallLabel}
      </span>
      <span class="progress gate-wall__track">
        <span class="progress__fill gate-wall__fill" style={{ width: `${pct}%` }} />
      </span>
      <span class="gate-wall__count">{fill(S.wallChipped, { n: hits, total })}</span>
    </div>
  );
}

function GrudgeList(p: { ids: readonly string[]; loader: ContentLoader; title?: boolean; kept?: boolean }): JSX.Element {
  return (
    <section class="gate-grudge" aria-label={S.grudgeTitle}>
      {p.title !== false ? (
        <h4 class="gate-view__label" lang="ja">
          {S.grudgeTitle}
        </h4>
      ) : null}
      <p class="gate-grudge__line">{p.ids.length === 0 ? S.grudgeNone : p.ids.length === 1 ? S.grudgeOne : fill(S.grudgeSoFar, { n: p.ids.length })}</p>
      {p.ids.length > 0 ? (
        <ul class="gate-grudge__items">
          {p.ids.slice(0, 12).map((id) => (
            <li key={id} class="chip chip--tag" lang="ja">
              {itemHead(p.loader.get(id), id)}
            </li>
          ))}
        </ul>
      ) : null}
      {p.kept && p.ids.length > 0 ? <p class="gate-grudge__kept">{S.grudgeKept}</p> : null}
    </section>
  );
}

export function GateView(p: GateViewProps): JSX.Element {
  const loader = p.loader ?? appContent;
  const n = p.station;
  const def: StationDef | undefined = STATIONS.find((s) => s.number === n);
  const [stage, setStage] = useState<GateStage>('loading');
  const [mode, setMode] = useState<FightMode>({ assisted: false, revenge: false });
  const [avail, setAvail] = useState<ReturnType<typeof gateAvailable> | null>(null);
  const [contentMissing, setContentMissing] = useState(false);
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [phaseIntro, setPhaseIntro] = useState<number | null>(null);
  const [score, setScore] = useState<GateScore | null>(null);
  const [, setTick] = useState(0);
  const finished = useRef(false);
  const cardsVersion = store.cards.version.value;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const bundle = await loader.station(n);
        if (!alive) return;
        setAvail(gateAvailable(n, bundle, store.cards, store.today()));
      } catch {
        if (alive) setContentMissing(true);
      }
      if (alive) setStage((s) => (s === 'loading' ? 'intro' : s));
    })();
    return () => {
      alive = false;
    };
  }, [n, loader, cardsVersion]);

  useEffect(() => {
    if (!runner) return;
    let lastBlock = 0;
    return effect(() => {
      const done = runner.done.value;
      void runner.index.value;
      void runner.feedback.value;
      setTick((t) => t + 1);
      if (done) {
        setStage('result');
        return;
      }
      if (runner.abandoned.value) return;
      const step = runner.step.value;
      if (!step) return;
      const bi = phaseIndexOf(runner.plan, step);
      if (bi > lastBlock) {
        lastBlock = bi;
        if (!runner.paused.peek()) runner.pause();
        setPhaseIntro(bi);
      }
    });
  }, [runner]);

  useEffect(() => {
    if (stage !== 'result' || !runner || finished.current) return;
    finished.current = true;
    const sc = scoreGate(runner.plan, runner.results, { assisted: mode.assisted });
    finishGate(n, sc, mode);
    setScore(sc);
  }, [stage, runner, mode, n]);

  // No retreat: leaving the room (browser Back, route change) mid-fight abandons the run honestly.
  useEffect(
    () => () => {
      if (runner && !runner.done.peek() && !runner.abandoned.peek()) runner.abandon();
    },
    [runner],
  );

  const begin = async (m: FightMode): Promise<void> => {
    setMode(m);
    setStage('building');
    setScore(null);
    setPhaseIntro(null);
    finished.current = false;
    try {
      const attempts = store.progress.value.gateAttempts[n] ?? 0;
      const plan = p.plan ?? (await buildGate(n, { assisted: m.assisted, revenge: m.revenge, seed: hashSeed(store.seed(), 'gate', n, attempts, store.today()), loader, available: p.available }));
      if (plan.steps.length === 0) {
        setStage('empty');
        return;
      }
      const r = new SessionRunner(plan, { loader, persist: false });
      r.pause();
      p.onRunner?.(r);
      setRunner(r);
      setPhaseIntro(0);
      setStage('fight');
    } catch {
      setStage('failed');
    }
  };

  const leave = (): void => {
    if (runner && !runner.done.value && !runner.abandoned.value) runner.abandon();
    p.onExit();
  };

  const beginPhase = (): void => {
    if (!runner) return;
    runner.resume();
    setPhaseIntro(null);
  };

  if (!def) {
    return (
      <section class="gate-view" aria-label={S.gateAria}>
        <div class="notice">
          <p>{S.notFoundBody}</p>
          <button type="button" class="btn" onClick={p.onExit}>
            {S.back}
          </button>
        </div>
      </section>
    );
  }

  const keeper = `${def.gateJa} ${def.gateEn}`;
  const header = (
    <header class="gate-view__keeper">
      <p class="gate-view__station">
        <span lang="ja">{def.nameJa}</span> {def.nameRomaji} · {fill(S.beltLine, { belt: BELT_NAME[def.belt], jlpt: def.jlpt ? fill(S.jlptLine, { n: def.jlpt }) : S.levelKana })}
      </p>
      <h2 class="gate-view__name">
        <span lang="ja">{def.gateJa}</span> <span class="gate-view__name-en">{def.gateEn}</span>
      </h2>
    </header>
  );

  if (stage === 'loading') {
    return (
      <section class="gate-view" aria-label={S.gateAria} aria-busy="true">
        {header}
        <p role="status">{S.loading}</p>
      </section>
    );
  }

  if (stage === 'building') {
    return (
      <section class="gate-view" aria-label={S.gateAria} aria-busy="true">
        {header}
        <p role="status">{S.gateBuilding}</p>
      </section>
    );
  }

  if (stage === 'failed' || stage === 'empty') {
    return (
      <section class="gate-view" aria-label={S.gateAria}>
        {header}
        <div class="notice notice--warn">
          <p>{stage === 'empty' ? S.gateEmptyPlan : S.gateBuildFailed}</p>
          <button type="button" class="btn" onClick={p.onExit}>
            {S.backToStation}
          </button>
        </div>
      </section>
    );
  }

  if (stage === 'intro') {
    const progress = store.progress.value;
    const cleared = progress.stationsCleared.includes(n);
    const assistedCleared = cleared && progress.assisted.includes(n);
    const attempts = progress.gateAttempts[n] ?? 0;
    const rm = rematchAllowed(n);
    const ready = avail?.ready ?? false;
    return (
      <section class="gate-view" aria-label={S.gateAria} data-stage="intro">
        {header}
        <p class="gate-view__line">{S.gateIntroLine}</p>
        <ol class="gate-view__phases" aria-label={S.gatePhases}>
          <li>
            <span lang="ja">{ES.phaseFlash}</span> {S.phaseFlashLine}
          </li>
          <li>
            <span lang="ja">{ES.phaseStrike}</span> {S.phaseStrikeLine}
          </li>
          <li>
            <span lang="ja">{ES.phaseEar}</span> {S.phaseEarLine}
          </li>
          <li>
            <span lang="ja">{ES.phaseFinalForm}</span> {S.phaseFinalLine}
          </li>
        </ol>
        <p class="gate-view__note">{S.timersNote}</p>
        {attempts > 0 ? <p class="gate-view__attempts">{attempts === 1 ? S.attemptLine : fill(S.attemptsLine, { n: attempts })}</p> : null}
        {contentMissing ? <p class="notice notice--warn">{S.contentMissing}</p> : null}
        {cleared ? (
          <p class="gate-view__status">{assistedCleared ? S.gateClearedAssistedLine : S.gateClearedLine}</p>
        ) : !ready ? (
          <div class="notice">
            <p>{S.gateNotOpenTitle}</p>
            {avail ? <p>{fill(S.gateNotReadyLine, { introduced: avail.introduced, total: avail.total, green: avail.green })}</p> : null}
          </div>
        ) : rm.allowed ? (
          <p class="gate-view__status">{attempts > 0 ? S.rematchOpen : fill(S.gateReadyLine, { name: keeper })}</p>
        ) : (
          <p class="gate-view__status">{fill(S.rematchGrudge, { n: rm.grudgeRepsNeeded })}</p>
        )}
        {!cleared && progress.grudge.length > 0 ? <GrudgeList ids={Array.from(new Set(progress.grudge.map((k) => parseCardKey(k).itemId)))} loader={loader} /> : null}
        {!cleared && ready && rm.offerAssisted ? <p class="notice notice--shu gate-view__banner">{S.assistedBanner}</p> : null}
        <div class="gate-view__actions">
          {!cleared && ready && rm.allowed ? (
            <button type="button" class="hanko" onClick={() => void begin({ assisted: false, revenge: false })}>
              {S.beginFight}
            </button>
          ) : null}
          {!cleared && ready && rm.offerAssisted ? (
            <button type="button" class="btn" onClick={() => void begin({ assisted: true, revenge: false })}>
              {S.assistedButton}
            </button>
          ) : null}
          {assistedCleared && rm.allowed ? (
            <button type="button" class="hanko" onClick={() => void begin({ assisted: false, revenge: true })}>
              {S.revengeButton}
            </button>
          ) : null}
          <button type="button" class="btn btn--ghost" onClick={p.onExit}>
            {S.backToStation}
          </button>
        </div>
      </section>
    );
  }

  if (stage === 'fight' && runner) {
    const plan = runner.plan;
    if (phaseIntro !== null) {
      const block = plan.blocks[phaseIntro];
      const before = plan.blocks.slice(0, phaseIntro).flatMap((b) => b.stepIds);
      const slipped = missesIn(plan, runner.results, before);
      return (
        <section class="gate-view" aria-label={S.gateAria} data-stage="phase">
          {header}
          {mode.assisted ? <p class="notice notice--shu gate-view__banner">{S.assistedBanner}</p> : null}
          {mode.revenge ? <p class="gate-view__line">{S.revengeLine}</p> : null}
          <Wall plan={plan} results={runner.results} />
          <article class="status-window gate-phase" aria-label={fill(S.phaseTitle, { n: phaseIntro + 1, total: plan.blocks.length })}>
            <h3 class="status-window__label">{fill(S.phaseTitle, { n: phaseIntro + 1, total: plan.blocks.length })}</h3>
            <p class="gate-phase__name" lang="ja">
              {block?.label ?? ''}
            </p>
            <p class="gate-phase__line">{phaseLine(plan, phaseIntro, mode.assisted)}</p>
            <p class="gate-phase__keeper">{keeper}</p>
            {phaseIntro > 0 ? <GrudgeList ids={slipped} loader={loader} /> : null}
            <div class="gate-view__actions">
              <button type="button" class="hanko" onClick={beginPhase}>
                {S.beginPhase}
              </button>
              <button type="button" class="btn btn--ghost" onClick={leave}>
                {S.leave}
              </button>
            </div>
          </article>
        </section>
      );
    }
    return (
      <section class="gate-view" aria-label={S.gateAria} data-stage="fight">
        {mode.assisted ? <p class="notice notice--shu gate-view__banner">{S.assistedBanner}</p> : null}
        <Wall plan={plan} results={runner.results} />
        <SessionHost runner={runner} onExit={leave} view={p.view} />
      </section>
    );
  }

  if (stage === 'result' && runner) {
    const plan = runner.plan;
    const sc = score ?? scoreGate(plan, runner.results, { assisted: mode.assisted });
    const outcome = gateOutcome(sc, mode);
    const rm = rematchAllowed(n);
    const line =
      outcome === 'perfect'
        ? fill(S.gatePerfect, { gate: keeper })
        : outcome === 'pass'
          ? fill(S.gatePassed, { gate: keeper })
          : outcome === 'assisted'
            ? S.gateAssisted
            : outcome === 'revenge'
              ? S.gateRevenge
              : S.gateNotYet;
    const misses = Array.from(new Set(sc.misses.map((k) => parseCardKey(k).itemId)));
    const passMark = Math.round((mode.assisted ? GATE_ASSISTED_PASS : GATE_PASS) * 100);
    const repsNeeded = sc.passed ? 0 : rm.grudgeRepsNeeded;
    const canRematch = !sc.passed && rm.allowed;
    return (
      <section class="gate-view" aria-label={S.gateAria} data-stage="result" data-outcome={outcome}>
        {header}
        <h3 class="gate-view__result">{line}</h3>
        {sc.passed ? (
          <div class="gate-stamp" aria-label={S.stampTitle}>
            <span class={`seal gate-stamp__seal${sc.perfect ? ' seal--perfect' : ''}${outcome === 'assisted' ? ' gate-stamp__seal--assisted' : ''}`} lang="ja">
              {def.nameJa}
            </span>
            <p class="gate-stamp__line">{sc.perfect ? S.stampPerfectLine : outcome === 'assisted' ? S.stampAssistedLine : S.stampLine}</p>
          </div>
        ) : null}
        <dl class="gate-result__table">
          <div class="gate-result__row">
            <dt>{S.overallLabel}</dt>
            <dd>
              {fill(S.percent, { n: Math.round(sc.overall * 100) })} <small>({fill(S.passMark, { pct: passMark })})</small>
            </dd>
          </div>
          {plan.blocks.map((b, i) => (
            <div key={b.kind + i} class="gate-result__row" data-pass={(sc.phases[i] ?? 0) >= GATE_PHASE_PASS ? 'true' : 'false'}>
              <dt lang="ja">{b.label}</dt>
              <dd>
                {fill(S.percent, { n: Math.round((sc.phases[i] ?? 0) * 100) })} <small>({fill(S.passMark, { pct: Math.round(GATE_PHASE_PASS * 100) })})</small>
              </dd>
            </div>
          ))}
        </dl>
        <GrudgeList ids={misses} loader={loader} kept={!sc.passed} />
        {!sc.passed ? <p class="gate-view__status">{canRematch ? S.rematchOpen : fill(S.rematchGrudge, { n: repsNeeded })}</p> : null}
        {!sc.passed && rm.offerAssisted ? <p class="notice notice--shu gate-view__banner">{S.assistedBanner}</p> : null}
        <div class="gate-view__actions">
          {canRematch ? (
            <button type="button" class="hanko" onClick={() => void begin({ assisted: false, revenge: false })}>
              {S.rematchButton}
            </button>
          ) : null}
          {!sc.passed && rm.offerAssisted ? (
            <button type="button" class="btn" onClick={() => void begin({ assisted: true, revenge: false })}>
              {S.assistedButton}
            </button>
          ) : null}
          {outcome === 'assisted' ? <p class="gate-view__line">{S.revengeLine}</p> : null}
          <button type="button" class="btn" onClick={p.onExit}>
            {S.backToStation}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="gate-view" aria-label={S.gateAria}>
      {header}
    </section>
  );
}
