# TSUZUKU — build status

Snapshot taken 2026-10-17 after the integration pass and the round-1 review (census below). Numbers come from a clean run of
`npm run typecheck`, `npm test` and `npm run build` at the repo root; re-run them to refresh.

## Health

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | clean (0 errors) |
| `vitest run` | 239 test files · 5707 tests passed · 0 skipped (console noise only from tests that exercise error paths: persist `setItem`, dojo feed, bus subscriber) |
| `vite build` | succeeds (~5 s) · 21 JS chunks + 10 CSS files · `dist/sw.js` stamped per build (`CACHE_VERSION = '0.1.0-387d997d'`, differs from `public/sw.js`) |
| `dist/` | 24024 KB in all (assets 1480 KB, copied `content/` 19404 KB, `fonts/`) · largest JS chunk 220 kB (`index-BnROeMt1`), well under the 1200 kB warning limit · SW, manifest and favicon copied |
| `node scripts/validate-content.ts` | **2 failures, 84 warnings in 127 files** at the integration pass (report only; not re-run for the review census — the corpus is being written by another fleet) |

No test is skipped: `src/app/pages.test.ts` now asserts `expect(missing).toEqual([])` outright
(the former `skipIf` case was removed in the review) and adds a dojo-waits-for-registry test.

## Counts

| Area | Source modules | Test files | Notes |
|---|---|---|---|
| `src/app` | 14 | 16 | shell, router, theme, SW registration, `use-dialog-focus`, 5 pages, boot test |
| `src/shared` | 19 | 16 | contract tier incl. `shared/ui` |
| `src/content` | 4 | 3 | types, loader, ruby, fixtures |
| `src/store` | 24 | 22 | persistence, XP, quests, streak, ledger, defs, backup, derived, `due.ts` |
| `src/learn` | 16 | 15 | FSRS, queue, governors, kiai, leech, conjugate, judge, apply |
| `src/exercises` | 39 | 31 | 26 drills + ChoiceGrid / TextAnswer / PitchLine |
| `src/session` | 31 | 27 | builder, runner, gate, shinsa, kage, dan, 7 pages |
| `src/input` | 30 | 26 | reader, listening, speaking, taiwa, writing, missions, 3 pages, 9 drills |
| `src/audio` | 6 | 4 | TTS, STT, SFX, voices |
| `src/records` | 7 | 5 | Records + Ledger pages, radar, weak-point map |
| `src/collections` | 9 | 7 | Collections, Studio, Library pages |
| `src/art` | 62 | 53 | primitives, Mon, Goshuin, dojo scene, ceremonies, 28 wallpapers, PNG export |
| `src/styles`, `src/i18n` | 2 | 6 | CSS (4 files, not counted as modules) + strings |
| `src/main.tsx`, smoke | 1 | 2 | composition root |
| `scripts/` | 3 (+1 mjs) | 3 | validator, station assigner, index builder |
| **Total** | **262** | **239** | 5707 tests, 0 skipped (vitest census; per-area rows are from the integration pass) |

Registry: all 35 `DRILL_IDS` are registered at boot (D 26 from `src/exercises`, F 9 from `src/input`);
all 20 routes resolve to a page module; all 28 `WALLPAPER_IDS` have a generator.

## What each group delivered

