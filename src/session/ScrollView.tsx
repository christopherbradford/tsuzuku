/**
 * TSUZUKU — `<ScrollView>`: the Scroll Card unroll (design 03 §2.2, 05 §3, 05 §12).
 *
 *  Chikaradameshi pretest (≤ 3 items, graded as first exposure) → the scroll
 *  unrolls one teach card per item (word / pitch / mnemonic / examples with
 *  TTS / collocations / contrast, 既知 "I know this one") → one immediate check
 *  per item (`stepTag: 'intro'`) → noticing: the station episode's lines with
 *  the new items highlighted → `onDone()`.
 *
 *  One `SessionRunner` runs pretest and checks as a single `scroll` session so
 *  the snapshot, the つづく bookkeeping and `scroll:completed` stay honest; the
 *  view pauses the runner at the first intro check while the cards are read,
 *  and hands `<SessionView>` `teach={false}` so the hosted view does not show
 *  the same cards a second time. (A Scroll block inside a Kumite / Shugyō is
 *  taught by `<SessionView>` itself with the same `<TeachCard>`s.) This view
 *  builds the plan for the scroll the learner picked with the builder's
 *  plumbing (`loadPlanContext` → `scrollSteps` → `finalizePlan`).
 *
 *  `<SessionHost>` mounts E's `<SessionView>` on demand (import.meta.glob) so this
 *  folder's pages work, and test, before that file lands; an injected `view`
 *  stands in for tests.
 */
import type { FunctionComponent, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { content as appContent, type ContentLoader } from '../content/loader';
import { segmentsToTokens, toPlain } from '../content/ruby';
import type { ContentItem, DrillId, StoryItem } from '../content/types';
import { speak } from '../shared/audio';
import { hashSeed } from '../shared/hash';
import type { SessionPlan } from '../shared/session-types';
import type { ItemKind } from '../shared/store-types';
import { Ruby } from '../shared/ui/Ruby';
import { store } from '../store';
import { pretestFor, scrollsForStation, type Scroll } from '../learn';
import { markKnown } from '../learn/apply';
import { estimateStepMs } from './blocks';
import { finalizePlan, loadPlanContext, resolveParams } from './builder';
import { S as ES } from './engine-strings';
import { SessionRunner } from './runner';
import { isIntroCheck, scrollSteps, teachModel, type TeachModel } from './scroll';
import { TeachCard } from './TeachCard';
import { S, SCROLL_KIND_LABEL, fill } from './pages/strings';
import './ScrollView.css';

// The teach card and the pitch mark live in `./TeachCard` (shared with `<SessionView>`); re-exported for callers.
export { PitchMark, TeachCard, pitchHighs, type TeachCardProps } from './TeachCard';

/* ────────────────────────────────────────────────────────────────────────── */
/* SessionHost — deferred <SessionView>                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface SessionViewProps {
  runner: SessionRunner;
  onExit(): void;
  /** Additive: show the teach cards before a Scroll's first intro check (default on; a host that teaches itself passes `false`). */
  teach?: boolean;
}
export type SessionViewComponent = FunctionComponent<SessionViewProps>;

const VIEW_MODULES = import.meta.glob<{ SessionView: SessionViewComponent }>('./SessionView.tsx');
let cachedView: SessionViewComponent | null = null;

/** Loads `./SessionView` once; `null` when the module is not on disk (or fails to load). */
export function loadSessionView(): Promise<SessionViewComponent | null> {
  if (cachedView) return Promise.resolve(cachedView);
  const load = VIEW_MODULES['./SessionView.tsx'];
  if (!load) return Promise.resolve(null);
  return load()
    .then((m) => {
      cachedView = typeof m.SessionView === 'function' ? m.SessionView : null;
      return cachedView;
    })
    .catch(() => null);
}

