# CONTRACT NOTES (day 0 → day 1)

Verbatim hand-off notes from the contract-tier authors. **Binding for all groups**: where these differ from `docs/module-plan.json` or the pseudo-TS in `docs/ARCHITECTURE.md`, the real source files win, and these notes explain the differences. Read the actual exports of any module you import.

## Stage 1 — leaf contracts (shared/*, content/ruby, tokens.css)

All 751 tests pass (13 files) and `tsc --noEmit` is clean for the whole project.

**Files written** (`/Users/christopher.bradford/japanlangrace/`): `src/shared/{time,hash,ids,events,store-types,catalog,routes,exercise-types,session-types,audio,jp,kana-ime}.ts`, `src/content/ruby.ts`, `src/styles/tokens.css`; tests beside time, hash, ids, events, routes, jp, kana-ime (515 cases), ruby, catalog, exercise-types, audio, tokens.

**API summary** — signatures follow ARCHITECTURE/module-plan exactly, plus additive helpers:
- time: `epochDay/dayOf(ms,tz?)`, `dayStartMs/startOfDay`, `dayEndMs`, `isoWeek/isoWeekYear/isoWeekKey`, `weekOf` (absolute Monday-based index; use this for Kage seeding), `weekdayOf`, `daysBetween`, `civilToDay/dayToCivil/localToMs`, `isoDate`, `monthKey`, `formatEraDate`, `formatMinutes`.
- hash: `fnv1a32/hashString`, `xmur3`, `fmix32`, `hashSeed(...parts)`, `mulberry32`, `rngFor`, `pick/shuffle/sample/range(inclusive)/uniform/chance/gauss/weighted`, `randomSeed()` (the only `Math.random`/crypto call).
- ids: `cardKey/parseCardKey/isCardKey/itemOfKey/facetOfKey`, `kindOfId` (throws on unknown; `tryKindOfId` doesn't), `stationOfId/stationId`, `isValidId`, `levelOfId`, `contentKindOf`.
- events: `Events` (§2 verbatim), `bus.{on,once,emit,reset,recent,listenerCount}`.
- store-types: all slices; `STAT_KEYS`, `SLICE_KEYS`, `CardFlag`+`hasFlag/withFlag/withoutFlag`, `LEDGER_KINDS/SOURCES`, `Store<S>`, `SAVE/CARDS/LOG_SCHEMA`. `Profile.kanaKnown: string[]` (kana ids marked 既知).
- catalog: `BADGE_IDS`(66) `WALLPAPER_IDS`(28) `QUEST_IDS`(17)+`QUESTS` (strand/fromStation/requires/phase), `MISSIONS`(5 tiers), `SFX_NAMES`, `SHINSA_SECTIONS`, `BELT_BADGE/beltBadgeId`.
- session-types: adds runtime `SESSION_MODES`, `BLOCK_KINDS`, `SESSION_SCHEMA`, `JikaiYokoku`, `DojoFeed`.
- exercise-types: `registerExercise/resolveExercise(id: ExerciseId)/listExercises/isRegistered/resetRegistryForTests`, `FeedbackState`, `JudgeRequest`; `ExerciseFrameProps` adds optional `onReplay?/onChoice?`.
- audio: `services`, `nullAudio/nullStt`, `installServices/resetServices`, `speak/sfx` helpers, `SPEED_TIER_RATES`.
- jp: `normalizeJa/normalizeAnswer/equivalentJa/normalizeEn`, `moraSplit/moraCount`, `levenshtein`, `moraSimilarity`, `nearMissKind`, `fuzzyEn`, `diffChars`, script predicates.
- kana-ime: `imeStep/convertLive`, `finalizeIme`, `romajiToKana`, `wantsKatakana`, `hasPending`.
- ruby: `parseRuby/toPlain/toKana/hasKanji/kanjiIn/rubyCount/segmentsToTokens/tokensMatchPlain`, `KANJI_RE`.

**Contract deviations/additions others must know**
1. `src/content/types.ts`: added `export type ContentItem = KanaItem|VocabItem|KanjiItem|GrammarItem|StoryItem|MichikusaItem|ComponentDef` (§3 placed it in loader.ts, which doesn't exist yet; C should import/re-export it from types rather than redeclare).
2. `store-types.ts` type-imports `BadgeId/WallpaperId/QuestId` from `catalog` (no cycle) so `collections`/`quests` are typed.
3. IME convention: Hepburn `nn`+vowel/y = ん+n-row (kanna→かんな, konnyaku→こんにゃく); ほんや is typed `hon'ya`. Uppercase is folded; katakana is the `{katakana}` option only.
4. `nearMissKind` returns `null` for `normalizeAnswer`-equivalent variants (grader must check `equivalentJa` first).
5. `ruby.ts` imports `./types.ts` with extension so node strip-types scripts can load it.

**Left for integrator**: none blocking. `routes.ts` sets `document.title` itself on navigate/hashchange (A can drop its own title code or ignore).

## Stage 2a — shared/ui primitives

**Files written** (`/Users/christopher.bradford/japanlangrace/src/shared/ui/`): `Ruby.tsx`, `KanaInput.tsx`, `use-timer.ts`, `ExerciseFrame.tsx`, `Feedback.tsx`, `JudgeCard.tsx`, `ui.css`, `strings.ts` (per-folder copy, convention §8), plus tests `Ruby/KanaInput/ExerciseFrame/Feedback/JudgeCard.test.tsx`, `use-timer.test.tsx` (51 cases, all pass). `tsc` is clean for `src/shared/ui`; the 11 remaining project errors and 7 failing tests are in `learn/intro-policy`, `store/*`, `content/fixtures`, `content/loader`, `learn/judge` (other groups).

**API**
- `Ruby({ja, mode: FuriganaMode, fog?(base)→hide, onReveal?, tokens?, onTokenTap?, vertical?, class?})` — modes are `Settings['furigana']` (`always|fog|tap|off`), not `all|none`.
- `KanaInput({value, onChange, onSubmit(final), katakana?, candidates?, placeholder?, autoFocus?, disabled?, label?, id?})` — `onSubmit` receives the finalized value (`onChange(final)` fires first); Shift+Enter is left to the frame.
- `useTimer({running, deadlineMs?, now?, startedAt?, tickMs?, onTimeout?}) → {elapsed, remaining, progress, timedOut, paused: Signal; pause(); resume(); reset(startedAt?)}`.
- `ExerciseFrame(props)` = contract props + optional `now`, `onTimeout`, `onAgain` (もう一度; hidden if absent), `onResume`. Exports `ExerciseFrameContext`, `useExerciseFrame()`, `useExerciseKeys({onChoice(idx0), onReplay, onSubmit})` — exercises register handlers, never bind keys. Digit index is 0-based.
- `Feedback({state, onAgain?, feel?})`, `feedbackAnnouncement(state)`.
- `JudgeCard(shape & {rng, onPick(pass), onReplay?})`, `rubricMatches(answer, regex)`. Host must add `answer` (rubric) / `heard` (perception) to the exercise's `JudgeRequest`.

**Notes for integrator**: E should pass `now: store.now` to `ExerciseFrame` so `timer.startedAt` is honored (default clock is `performance.now`). Space continues when feedback shows, replays otherwise. `.status-window/.hanko/.btn/.chip/.combo/.tategaki` base styles are expected from A's `components.css`; `ui.css` only layers scoped rules.

## Stage 2b — content loader + fixtures

**Files written** (`/Users/christopher.bradford/japanlangrace/`): `src/content/loader.ts`, `src/content/loader.test.ts` (29), `src/content/fixtures/index.ts`, `src/content/fixtures/fixtures.test.ts` (72). `tsc` clean for `src/content/**`; 131/131 content tests pass. `types.ts` untouched.

**API** — `createLoader(fetchImpl?, base='./content/')`, `content` singleton, `ContentLoader` exactly per §3 plus: `ContentError` (`code: 'http'|'parse'|'schema'|'missing-station'`, `path`, `status`), `CumulativeSets`/`CumulativeKey`, `isChunk(item)`. Lookup strategy documented atop loader.ts: exact index after load → components file → kana by script → story/michikusa by station segment → vocab/grammar by level + cumulative-count sequence estimate → kanji by bundle hint else manifest order; loaded files are never re-scanned; one fetch in the common case; in-flight dedupe per path; Cache API `tsuzuku-content-<version>` best-effort (skipped where `caches` is absent).

Fixtures: `FIXTURE {manifest, stations[1,4], items, components, conjugation, files}`, `createFakeLoader()` (synchronous `get()`, no `load()` needed), `fixtureFetch(f?, {missing?, corrupt?})` (drives the real loader; records `.calls`), `FIXTURE_IDS`, `V`/`G` id maps, `PATHS`, `FIXTURE_STORY_ID 's-04-1'`, `FIXTURE_DIALOGUE_ID 's-04-2'`, `FIXTURE_PITCH_HIGH_ID`, `FIXTURE_CHUNK_IDS`, `FIXTURE_REDIRECT_FROM 'v-n5-0009'`.

**Deviations/additions others must know**
1. `kindOf(id)` returns `'chunk'` for a *loaded* set-phrase/aizuchi VocabItem (same `IdKind` union; `kindOfId` never does).
2. `resolveId` is identity until the manifest is in memory; `getAsync/load` await it first.
3. `cumulative(n)` skips stations absent from the manifest; `getAsync` on `st-`/`cj-` ids resolves `undefined` without fetching.
4. Fixture has both a story and a dialogue (module-plan asked for the dialogue; F needs `options`/`aizuchiSlot`). Components ride in Station 4's `componentIds` (no Station 3 bundle).
5. Story `tokenIds` resolve は→`g-n5-002`, です→`g-n5-001`; other particles null.

**Left for integrator**: none in C. Unrelated failures exist in `src/store/*.ts` (tsc: `CardKey` not exported from store-types) and `src/learn/judge.test.ts`.

## Stage 2c — learn: FSRS/scheduler/queue/governors/intro-policy

Whole project: `tsc --noEmit` clean, 42 test files / 1855 tests pass (1 pre-existing skip, not mine). All verification is done; nothing further needed.

**Files written** (`/Users/christopher.bradford/japanlangrace/src/learn/`): `fsrs.ts`, `fsrs-golden.ts`, `scheduler.ts`, `item-belt.ts`, `known.ts`, `governors.ts`, `intro-policy.ts`, `queue.ts`, `index.ts`, plus `*.test.ts` beside each (130 tests). tsc clean for `src/learn/**` and the whole project; full suite 1855 pass.

**API** — module-plan signatures exactly, plus additive helpers:
- fsrs: `W DECAY FACTOR MAX_INTERVAL`, `retrievability nextInterval(r,s,max?) initialStability initialDifficulty nextDifficulty nextStability sameDayStability schedule`, `fuzzWindow balancedDue stepPending cardRetrievability round2`.
- scheduler: `facetsFor initialFacets newCard warmStart unlockableFacets shouldArchive isKaiden applyRating kaidenQuota`, `UNLOCK_RULES STEP_OFFSETS stepOffsetsFor kichiStart withKaidenFlag KAIDEN_MAX_INTERVAL`.
- item-belt: `itemBelt baseFacet productionFacet BELT_ORDER beltRank beltAtLeast beltPromotion`.
- known: `isKnown knownSet kindOfCards groupByItem createKnownSetCache KNOWN_R`.
- governors: `capFor steadyStateReviews governor` (+`newTarget`, `newPaused`, optional `daysBack`), `REVIEW_CAPS NEW_RATE_BY_BELT presetRate retentionWorkload EXPECTED_MAX_MINUTES`.
- intro-policy: `Scroll scrollsForStation nextScrolls` (+ optional `today`, `introducedOn`, kana/component budgets), `isKanjiUnlockable kanjiUnlocksIn componentReady partition scrollSizes`.
- queue: `QueueCard dueCards(…, kaidenQuota?) gojuonPool recheckCards prodPrompt orderWave interleave insertSteps exerciseFor weakPointSet rapidFirePool kagePools`, `buildQueue interleaveViolations prodPrompts RECHECK_FLAG`.

**Deviations/additions others must know**
1. `KAIDEN_MAX_INTERVAL = 730`: Kaiden-flagged cards exceed the 365-d cap, because 15k cards / 365 d (41/day) > the 36/day lane quota; design's ≤7-day assertion is impossible otherwise (test documents both).
2. `RECHECK_FLAG = 16` (arcade miss) lives in queue.ts; fold into `CardFlag` in store-types.
3. `Scroll.kind` adds `'kana'`; captured-words scroll id is `<station>-cap`.
4. `QueueCard` has optional `tag` (intro/+3/+10/recovery/relearn — gap-rule exempt) and `exercise`.
5. Golden table is self-generated and frozen (ts-fsrs not installed); provenance in the file header.
6. Prod-only vocab ids are chunks (`known`/`queue`); B's derived.ts already relies on this.
7. `warmStart` yields state 2, due today, no steps.

**For integrator**: `fsrs-golden.ts` is re-exported from the barrel; `index.ts` re-exports the grading half by module-plan names (all resolve today).

## Stage 2d — learn: grading/judge/kiai/leech/distractors/conjugate

**Files written** (`/Users/christopher.bradford/japanlangrace/src/learn/`): `grading.ts`, `judge.ts`, `kiai.ts`, `leech.ts`, `distractors.ts`, `conjugate.ts` + six `*.test.ts` beside them (719 tests pass; disk golden-table suite auto-skips until `public/content/conjugation/*.json` exists, then checks every row both directions). `tsc` clean for all six; no duplicate export names across `src/learn/*`, so the barrel's `export *` resolves. Remaining project tsc errors are in `src/store/*` and `scripts/validate-content.ts` (not mine).

**API** — module-plan signatures exact, plus additive:
- grading: `toRating`, `isMature(card|null)`, `isSlow`, `SCORE_BANDS` (0.95/0.80), `SHADOW_BANDS` (0.80/0.60), `grade()` → `{rating, reason, stepMiss, recheck, honest, slow}`, `scoreBandsFor`, `scoreRating`, `ARCADE/UNGRADED/SCORED_EXERCISES`. Ctx gains optional `exposures`, `judge:'pass'|'fail'`, `pretest`.
- judge: `judgeRate` (honesty 0–1), `shouldJudge`, `judgeOptions`, `rubricJudge`/`rubricPasses`, `perceptionJudge`, `honestyRate`, `pushHonesty`, `HONESTY_WINDOW`.
- kiai: `KIAI_RULES`, `kiaiInit`, `kiaiStep` (rep gains optional `cardKey/repIndex/rng/mcFirstExposures`; result adds `kiaiEntered, kiDelta, comboBroken`), `comboTier`, `dueRecoveries`, `isIppon`.
- leech: `isNemesis` (flag), `qualifiesNemesis` (lapses≥8), `markNemesis`, `nemesisPhase(card,log,today,key?,opts?)`, `duelProgress(log,itemId,opts?)`, `nextDuelKey`, `defeat`.
- distractors: `meaningChoices`, `kanaGrid`, `kanjiLookalikes`, `clozeTiles(…,answer?)`, `scrambleTiles`, `particleOptions`, `minimalPairPartner`.
- conjugate: `conjugate`, `applicableForms`, `applicableFormsFor` (ある 11, 要る 12), `conjugateAll`, `acceptedSurfaces`, `isConjugable`.

**Contract notes for others**
1. Guard on <3 reviews returns rating **1 with `grade().stepMiss=true`** — scheduler/apply should take the same-day step path and not count a lapse.
2. Arcade miss → `rating null, recheck:true`; apply sets the flag.
3. `defeat()` resets `lapses` to 0 (so a defeated card doesn't instantly re-qualify).
4. Kiai persists `lostCombo` as an extra prop on `KiaiState` (JSON-safe) for Recovery half-restore. Block (near-miss) costs ki −4 (unspecified in 05; documented in `KIAI_RULES`).
5. `AttemptResult.selfRating` is `1|2|3`; classic Easy (4) is honored at runtime if the UI casts.

**Integrator**: none blocking.

## Stage 2e — store core/persist/migrations/derived/testing

**Files written** (`/Users/christopher.bradford/japanlangrace/src/store/`): `defaults.ts`, `migrations.ts`, `persist.ts`, `store.ts`, `index.ts`, `testing.ts`, `derived.ts` + a `.test.ts` beside each (103 tests). Full suite: 42 files / 1855 pass; `tsc --noEmit` clean project-wide.

**API** (ARCHITECTURE §1 / module-plan signatures kept):
- `store` (signals per slice, `meta/seed/now/today/patch/cards/log/session/storage/flush`), `initStore({slot,now,storage,reducers?})`, `resetStoreForTests`, `registerReducer`.
- `persist.ts`: `createPersist(storage, slot, {onState,hooks,compression})` → `read/readSync/write/remove/schedule/flush/bytes/level/state/compact/compressLargest/dispose`; keys exactly as §1; `SHARD_SPECS` (16), `shardIdFor(key, {level?,station?})`, gzip rung (`'gz1:'` + base64, decoded on load).
- `defaults.ts`: `freshSave`, `INTENSITY_PRESETS`, `newPerDayFor`, `STANDARD_NEW_PER_DAY` (matches `learn/governors`).
- `migrations.ts`: `migrateMeta/Shard/Log`, `applyRedirects`, `MigrationError`, `CURRENT`.
- `testing.ts`: `makeTestStore`, `card`, `MemoryStorage` (quota), `captureEvents`, `deepMerge`, `testSave`.
- `derived.ts`: module-plan names (`dueCount, isBacklog, beltEligibility, stationProgress, forecastCounts, knownVocabCount, projectedArrival, peraperaNow`) + `currentBelt/currentStation/knownCounts/itemBeltOf/peraperaIndex/projection/xpToNextLevel/streakState`.

**Deviations/additions**
1. Kanji ids carry no level: `cards.set(k, t, {level?})` optional hint; otherwise shard = level of `progress.station` (bucketing only; lookups are map-based). Chunk cards live in `vocab.*` (id-routed), not `misc`.
2. `projectedArrival(..., log?)` takes an optional 6th `LogEntry[]` to measure realized introductions.
3. Reducers: `store.ts` has an empty `REDUCERS` list — integrator adds `startXp/startStreak/...` there (or via `registerReducer`); `index.ts` has commented export lines for backup/xp/quests/badge-defs/wallpaper-defs/ledger.
4. Compaction: old daily rows collapse to one row keyed at the month's first EpochDay (shape unchanged); old ledger entries → `ledger.monthly`.
5. `streak.lastDay=0`/`quests.day=0` are "never" sentinels.

**Integrator**: `peraperaNow` approximates rolling windows (読 uses `speedReadBestCpm`) until `perapera.ts` lands; `streakState` should defer to `streak.ts flameState`.

## Stage 2f — pipeline scripts (validate/assign/index)

**Files written** (`/Users/christopher.bradford/japanlangrace/`): `scripts/validate-content.ts`, `scripts/assign-stations.ts`, `scripts/build-content-index.ts`, their `*.test.ts` (59 tests, all pass; full suite 1914 pass), fixtures `scripts/__fixtures__/good/**` + `scripts/__fixtures__/plan-good.json`. `package.json` scripts set as specified (no prebuild); `.github/workflows/deploy.yml` node 24 + `content:index` step; deleted stub `scripts/validate-content.mjs`. `tsc` clean for `scripts/`.

**API**
- `validate(root, {components?, denylist?, strict?, only?, fixTokenIds?}) → {failures, warnings, linked, files, bundles}`, `formatReport`, `moraCount`. CLI: `[--strict] [--json] [--only] [--fix-tokenids] [--root]`, exit 1 on failures.
- `assign(root, plan, {write?, allowlistsDir?}) → {bundles, allowlists, report, assigned, missingFiles, linked}`; also `bundlesFromCorpus`, `linkStories`, `buildMatchPool/matchToken/FUNCTION_TOKENS`, `topoSortKanji`, `placeComponents`, `stringifyJson`, `CAST_NAMES`.
- `buildIndex(root, version, {generatedAt?, check?})`, `writeIndex` (keeps `generatedAt` when unchanged → idempotent), `listContentFiles`.

**Deviations/additions**
1. The linker (tokenIds) runs inside `content:assign`, since `content:all` indexes before `validate --strict`; strict/`--fix-tokenids` validate also writes (no-op afterwards).
2. 120 KB cap applies to hand-written files only: cumulative `surfaces` makes late bundles ≈400 KB (loader owner note).
3. Kana files carry no `level` (guide §1) → manifest `level: null`.
4. Components appear only via `componentIds`; `_meta/components.json` is listed in those stations' `files`.
5. `--strict` = release: V34/V36 fail until Pass 3/quotas; V14 "≥2 examples" warns in strict.
6. V15 14-word warning only for story lines (no tokenizer).
7. Robustness-fuzzed (780 malformed variants, no crashes).

**Integrator**: real corpus validated read-only (`_meta/components.json` passes, denylist absent → W). Assign/index not run on real corpus; `content:index` (hence deploy) fails until `content:assign` has produced `stations/`.

## Stage 3 — integrator (learn/apply, reconciliation)

**Stage 3 result** — `tsc --noEmit` clean project-wide; `npx vitest run` 46 files / 1944 pass (1 pre-existing skip); `npm run build` OK; `node scripts/validate-content.ts` exits 0 (1 WARN: denylist absent).

**Written**
- `/Users/christopher.bradford/japanlangrace/src/learn/apply.ts` + `apply.test.ts` (30 tests).
- `/Users/christopher.bradford/japanlangrace/docs/CHANGELOG.md` (created, 3 entries); ARCHITECTURE §1 flag list and §5 rep loop updated.

**Reconciled**
- `CardFlag.recheck = 16` added to `shared/store-types.ts`; `queue.ts RECHECK_FLAG` now aliases it.
- `content/loader.ts` re-exports `ContentItem` (type-only) so §3's import path works.
- Stage 2 had already left tsc/tests green; no export-name mismatches remained between `learn/index.ts`, `store/derived.ts` and `shared/ui`.

**`@/learn/apply` exports**
- `recordAttempt({sessionId, step, result, boss?, judge?, pretest?, firstRead?, kind?, item?, keys?, speedRingShown?, fast?, kiai?, repIndex?, rng?})` or `recordAttempt(step, result, ctx)` → `StepResult` + `card prev itemId kind facet promoted{from,to} firstProd mature grade stepOffsets unlocked nemesis archived logged recheckSet implicitApplied kiaiState? kiaiResult?`. Emits `attempt:graded`, `item:promoted`, `kiai:entered`; `xpDelta` = `xp:gained` B emits synchronously.
- `recordImplicit(g, {emit?})` (card+log+promotion, never `attempt:graded`; `dueWithin`), `introduceItem(itemId, kind, station)` → created keys, `markKnown(itemId, kind)` (既知; kana → `profile.kanaKnown`), `retireItem(itemId, retired?)`, `defeatNemesis(itemId)`; constants `IMPLICIT_DUE_WINDOW FAST_FACTOR RECENT_LAPSE_DAYS IPPON_DIFFICULTY`.

**Semantics E/F must know**: learning-step miss on a review-state card is scheduled as learning (no lapse); arcade miss sets flag 16, a `params.recheck` step clears it; `stepOffsets` tells the runner the +3/+10/+5 re-queue; pass `kiai` to get real combo facts; pass `keys` (registry empty in tests → `'none'`).

**CHANGELOG entries**: (1) `CardFlag.recheck=16`; (2) `recordAttempt` optional `kiai` runs `kiaiStep` internally, extended return, new `retireItem`/`defeatNemesis`, `markKnown` writes `kanaKnown`, `recordImplicit` no `attempt:graded`; (3) `ContentItem` lives in `types.ts`, re-exported by `loader.ts`.

**Left for integrator**: `store.ts REDUCERS` still empty (B's xp/streak/quests modules not yet written); `content:index`/deploy still need `content:assign` output.