- **A-shell** — `index.html` (manifest, apple-touch-icon, mobile-web-app meta), `App`/`ErrorBoundary`, `Layout` (nav, SW-update toast, weekly backup reminder), hash router, theme, `pages.ts` lazy route table + `ensureExercises()`, `sw-register.ts` (production-only, relative scope), `public/sw.js`, `manifest.webmanifest`, `.ics` export, `main.tsx` boot.
- **A-pages** — Dojo, Onboarding (Nihonbashi), Settings (incl. danger-zone reset), Backup (export/import/merge preview), About (version + load-error panel); `vite.config.ts` `VITE_APP_VERSION`.
- **B-core** — store: slots/shards/quota ladder, migrations, day roll, streak + flame/vacation, XP tables, quests, ledger, weak points, stats/honesty, backup merge, `testing.ts` doubles (`MemoryStorage`, `makeTestStore`, `captureEvents`).
- **B-defs** — 66 badge defs with machine-checked conditions, 28 wallpaper defs + quadrant reveal, `derived.ts` read-model: Perapera index + monthly snapshot (`startPerapera`), road projection / projected arrival, forecast counts.
- **C (contract)** — content schemas and the 53 stations, cached `./content/` loader with Cache API + redirects, ruby parser, in-memory fixtures (`createFakeLoader`); pipeline scripts (validator V01–V36, station assigner, index builder).
- **learn (contract)** — FSRS-5 + golden table, scheduler/queue/governors, item belts, Kiai, leech → nemesis, conjugation engine, grading bands, judge rubrics, distractors, known-kana; `apply.ts` single writer with `recordAttempt`/`retireItem`/`defeatNemesis`.
- **D-shared** — `ExerciseFrame`, `Feedback`, `JudgeCard`, `Ruby`, `KanaInput` (wanakana IME), `check.ts` answer normalisation, `exercises/index.ts` registry of 26 drills.
- **D-kana-vocab** — KanaFlash, KanaEar, KanaForge, Gojūon Fighter; AudioFlash, MeaningGuard, MeaningJudge, MeaningRecall, PitchEar, ProductionForge.
- **D-kanji-grammar** — ComponentFlash, ComponentAssembly, KanjiRead, KanjiWrite, LookalikeDuel; FormForge, FormChain, PatternCloze, ParticleDuel, Scramble, JudgmentCall.
- **D-grammar2-listen-fluency** — Transform; MinimalPair, SentenceListen; RapidFire, NemesisDossier.
- **E-logic** — session blocks + builder (Kata/Kumite/Shugyō/Kage), runner, scroll steps, Gatekeeper four-phase check, Shinsa exams + Sensei's Notes, Kage pools, Dan road, nemesis duels, end card, `dojoFeed`.
- **E-ui-session** — `SessionView`, `Hud`, `ScrollView`, `GateView`, `ShinsaView`, `KageView`, `MichikusaStep`, `EndCard`, `RoadNav`, `TrainPage`; **E-ui-road** — Scroll, Station, Gate, Shinsa, Road, Dan pages.
- **F-reader / F-logic** — StoryReader with furigana fog, tap-to-gloss, comprehension, SpeedRead, coverage/CPM, word capture; Story page.
- **F (listening, speaking, taiwa, writing, missions, audio)** — ListeningArena + Listen page; Shadow, SayThreeWays, Monologue, Recorder + scoring; RolePlay with aizuchi/register logic + Taiwa page; WritingDojo; FieldMission; `src/audio` TTS/STT/SFX services; 9 F drills registered.
- **B (records UI)** — Records and Ledger pages, Perapera radar, weak-point map, charts.
- **G-prims** — SVG/brush/pixel/noise/geometry/colour primitives, Japanese text layout, `png.ts` export pipeline (`exportPng`, `download`, 4K check).
- **G-mon** — 66 original Mon crests (`MonCrest`), Goshuin stamps (`GoshuinStamp`).
- **G-wall (four wallpaper groups, G-wall-1…4)** — 28 Kakejiku generators in `art/wallpapers` + `data.ts` (learner-data binding) + registry with snapshot tests.
- **G-dojo** — procedural Dojo home scene (room, bonsai, flames) that grows with the save.
- **G-ceremony** — `CeremonyHost` overlay, BadgeSlam, BeltCeremony, StampPress, WallpaperUnlock.
- **G-collections** — Mon grid, Goshuin book, Kakejiku gallery, library model; Collections, Studio, Library pages.

## Known gaps

Content (owned by the content fleet; the app degrades, CI will not):
- `validate-content` exits 1: V32 duplicate word+kana `速やか/すみやか` (`v-n2-1099`, `v-n2-1384`). 84 warnings: V33 capitalised glosses (proper nouns, days, months), V22 register mismatches in N3/N4 grammar examples, V26 missing conjugation forms for ある / 要る, V06 asymmetric `pairId`s. The deploy workflow runs `content:validate` first, so a push fails until V32 is resolved.
- `public/content/manifest.json` does not exist yet (`stations/NN.json` for all 53 stations and a first `stories/` tranche have landed). Run `npm run content:all` once the corpus is complete; until then the loader's `manifest()` 404s and the Dojo falls back to `derived.forecastCounts()`.
- Pitch post-pass not run: 0 `pitchConfidence: high` items in the corpus, so pitch cards / Pitch Ear / the pitch-five quest are inert; the quest is now gated on a `#pitch` card existing (`store/quests` `NEEDS_FACET`).
- `public/fonts/` now holds the four OFL `.woff2` subset families (DotGothic16, Yuji Syuku, Shippori Mincho B1, Dela Gothic One) plus licences; the service worker keeps them in a stable `tsuzuku-fonts-v1` cache that `cleanOldCaches` never evicts.

