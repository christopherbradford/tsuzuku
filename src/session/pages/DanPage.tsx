/**
 * TSUZUKU — `#/dan`: the Dan road past Kyoto (design 02 §3).
 *
 *  Dōjō Yaburi modules 二段 … 十段 with their machine-checkable criteria as
 *  progress bars (now / target), the current rank, "Take the rank" when every
 *  criterion of the next dan holds (`promoteDan`), and the 10-minute gauntlet
 *  (`buildGauntlet`) run through `<SessionView>`. Locked, honestly, until the
 *  Shodan Shinsa at Sanjō Ōhashi. Where a criterion stands in for a stat the
 *  save cannot measure yet, its label says what is counted.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { content, type ContentLoader } from '../../content/loader';
import type { DrillId } from '../../content/types';
import { hashSeed } from '../../shared/hash';
import { href, type Route } from '../../shared/routes';
import type { SessionPlan } from '../../shared/session-types';
import { store } from '../../store';
import { STRAND_SHARES } from '../blocks';
import { fill } from '../engine-strings';
import { MAX_DAN, buildGauntlet, danProgress, danTitle, nextDanReady, promoteDan, type DanProgress } from '../dan';
import { SessionRunner } from '../runner';
import { SessionHost, type SessionViewComponent } from '../ScrollView';
import { S } from './strings';
import './pages.css';

export interface DanPageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Additive: drill availability (default: the registry). */
  available?: (id: DrillId) => boolean;
  /** Additive: stand-in for `<SessionView>` (tests). */
  view?: SessionViewComponent;
  /** Additive: a prebuilt gauntlet (tests); skips `buildGauntlet`. */
  plan?: SessionPlan;
  /** Additive: called with the runner this page creates (tests). */
  onRunner?(r: SessionRunner): void;
}

type DanStage = 'list' | 'building' | 'failed' | 'empty' | 'run' | 'done';

export function Criterion(p: { label: string; now: number; target: number; ok: boolean }): JSX.Element {
  const pct = p.target > 0 ? Math.min(100, Math.round((p.now / p.target) * 100)) : p.ok ? 100 : 0;
  return (
    <li class="dan-criterion" data-ok={p.ok ? 'true' : 'false'}>
      <span class="dan-criterion__row">
        <span class="dan-criterion__label">{p.label}</span>
        <span class="dan-criterion__count">{fill(S.danCriterion, { now: p.now, target: p.target })}</span>
      </span>
      <span class="progress progress--matcha" role="progressbar" aria-label={p.label} aria-valuemin={0} aria-valuemax={Math.max(1, p.target)} aria-valuenow={Math.min(p.now, Math.max(1, p.target))}>
        <span class="progress__fill" style={{ width: `${pct}%` }} />
      </span>
    </li>
  );
}

export function DanModuleCard(p: { module: DanProgress; current: boolean; open: boolean }): JSX.Element {
  return (
    <article class="dan-module" data-dan={p.module.dan} data-current={p.current ? 'true' : 'false'} data-ready={p.module.ready ? 'true' : 'false'} aria-label={fill(S.danModule, { dan: danTitle(p.module.dan), name: p.module.nameEn })}>
      <header class="dan-module__head">
        <h3 class="dan-module__name">
          <span lang="ja">{p.module.nameJa}</span> · {danTitle(p.module.dan)}
        </h3>
        <span class="page__muted">{p.module.nameEn}</span>
      </header>
      {p.open ? (
        <ul class="dan-criteria" aria-label={S.danCriteriaTitle}>
          {p.module.criteria.map((c, i) => (
            <Criterion key={i} label={c.label} now={c.now} target={c.target} ok={c.ok} />
          ))}
        </ul>
      ) : (
        <p class="page__muted">{p.module.ready ? S.danReady : S.danLater}</p>
      )}
    </article>
  );
}