/** Mounts `<SessionView>` for a runner; `view` injects a stand-in (tests). Degrades honestly when the view is missing. */
export function SessionHost(p: SessionViewProps & { view?: SessionViewComponent }): JSX.Element {
  // Initializer form: a cached component is a function, and `useState(fn)` would call it to compute the initial state.
  const [loaded, setLoaded] = useState<SessionViewComponent | null>(() => cachedView);
  const [missing, setMissing] = useState(false);
  const View = p.view ?? loaded;
  useEffect(() => {
    if (View) return;
    let alive = true;
    void loadSessionView().then((v) => {
      if (!alive) return;
      if (v) setLoaded(() => v);
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [View]);
  if (View) return <View runner={p.runner} onExit={p.onExit} teach={p.teach} />;
  return (
    <div class="session-host" role="status">
      <p>{missing ? S.sessionViewMissing : S.sessionLoading}</p>
      {missing ? (
        <button type="button" class="btn" onClick={p.onExit}>
          {S.leave}
        </button>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Scroll lookup and plan                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ScrollRef {
  station: number;
  index: number | 'cap';
}

/** `<station>-<n>` or `<station>-cap`; stations 1–53. */
export function parseScrollId(id: string): ScrollRef | null {
  const m = /^(\d{1,2})-(\d{1,3}|cap)$/.exec(id.trim());
  if (!m) return null;
  const station = Number(m[1]);
  if (station < 1 || station > 53) return null;
  const index = m[2] === 'cap' ? ('cap' as const) : Number(m[2]);
  if (index !== 'cap' && index < 1) return null;
  return { station, index };
}

const CAPTURED_SCROLL_MAX = 10;

/** The Scroll behind an id (station bundle loaded and preloaded), or `null`. The `-cap` scroll holds the un-introduced captured words. */
export async function loadScroll(id: string, loader: ContentLoader = appContent): Promise<Scroll | null> {
  const ref = parseScrollId(id);
  if (!ref) return null;
  let bundle;
  try {
    bundle = await loader.station(ref.station);
  } catch {
    return null;
  }
  try {
    await loader.preloadStation(ref.station);
  } catch {
    /* partial content: whatever is in memory is used */
  }
  if (ref.index === 'cap') {
    const ids = store.captured.value.filter((x) => x.startsWith('v-') && Object.keys(store.cards.byItem(x)).length === 0).slice(0, CAPTURED_SCROLL_MAX);
    if (ids.length === 0) return null;
    try {
      await loader.load(ids.filter((x) => loader.get(x) === undefined));
    } catch {
      /* offline */
    }
    return { id: `${ref.station}-cap`, station: ref.station, kind: 'vocab', itemIds: ids, pretestIds: pretestFor(`${ref.station}-cap`, ids) };
  }
  return scrollsForStation(bundle, (x) => loader.get(x)).find((s) => s.id === id.trim()) ?? null;
}

export interface ScrollPlanOptions {
  loader?: ContentLoader;
  available?: (id: DrillId) => boolean;
  seed?: number;
}

export interface ScrollPlanResult {
  plan: SessionPlan;
  teach: string[];
  noticing?: { storyId: string; lineIndexes: number[] };
}

/** Pretest + immediate checks of one scroll as a `scroll` session plan, with full param resolution. */
export async function buildScrollPlan(scroll: Scroll, o: ScrollPlanOptions = {}): Promise<ScrollPlanResult> {
  const ctx = await loadPlanContext({ station: scroll.station, loader: o.loader, available: o.available, seed: o.seed ?? hashSeed('scroll', scroll.id), mode: 'scroll' });
  const parts = scrollSteps(scroll, (id) => ctx.loader.get(id), ctx.rng, {
    station: ctx.station,
    settings: ctx.settings,
    available: ctx.available,
    resolve: (ex, item, qc) => resolveParams(ctx, ex, item, { qc, rep: 0 }),
    estMs: (ex, params) => estimateStepMs(ex, params, ctx.medianMs),
  });
  const steps = [...parts.pretest, ...parts.checks];
  const minutes = Math.max(1, Math.round(steps.reduce((a, s) => a + s.estMs, 0) / 60_000));
  const plan = finalizePlan(
    ctx,
    'scroll',
    [{ kind: 'scroll', label: ES.blockScroll, minutes, spec: { kind: 'scroll', minutes, scrollCount: 1 }, stepIds: steps.map((s) => s.id), steps }],
    { dueTotal: 0, dueTaken: 0, backlog: false, newCount: scroll.itemIds.length, scrollIds: [scroll.id] },
  );
  const out: ScrollPlanResult = { plan, teach: parts.teach };
  if (parts.noticing) out.noticing = parts.noticing;
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* View                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export type ScrollPhase = 'loading' | 'missing' | 'failed' | 'pretest' | 'teach' | 'checks' | 'noticing' | 'done';

export interface ScrollViewProps {
  scrollId: string;
  onDone(): void;
  /** Leave without finishing (default: `onDone`). */
  onExit?(): void;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
}

export function ScrollView(p: ScrollViewProps): JSX.Element {
  const loader = p.loader ?? appContent;
  const [phase, setPhase] = useState<ScrollPhase>('loading');
  const [scroll, setScroll] = useState<Scroll | null>(null);
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [noticing, setNoticing] = useState<ScrollPlanResult['noticing']>(undefined);
  const [known, setKnown] = useState<ReadonlySet<string>>(new Set());
  const taught = useRef(false);
  const furigana = store.settings.value.furigana;

  useEffect(() => {
    let alive = true;
    taught.current = false;
    setPhase('loading');
    setRunner(null);
    setScroll(null);
    setNoticing(undefined);
    setKnown(new Set());
    (async () => {
      const s = await loadScroll(p.scrollId, loader);
      if (!alive) return;
      if (!s) {
        setPhase('missing');
        return;
      }
      setScroll(s);
      const built = await buildScrollPlan(s, { loader, available: p.available });
      if (!alive) return;
      setNoticing(built.noticing);
      if (built.plan.steps.length === 0) {
        taught.current = true;
        setPhase('teach');
        return;
      }
      const r = new SessionRunner(built.plan, { loader });
      const first = r.step.value;
      if (first && isIntroCheck(first)) {
        taught.current = true;
        r.pause();
        setPhase('teach');
      } else {
        setPhase('pretest');
      }
      setRunner(r);
    })().catch(() => {
      if (alive) setPhase('failed');
    });
    return () => {
      alive = false;
    };
  }, [p.scrollId, loader, p.available]);

  useEffect(() => {
    if (!runner) return;
    return effect(() => {
      if (runner.done.value) {
        setPhase(noticing ? 'noticing' : 'done');
        return;
      }
      if (runner.abandoned.value) return;
      const step = runner.step.value;
      if (step && isIntroCheck(step) && !taught.current) {
        taught.current = true;
        if (!runner.paused.peek()) runner.pause();
        setPhase('teach');
      }
    });
  }, [runner, noticing]);

  const models = useMemo(() => {
    if (!scroll) return [];
    return scroll.itemIds.map((id) => {
      const item = loader.get(id);
      const model = item ? teachModel(item) : null;
      const contrast = model?.contrastId ? loader.get(model.contrastId) : undefined;
      return { id, item, model, contrast: contrast ? teachModel(contrast) : null };
    });
  }, [scroll, loader]);

  const exit = (): void => {
    if (runner && !runner.done.value) runner.abandon();
    (p.onExit ?? p.onDone)();
  };

  const beginChecks = (): void => {
    if (!runner) {
      setPhase(noticing ? 'noticing' : 'done');
      return;
    }
    runner.resume();
    setPhase('checks');
  };

  const markItemKnown = (id: string, kind: ItemKind): void => {
    markKnown(id, kind);
    setKnown((prev) => new Set([...prev, id]));
  };

  const title = fill(S.scrollTitle, { id: p.scrollId });

  if (phase === 'loading') {
    return (
      <section class="scroll-view" aria-label={S.scrollAria} aria-busy="true">
        <p class="scroll-view__status" role="status">
          {S.scrollLoading}
        </p>
      </section>
    );
  }
  if (phase === 'missing' || phase === 'failed') {
    return (
      <section class="scroll-view" aria-label={S.scrollAria}>
        <div class="notice">
          <p>{phase === 'missing' ? S.scrollNotFound : S.scrollFailed}</p>
          <button type="button" class="btn" onClick={exit}>
            {S.back}
          </button>
        </div>
      </section>
    );
  }

  const head = scroll ? (
    <header class="scroll-view__head">
      <h2 class="scroll-card__title">{title}</h2>
      <p class="scroll-view__sub">
        {scroll.itemIds.length === 1 ? S.scrollItem : fill(S.scrollItems, { n: scroll.itemIds.length })} · {SCROLL_KIND_LABEL[scroll.kind]}
      </p>
    </header>
  ) : null;

  if ((phase === 'pretest' || phase === 'checks') && runner) {
    return (
      <section class="scroll-view" aria-label={S.scrollAria} data-phase={phase}>
        {head}
        <p class="scroll-view__phase">{phase === 'pretest' ? `${S.pretestTitle} · ${S.pretestLine}` : S.checksTitle}</p>
        <SessionHost runner={runner} onExit={exit} view={p.view} teach={false} />
      </section>
    );
  }

  if (phase === 'teach') {
    return (
      <section class="scroll-view" aria-label={S.scrollAria} data-phase="teach">
        {head}
        <h3 class="scroll-view__phase">{S.teachTitle}</h3>
        <p class="scroll-view__sub">{S.teachLine}</p>
        <div class="scroll-view__cards">
          {models.map((m, i) =>
            m.item && m.model ? (
              <TeachCard
                key={m.id}
                item={m.item}
                model={m.model}
                index={i}
                total={models.length}
                furigana={furigana}
                known={known.has(m.id)}
                onKnown={() => markItemKnown(m.id, (m.model as TeachModel).kind)}
                contrast={m.contrast}
              />
            ) : null,
          )}
        </div>
        {!runner ? <p class="notice">{S.scrollNoSteps}</p> : null}
        <div class="scroll-view__actions">
          <button type="button" class="hanko" onClick={beginChecks}>
            {runner ? S.beginChecks : S.continue}
          </button>
          <button type="button" class="btn btn--ghost" onClick={exit}>
            {S.leave}
          </button>
        </div>
      </section>
    );
  }

  if (phase === 'noticing' && noticing && scroll) {
    const story = loader.get<StoryItem>(noticing.storyId);
    const want = new Set(scroll.itemIds);
    const lines = story && 'lines' in story ? noticing.lineIndexes.slice(0, 4).map((i) => story.lines[i]).filter((l): l is NonNullable<typeof l> => l !== undefined) : [];
    return (
      <section class="scroll-view" aria-label={S.scrollAria} data-phase="noticing">
        {head}
        <h3 class="scroll-view__phase">{S.noticingTitle}</h3>
        <p class="scroll-view__sub">{S.noticingLine}</p>
        {story ? (
          <p class="scroll-view__story-title" lang="ja">
            {toPlain(story.titleJa)}
          </p>
        ) : null}
        <ul class="scroll-view__lines">
          {lines.map((line, li) => (
            <li key={li} class="scroll-view__line">
              <span lang="ja" class="scroll-view__ja">
                {segmentsToTokens(line.ja, line.tokens).map((t, ti) => (
                  <span key={ti} class={line.tokenIds?.[ti] && want.has(line.tokenIds[ti] as string) ? 'scroll-view__hit' : undefined}>
                    <Ruby ja={t.ja} mode={furigana} />
                  </span>
                ))}
              </span>
              <span class="scroll-view__en">{line.en}</span>
              <button type="button" class="btn btn--sm btn--ghost" onClick={() => void speak(toPlain(line.ja), { kana: line.kana })} aria-label={`${S.speakButton}: ${line.kana}`}>
                {S.speakButton}
              </button>
            </li>
          ))}
        </ul>
        <div class="scroll-view__actions">
          <button type="button" class="hanko" onClick={p.onDone}>
            {S.continue}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="scroll-view" aria-label={S.scrollAria} data-phase="done">
      {head}
      <h3 class="scroll-view__phase">{S.doneTitle}</h3>
      <p class="scroll-view__sub">{S.doneLine}</p>
      <div class="scroll-view__actions">
        <button type="button" class="hanko" onClick={p.onDone}>
          {S.continue}
        </button>
      </div>
    </section>
  );
}