Store / schema:
- Rapid Fire "first run of the day" lives in the xp reducer closure; a reload the same day lets a second run earn XP (no save field).
- Perapera monthly snapshot is performed by `startPerapera` on `day:rolled`, not inside `store/day.ts` (by design; wired in `main.tsx`).
- `SaveMeta.writings` has not landed; Writing Dojo keeps sentences under `作文: ` bookmarks, and `WallpaperData.writingSentences` is always empty.
- `gojuonMs` is mined from the review log, but arcade reps are not logged, so it is `{}` until a per-kana latency store exists.
- Perapera 読/耳/口/場 use lifetime ratios instead of the design's rolling windows (no persistent window data).
- No last-export timestamp: the weekly backup reminder is "Monday, ≥7 days, ≥1 session", not "a week since the last export".
- Save-slot switching is read-only until `boot()` persists a slot preference (Settings now says "One save slot for now"); the danger-zone reset leaves the review-log ring in place (rolls over naturally).
- `<key>.bak` stashes (meta and card shards the store could not read) count toward the 4.5 MB budget and are never pruned or surfaced; a Backup-page line listing `.bak` keys / export prompt is a follow-up.
- Stored difficulty `d >= ~8` on once-lapsed cards is inflated by the pre-review FSRS-4.5 damping; mean reversion is too weak to self-correct and no migration ships (pre-release). A one-off migration lowering `d` on cards with `lapses >= 1` is optional.
- Kana `prod` cards are created at introduction but nothing serves a state-0 card, so kana cannot reach Brown (item-belt needs prod S >= 7); needs `scrollSteps` to emit a second immediate check for the prod facet and `store.cards.dueOn` to skip state-0 cards (or an unlock rule / warmStart).

Sessions / exercises:
- Shugyō "Kage replaces Output on Mondays" is supported by the template but `buildPlan` leaves the block empty; the dedicated Kage mode is the scored path.
- Sentence-listen/shadow steps built from vocab examples carry no `storyId`; Transform params are "rewrite with the pattern" between two examples (no sentence-level transformation data in content); an empty accept list shows the missing-item message and relies on the frame's Guard.
- LookalikeDuel without `params.choices`/declared lookalikes has no distractor pool and falls back to shown-not-tested; ParticleDuel's step-less fallback only blanks particles; PitchEar's minimal-pair contrast needs the homophone in the loader's sync cache; ComponentAssembly shows a loading line until `content.components()` resolves.
- RapidFire's "Free play / First run today" note is inferred from a synchronous `xp:gained` and hidden when reducers are not started.
- Kage mode with no recent/mature cards shows the honest empty state; the Dojo's Kage strip renders from `feed.kage`, the hi-score table lives on `#/train/kage`.
- Speed Read is not yet restricted to previously read episodes (`progress.storiesRead` is now recorded by `stats.ts`; gating waits for the planner to schedule speed-read).

Art / verification:
- `exportPng`'s real PNG encode cannot run under jsdom; the pipeline is covered with a recording `RasterEnv` and the SVG was checked in headless Chrome, but a real Blob export has not been exercised in a browser.
- Ceremony animations and the standalone dakuten glyph offset are verified structurally in jsdom only; the stamp text inside an `<img>`-loaded SVG uses the system mincho fallback until consumers route text through `exportPng`.
- `vite build` warns that `SessionView.tsx` is both statically (TrainPage) and dynamically (ScrollView) imported, so it is not split into its own chunk. Harmless at the current size.

Deferred cross-group requests (no emitter/consumer yet): `ceremony:flush`, `word:captured`, `AttemptResult.why`; `SLIP_PARTICLES` may alias `learn/PARTICLES` once `も` is added there; G's local restatements of `isUnlocked`/`WALLPAPER_BY_ID`/`BADGE_CATEGORIES` in `KakejikuGallery.tsx` and `art/dojo/room.ts` can now import from `@/store`.

## Review (2026-10-17)

Round-1 review across the areas (app, store, learn, input/audio, contract). Final census:
`tsc --noEmit` clean, `vitest run` 239/239 files and 5707/5707 tests, `npm run build` ok; no
`_review_` / `_skeptic_` scratch directories remain in the tree.

### Fixed

The review ledger records 96 fixes. The ones handed to the scribe intact are listed here, one line each;
the remainder (learn, input/audio, session and contract fixes) are in the per-area review notes and the
`docs/CHANGELOG.md` entries requested below.