export default function DanPage(p: DanPageProps): JSX.Element {
  const loader = p.loader ?? content;
  const profile = store.profile.value;
  void store.stats.value;
  void store.ledger.value;
  void store.streak.value;
  void store.kage.value;
  const meta = store.meta();
  const [stage, setStage] = useState<DanStage>('list');
  const [runner, setRunner] = useState<SessionRunner | null>(null);
  const [promoted, setPromoted] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const finished = useRef(false);

  useEffect(() => {
    if (!runner) return;
    return effect(() => {
      void runner.index.value;
      setTick((t) => t + 1);
      if (runner.done.value && !finished.current) {
        finished.current = true;
        setStage('done');
      }
    });
  }, [runner]);

  if (profile.dan < 1) {
    return (
      <section class="page page--dan" aria-label={S.danAria}>
        <header class="page__head">
          <h2 class="page__title">
            <span lang="ja">道場破り</span> {S.danTitleEn}
          </h2>
          <p class="page__sub">{S.danSub}</p>
        </header>
        <div class="notice">
          <p>{S.danLocked}</p>
          <a class="btn" href={href({ name: 'road' })}>
            {S.backToRoad}
          </a>
        </div>
      </section>
    );
  }

  const modules = danProgress(meta);
  const next = Math.min(MAX_DAN, profile.dan + 1);
  const ready = nextDanReady(meta);

  const begin = async (): Promise<void> => {
    setStage('building');
    finished.current = false;
    try {
      const plan = p.plan ?? (await buildGauntlet(next, hashSeed(store.seed(), 'dan', next, store.today()), { loader, available: p.available }));
      if (plan.steps.length === 0) {
        setStage('empty');
        return;
      }
      const r = new SessionRunner(plan, { loader });
      p.onRunner?.(r);
      setRunner(r);
      setStage('run');
    } catch {
      setStage('failed');
    }
  };

  const leave = (): void => {
    if (runner && !runner.done.value && !runner.abandoned.value) runner.abandon();
    setRunner(null);
    setStage('list');
  };

  const take = (): void => {
    if (promoteDan(next)) setPromoted(next);
  };

  const header = (
    <header class="page__head">
      <h2 class="page__title">
        <span lang="ja">道場破り</span> {S.danTitleEn}
      </h2>
      <p class="page__sub">{S.danSub}</p>
      <p class="dan-rank">
        <span class="page__label">{S.danCurrent}</span>
        <span class="dan-rank__name" lang="ja">
          {danTitle(profile.dan)}
        </span>
        {profile.dan < MAX_DAN ? <span class="page__muted">{fill(S.danNext, { name: danTitle(next) })}</span> : null}
      </p>
    </header>
  );

  if (stage === 'run' && runner) {
    return (
      <section class="page page--dan" aria-label={S.danAria} data-stage="run">
        <SessionHost runner={runner} onExit={leave} view={p.view} />
      </section>
    );
  }

  return (
    <section class="page page--dan" aria-label={S.danAria} data-stage={stage}>
      {header}
      {promoted !== null ? <p class="notice notice--shu">{fill(S.danPromoted, { dan: danTitle(promoted) })}</p> : null}
      {stage === 'done' ? <p class="notice">{S.danGauntletDone}</p> : null}
      {stage === 'failed' || stage === 'empty' ? <p class="notice notice--warn">{stage === 'empty' ? S.danEmptyPlan : S.danBuildFailed}</p> : null}
      {stage === 'building' ? (
        <p role="status" class="page__muted">
          {S.danBuilding}
        </p>
      ) : null}

      <section class="page__section" aria-label={S.danCriteriaTitle}>
        {modules.map((m) => (
          <DanModuleCard key={m.dan} module={m} current={m.dan === next} open={m.dan === next} />
        ))}
        <p class="page__muted">{S.danStandIn}</p>
        <p class="page__muted">{fill(S.danShares, { form: Math.round(STRAND_SHARES.dan.form * 100), input: Math.round(STRAND_SHARES.dan.input * 100), output: Math.round(STRAND_SHARES.dan.output * 100) })}</p>
      </section>

      <div class="page__actions">
        {ready !== null && ready === next ? (
          <button type="button" class="hanko" onClick={take}>
            {S.danPromote}
          </button>
        ) : null}
        <button type="button" class={ready === next ? 'btn' : 'hanko'} onClick={() => void begin()} disabled={stage === 'building'}>
          {S.danGauntlet}
        </button>
        <a class="btn btn--ghost" href={href({ name: 'road' })}>
          {S.backToRoad}
        </a>
      </div>
      <p class="page__muted">{S.danGauntletLine}</p>
    </section>
  );
}