- app #1 — First visit no longer reloads itself: `sw-register.ts` reloads on `controllerchange` only after `applySwUpdate()` set `wantReload` (reset in `resetSwForTests`); test covers first-install claim + later learner-driven reload.
- app #2/#13/#16 — Service worker no longer intercepts `content/**` (`manifest.json` stays stale-while-revalidate); the loader's `tsuzuku-content-<version>` cache is the single offline store; tests assert content requests fall through even with a stale runtime cache and that manifest SWR refreshes.
- app #3 — `sw.js` is stamped per build: `CACHE_VERSION = '__TSUZUKU_BUILD__'` replaced by a `vite.config.ts` `closeBundle` hook with `<pkg.version>-<sha256(index.html + asset names)>`; fonts moved to a stable `tsuzuku-fonts-v1` cache excluded from `cleanOldCaches`; `stampSw`/`buildStamp` unit-tested (`sw.test.ts` runs in the node environment).
- app #4 — `networkFirst` stores a navigation response under `index.html` only when its Content-Type is `text/html`; test navigates to a JSON file and confirms the offline shell is still HTML.
- app #5 — SettingsPage computes `japaneseVoices(services.audio.voices())` in render after reading `hasJaVoice`; test flips the signal after mount and sees the picker fill.
- app #6 — `onbIntro` → "Twenty minutes a day to start."; `onbKanaPromptHint` → "Type romaji or kana. Enter checks it." (plain input kept deliberately).
- app #7 — BackupPage storage hint shows only `bakAdvice` (threshold line removed); test asserts a single "KB of" figure.
- app #8 — Pace hint maps casual/standard/intense to `onbPace*Desc`, custom keeps `setCustomHint`; review-cap hint appears once.
- app #9 — Settings slot: dropped `setSlotCurrent`/`setSlotNote`; `setSlotHint` → "One save slot for now; more arrive with a later update." (collections/session jargon → cross-area requests).
- app #10 — `banned.test.ts` scans `QUESTS`, `MISSIONS`, `STATIONS`, `BELTS` and the `.ics` text as exported values (plus no `!`).
- app #11 — `aboutJudgeTitle` → "Metsuke, the inspector"; `aboutJudge` links both names; `aboutRule9` untouched.
- app #12 — `navLibraryJa` → 書庫 (`routes.ts` `titleFor` → contract request).
- app #14 — `ics.ts` `safeTz()`: structural regex + `Intl.DateTimeFormat` probe, UTC fallback; CRLF-injection regression test.
- app #15 — `boot()`: `render(<App overlays={signal}/>)` before `initStore` so the loading mark paints; `installAudio`/`loadOverlays` fire-and-forget; boot-time `ensureExercises` dropped and `dojoProps()` awaits `ensureExercises()` so the feed never sees an empty registry; `App` accepts overlays as array or signal.
- app #17 — `pages.test.ts`: hard `expect(missing).toEqual([])`, `skipIf` cases removed, dojo-waits-for-registry test added (0 skips now).
- app #18 — `base.css` `.ja`: `word-break: normal` + `auto-phrase` (strict `line-break` kept).
- app #19 — tokens `--kin-text`/`--shu-text` (both themes) and invariant `--ink`; used by `.btn--danger`, `.chip--tag`, `.chip--kiai`, `.nav__item[aria-current]`, `.layout__dan`, `.hiscore`; `tokens.test` asserts >= 4.5:1 on bg/surface/raised in both themes.
- app #20 — `Layout.css`: header static below 900px; `.layout__status` hidden on train/gate/shinsa; `--header-height` computed from the brand row.
- app #21 — `pages.css` `.page__title-ja { flex-shrink: 0 }`.
- app #22 — BackupPage Replace dialog via new `useDialogFocus` hook (`src/app/use-dialog-focus.ts`): Cancel focused first, Escape closes, Tab trap, focus restored to opener.
- app #23 — `base.css` fieldset/legend reset + `legend.field__label` spacing in `components.css`.
- app #24 — `.btn--sm` `min-height: var(--touch)`; test asserts it.
- store #1 — Quota failure masked: `persist.ts` tracks failures per debounced key (`failed` Set); level/state read "ceiling" while any key fails; `settle()` re-fires `onState` on every flush while something fails; immediate `write()` failures no longer pin the level; added `failing()`, `readRaw()`, `writeRaw()`.
- store #2/#12 — Unreadable save silently replaced: `initStore` stashes the raw text as `<key>.bak` for meta and every card shard on both parse failure and `MigrationError`; shards keep loading/writing normally.
- store #3 — Import discards header: new `store.ts` `replaceHeader({seed, createdAt, contentVersion})`; `backup.ts` `applyMeta` calls it in both modes (replace takes the backup's seed; merge keeps `cur.seed` with min-positive `createdAt` / `contentVersion` fallback). Round-trip test made non-vacuous.
- store #4/#13 — Log union by push order: new `store.ts` `replaceLog(entries)`; `backup.ts` `unionLogs()` dedupes on `t|cardKey`, sorts by `t` and keeps the newest `LOG_RING` by time; tests for dedupe and full-ring + older backup.
- store #5/#10 — Shallow import validation: `migrations.ts` `fillMeta` is type-aware against `freshSave()` (recursive coerce; belt in `BELT_IDS`); new `migrateMetaChecked()` returns coerced paths; `previewImport` pushes one warning (`S.importRepaired`). Repairs hand-edited localStorage at boot too, so a null name can no longer crash `isFirstRun`.
- store #6 — `initStore` drops pending writes: `if (persist) await persist.flush()` before `teardown()`; `runLadder` holds its own Persist reference so a re-init mid-ladder never touches the next slot.
- store #7 (part B) — No story recorded as read: `stats.ts` `story:read` handler appends `storyId` to `progress.storiesRead` once, any mode/score.
- store #8 (store part) — Three Kata never drawn at station 0: `pickDailyQuests` uses `Math.max(1, station)` like the builder, and `fillMeta` lifts a save that finished onboarding from station 0 to `max(1, max(stationsCleared)+1)` at boot/import; two tests encoding the old behaviour updated.
- store #9 (store part) — `dueCount` counted never-reviewed cards: new `src/store/due.ts` `isDueReview` (state != 0, not archived/kaiden); `derived.dueCount()` uses it while `CardsApi.dueOn` stays the raw primitive.
- learn — `fsrs.ts` `nextDifficulty` now applies the FSRS-5 linear damping `ΔD·(10−D)/9` before mean reversion (was the FSRS-4.5 form; D saturated at 10 after 1–2 Agains); `fsrs-golden.ts` regenerated (seed `mulberry32(0x5eed)`, 60 rows). Additive exports `learn/distractors.ts` `meaningKeys`/`sharesMeaning` and `learn/queue.ts` `findBlank`.
- session — `RunnerOptions.persist`, `RunnerSnapshot.activeMs`, `SessionResult.startedAt = endedAt - active`, `Progress.gateAttemptDay` now written, Nemesis block in Kumite/Shugyō, Particle Duel scheduling from Station 5, builder split into `params.ts` / `pickers.ts` (re-exported), `TeachCard.tsx` split out of `ScrollView`.

### Skipped after verification (12)

- store #1 — Layout/Settings "ceiling" copy + un-dismiss notice: UI copy lives in `src/app`; the notice already renders from `store.storage.value` now that the level is reported correctly (cross-area request).
- store #9 — `forecastCounts` `newItems` gating / planned `estMs`; `dojoFeed` +5 gating: Skeptic said leave the `forecastCounts` fallback as-is (no plan context); `dojoFeed` is in `src/session` (cross-area request).
- store #7 parts F (StoryReader `firstRead`) and E (builder unread-first): `src/input` and `src/session` are other areas (cross-area requests).
- store #8 — OnboardingPage `finish()` station=1 and gatekeeper `n >= p.station`: `src/app/pages` and `src/session` are other areas; store-side clamp + boot lift shipped.
- store #2/#12 — "mark shard read-only" part of the suggested fix: per both skeptics it would silently drop every new review in that level; the `.bak` stash alone was done.
- learn #5 — Kana `prod` cards created at intro but never scheduled: root cause and both fixes live outside `src/learn` (`session/scroll.ts` second immediate check for the prod facet; `store.cards.dueOn` skipping state-0 cards). The in-area alternatives contradict design 05 §2 and break `scheduler.test.ts` / `facetsFor`. Filed as cross-area requests; listed under Known gaps.
- input #6 — Missing test: Enter during IME composition must not submit (`KanaInput.test.tsx` / `ExerciseFrame.test.tsx`): both files live in `src/shared/ui` (contract tier); raised as a contract request.
- contract #11 — `nullAudio.canSpeak = signal(false)`: 43 test doubles spread `nullAudio` and 8 set `hasJaVoice: signal(true)` expecting to be audible; a false `canSpeak` would make `voiceAudible()` false for all of them. `canSpeak` stays optional and deliberately unset on `nullAudio`; documented in `audio.ts`, CHANGELOG and ARCHITECTURE §3.
- contract #9 — `KanaInput` `candidateReading` prop: optional; `TextAnswer` already gates `candidates` itself; no `shared/ui` change needed.
- contract #33 — shared `effectiveNewPerDay(settings, belt)` for `derived.ts`/`projection.ts`/RoadPage: cross-area (`store/derived.ts` cannot import `session/pickers`); the one-place rule should be hosted in `src/store/defaults.ts` next to `newPerDayFor` (cross-area request).
- contract #34, #35 — requesters recorded no change needed.
- contract #39 — `scroll.test.ts` tsc error: baseline and final `tsc --noEmit` are clean for the whole repo; nothing to do.

### Deferred to the content pipeline / contract owner

The BUILD_STATUS items from this list (stale "1 skipped" wording; new Known-gaps lines for the pitch post-pass,
`.bak` stashes, Speed Read gating, kana `prod`, inflated FSRS difficulty) are applied in this file. Still open:

- `docs/design/01` §4.3 token table: add `--kin-text` (#7A5A05 / #E0B341), `--shu-text` (#B0241F / #FF6A5E) and `--ink` (#1A1A1F, invariant) rows (app #19).
- `docs/design/07-architecture.md` §10: SW now serves `content/**` without caching (loader cache is the offline store); fonts in a stable cache; `CACHE_VERSION` stamped per build (app #2/#3/#16).
- `docs/design/06` §6: soften "五段 content pack" wording so the next content pass does not reintroduce it (app #9).
- `docs/ARCHITECTURE.md` §1: note that `derived.dueCount()` counts due reviews (`store/due.isDueReview`) while `CardsApi.dueOn` stays the raw primitive, and that re-initialising the store flushes the outgoing slot first.
- `docs/design/05-srs-and-pedagogy.md` §1: replace the D' line (FSRS-4.5 form) with the FSRS-5 update `ΔD = −w6·(g−3); D″ = D + ΔD·(10−D)/9; D' = w7·D0(4) + (1−w7)·D″`, clamped 1..10.
- `docs/CHANGELOG.md` (contract tier): `2026-10-17 · learn/fsrs.ts nextDifficulty` FSRS-5 damping entry + `fsrs-golden.ts` regeneration; additive exports `learn/distractors.ts` `meaningKeys`/`sharesMeaning`, `learn/queue.ts` `findBlank`.
- `docs/CHANGELOG.md`: entries for `RunnerOptions.persist`, `RunnerSnapshot.activeMs`, `SessionResult.startedAt`, `Progress.gateAttemptDay`, Nemesis block in Kumite/Shugyō, Particle Duel from Station 5, builder split (`params.ts` / `pickers.ts`), `TeachCard.tsx` split out of `ScrollView`.
- Optional: a one-off migration lowering inflated stored difficulties on cards with `lapses >= 1` (acceptable to leave for a pre-release build).
- Cross-area requests filed during the review (store → app/session/input; learn → session/store; input → shared/ui; contract → store `defaults.ts`) await their owners' next pass.

## Next steps

1. **Content pass 2** — resolve V32, land `stories/` (137 graded stories and dialogues against each station's allowlist), run `npm run content:all` to produce `stations/NN.json` + `manifest.json`, then re-run the validator with `--strict` so V34 quotas are checked.
2. **Content pass 3** — clear the V22/V26/V33/V06 warnings, fill the N5–N1 vocab examples the exercises mine (sentence-level transformation data for Transform, homophones for PitchEar, declared lookalikes for LookalikeDuel).
3. **Review workflow** — round 1 (code review) is closed above; next is a browser pass on a GitHub Pages preview: SW install/update toast, PNG export of one wallpaper per size, ceremony animations, speech recognition opt-in; then a first-run walk Nihonbashi → Shinagawa gate on a phone.
4. **Store follow-ups** — `lastExportAt`, slot preference, Rapid Fire first-run day, per-kana latency, Perapera rolling windows; each is a `SLICE_KEYS` + migration + `backup.mergeSaves` change.
5. **Review follow-ups** — the cross-area requests and doc edits listed under Review → Deferred, then the kana `prod` scheduling gap.
