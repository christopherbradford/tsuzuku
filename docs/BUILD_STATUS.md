# TSUZUKU — build status

Snapshot taken 2026-10-17 after the integration pass, the corpus commit (2bf5497) and review rounds 1 and 2 (census below). Numbers come from a clean run of
`npm run typecheck`, `npm test`, `npm run build` and `node scripts/validate-content.ts --strict` at the repo root; re-run them to refresh.

## Health

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | clean (0 errors) |
| `vitest run` | 254 test files · 6708 tests passed · 0 failures · 0 skipped (console noise only from tests that exercise error paths: `[dojo] feed failed`, `[persist] setItem(k) failed`, `[bus] subscriber … threw`) |
| `npm run build` (`tsc --noEmit && vite build`) | succeeds (built in 4.81 s) · largest chunk 213.61 kB (78.91 kB gzip), well under the 1200 kB warning limit · `dist/sw.js` stamped per build (`CACHE_VERSION` + `SHELL_ASSETS` placeholders replaced; `public/sw.js` keeps the placeholders) · 23 font slices, SW, manifest and favicon copied |
| `node scripts/validate-content.ts --strict` | **0 failures, 1,459 warnings in 189 files**; bundles present; linked 3,268 lines. The warnings are overwhelmingly W V18 writer-set `pitchConfidence: "high"` on vocab (1,266 items; policy open, see Known gaps); V32 / V33 / V26 / V06 are clear |

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
| **Total** | **262** | **254** | 6708 tests, 0 skipped (round-2 vitest census; per-area rows are from the integration pass and have grown since — `scripts/` now 4 `.ts` + fonts, `src/session` gained `bunsetsu.ts`, `context.ts`, `snapshot.ts`, `item-head.ts`, `TeachCard.tsx`, `src/input` `listening/set.ts` and `taiwa/Debrief.tsx`, `src/exercises` `voice.ts` and `grammar/head-word.ts`, `src/art` `studio.ts`, `src/app` `first-run.ts`) |

Registry: all 35 `DRILL_IDS` are registered at boot (D 26 from `src/exercises`, F 9 from `src/input`);
all 20 routes resolve to a page module; all 28 `WALLPAPER_IDS` have a generator.

## What each group delivered

- **A-shell** — `index.html` (manifest, apple-touch-icon, mobile-web-app meta), `App`/`ErrorBoundary`, `Layout` (nav, SW-update toast, weekly backup reminder), hash router, theme, `pages.ts` lazy route table + `ensureExercises()`, `sw-register.ts` (production-only, relative scope), `public/sw.js`, `manifest.webmanifest`, `.ics` export, `main.tsx` boot.
- **A-pages** — Dojo, Onboarding (Nihonbashi), Settings (incl. danger-zone reset), Backup (export/import/merge preview), About (version + load-error panel); `vite.config.ts` `VITE_APP_VERSION`.
- **B-core** — store: slots/shards/quota ladder, migrations, day roll, streak + flame/vacation, XP tables, quests, ledger, weak points, stats/honesty, backup merge, `testing.ts` doubles (`MemoryStorage`, `makeTestStore`, `captureEvents`).
- **B-defs** — 66 badge defs with machine-checked conditions, 28 wallpaper defs + quadrant reveal, `derived.ts` read-model: Perapera index + monthly snapshot (`startPerapera`), road projection / projected arrival, forecast counts.
- **C (contract)** — content schemas and the 53 stations, cached `./content/` loader with Cache API + redirects, ruby parser, in-memory fixtures (`createFakeLoader`); pipeline scripts (validator V01–V39, station assigner with POS floors and the story linker, index builder with a derived `contentVersion`).
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
- `validate-content --strict` exits 0 (0 failures). The 1,459 warnings are human-review items: 1,266 writer-set `pitchConfidence: "high"` (V18), the rest V14 / V22-class notes; V32 (`速やか`), V33 (proper nouns — now allowlisted), V26 (ある / 要る — now exempted) and V06 are clear. The corpus (6,350 vocab · 1,000 kanji · 450 grammar · 137 stories · 212 michikusa), all 53 `stations/NN.json`, the linked `tokenIds` and `manifest.json` landed in 2bf5497 and were regenerated by round 2b (`contentVersion` is now derived from the content).
- Pitch policy: the licensed post-pass has not run, yet 1,266 vocab items carry a writer-set `pitchConfidence: "high"` (CONTENT_GUIDE §8 says never); round 2 left them in place, so pitch cards, Pitch Ear and the pitch-five quest are live on unverified data. Decide: accept writer-set `high` (and retire the V18 warning) or run the post-pass and reset the rest to `low` (CONTENT_GUIDE §20).
- `public/fonts/` holds 23 OFL `.woff2` slices (was 24): `scripts/fonts/build-fonts.py` carries a UI glyph inventory (538 CJK ideographs scanned from `src/**/*.{ts,tsx,css}`, `index.html`, the manifest; tests, fixtures and `kanji-stars.ts` excluded — comments count, so a doc-comment kanji costs a `base` glyph) into every family's `base` slice and out of the level / `rest` slices, so the header, Road and Library render from `base` alone; the Yuji Syuku `rest` face (815 KB) is dropped by policy (`NO_REST_FAMILIES`) and non-corpus kanji in `--font-brush` fall back to the system mincho; 1.98 MB total (was 2.68 MB). `fonts.test.ts` scans the real tree, so a new UI kanji needs a regeneration (fonttools + the OFL TTFs, not in the repo). The SW keeps the slices in a stable `tsuzuku-fonts-v1` cache that `cleanOldCaches` never evicts.
- Quest gates: `store/quests.setQuestGates` / `revalidateQuests` exist but nothing in `src/session` calls `setQuestGates`, so `learn-scroll` (no Scroll left) and `michikusa-one` (fresh-fragment pool exhausted) can still be drawn when uncompletable; the Dojo feed should declare them closed. Stations 1–2 draw two Kata by construction (output strand starts at Station 3) — design 03 §6 records it; the Dojo quests header still reads "Three Kata" (`i18n` `dojoQuests`), an A copy follow-up.
- `OnboardingPage` estimates the road from a fixed `ROAD_DAYS` table (white 15 …) instead of `derived.onboardingEstimate` (session #10 skeptic remedy; design 02 §6.1 notes it).

Store / schema:
- Rapid Fire "first run of the day" lives in the xp reducer closure; a reload the same day lets a second run earn XP (no save field).
- Perapera monthly snapshot is performed by `startPerapera` on `day:rolled`, not inside `store/day.ts` (by design; wired in `main.tsx`).
- `SaveMeta.writings` has not landed; Writing Dojo keeps sentences under `作文: ` bookmarks (`shared/writing.ts` is the convention both tiers read) and `art/wallpapers/data.ts wallpaperData()` now gathers `writingSentences` from them and `dictatedSentence` from the profile (written by the Listening Arena's dictation path), so the Tanabata and Waveform pieces are live; the Writing Dojo closing line says "your wall scrolls can carry it" again.
- `gojuonMs` is mined from the review log, but arcade reps are not logged, so it is `{}` until a per-kana latency store exists.
- Perapera 読/耳/口/場 use lifetime ratios instead of the design's rolling windows (no persistent window data).
- No last-export timestamp: the weekly backup reminder is "Monday, ≥7 days, ≥1 session", not "a week since the last export".
- Save-slot switching is read-only until `boot()` persists a slot preference (Settings now says "One save slot for now"). The danger-zone reset delegates to `store.resetSave()` (header, slices, cards, log ring and session in one batch).
- `<key>.bak` stashes (meta, every card shard and, since round 2, the review log) count toward the 4.5 MB budget and are never pruned or surfaced — a 1.2 MB-char corrupt meta leaves the live save at `ceiling` permanently with the ladder re-running on every flush; a Backup-page line listing `.bak` keys / export prompt is a follow-up. A stash that itself hits the quota now frees the session key, retries once, then freezes the key (original left in place, level `ceiling`) instead of overwriting.
- Stored difficulty `d >= ~8` on once-lapsed cards is inflated by the pre-review FSRS-4.5 damping; with the FSRS-5 damping a card stuck at D≈10 gets ΔD·(10−D)/9 = 0 and grows stability ~6× slower than a D=5 card, so it never self-corrects; no migration ships (pre-release). A one-off migration lowering `d` on cards with `lapses >= 1` is optional.

Sessions / exercises:
- Shugyō "Kage replaces Output on Mondays": `blocks.templateFor` emits the `replacement: 'kage'` block when `kageDue`, but the builder has no fill path for it (no `replacement` handling in `builder.ts`); the dedicated Kage mode is the scored path.
- Sentence-listen/shadow steps built from vocab examples carry no `storyId`; Transform params are "rewrite with the pattern" between two examples (no sentence-level transformation data in content); an empty accept list shows the missing-item message and relies on the frame's Guard.
- LookalikeDuel without `params.choices`/declared lookalikes has no distractor pool and falls back to shown-not-tested; ParticleDuel's step-less fallback only blanks particles; PitchEar's minimal-pair contrast needs the homophone in the loader's sync cache; ComponentAssembly shows a loading line until `content.components()` resolves.
- RapidFire's "Free play / First run today" note is inferred from a synchronous `xp:gained` and hidden when reducers are not started.
- Kage mode with no recent/mature cards shows the honest empty state; the Dojo's Kage strip renders from `feed.kage`, the hi-score table lives on `#/train/kage`.
- Speed Read is not yet restricted to previously read episodes: `progress.storiesRead` is recorded by `stats.ts` and consumed by the Reader (`isStoryRead` drives the gloss-tap Hard path) and by the builder's story picker (unread first), but the builder never schedules `speed-read` (it is launched from the reader side), so the read-only gate has no planner to live in.
- `GoshuinBook.css` `.goshuin-book__tab` is a bare 36 px button (below the 44 px `--touch` that `.btn--sm` standardised); raising it and the grid's `minmax` is a one-line G follow-up.

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
- store #9 (store part) — `dueCount` counted never-reviewed cards: new `src/store/due.ts` `isDueReview` (state != 0, not archived/kaiden); `derived.dueCount()` uses it. (Superseded in round 2a, store #27: `CardsApi.dueOn` now applies the same predicate; `DueOptions.includeNew` opts state-0 cards back in.)
- learn — `fsrs.ts` `nextDifficulty` now applies the FSRS-5 linear damping `ΔD·(10−D)/9` before mean reversion (was the FSRS-4.5 form; D saturated at 10 after 1–2 Agains); `fsrs-golden.ts` regenerated (seed `mulberry32(0x5eed)`, 60 rows). Additive exports `learn/distractors.ts` `meaningKeys`/`sharesMeaning` and `learn/queue.ts` `findBlank`.
- session — `RunnerOptions.persist`, `RunnerSnapshot.activeMs`, `SessionResult.startedAt = endedAt - active`, `Progress.gateAttemptDay` now written, Nemesis block in Kumite/Shugyō, Particle Duel scheduling from Station 5, builder split into `params.ts` / `pickers.ts` (re-exported), `TeachCard.tsx` split out of `ScrollView`.

### Skipped after verification (12)

- store #1 — Layout/Settings "ceiling" copy + un-dismiss notice: UI copy lives in `src/app`; the notice already renders from `store.storage.value` now that the level is reported correctly (cross-area request). → Closed in round 2a (app #24: `storageCeiling` copy, notice un-dismisses at `ceiling`).
- store #9 — `forecastCounts` `newItems` gating / planned `estMs`; `dojoFeed` +5 gating: Skeptic said leave the `forecastCounts` fallback as-is (no plan context); `dojoFeed` is in `src/session` (cross-area request). → Closed in round 2a/2b (`dojo-feed.gateForecast` + `SCROLL_BLOCK_MINUTES`; DojoPage's fallback forecast takes the injected `gate`).
- store #7 parts F (StoryReader `firstRead`) and E (builder unread-first): `src/input` and `src/session` are other areas (cross-area requests). → Both closed in round 2a (F: `StoryReader.isStoryRead`; E: `params.pickStories` unread first).
- store #8 — OnboardingPage `finish()` station=1 and gatekeeper `n >= p.station`: `src/app/pages` and `src/session` are other areas; store-side clamp + boot lift shipped. → Both halves closed in round 2a (OnboardingPage writes `max(1, station)`; `finishGate` advances on `n >= p.station`).
- store #2/#12 — "mark shard read-only" part of the suggested fix: per both skeptics it would silently drop every new review in that level; the `.bak` stash alone was done.
- learn #5 — Kana `prod` cards created at intro but never scheduled: root cause and both fixes live outside `src/learn` (`session/scroll.ts` second immediate check for the prod facet; `store.cards.dueOn` skipping state-0 cards). The in-area alternatives contradict design 05 §2 and break `scheduler.test.ts` / `facetsFor`. → Closed in round 2a: `scroll.ts` emits the second immediate check (`scroll:<sid>:check:<itemId>#prod`) and `dueOn` skips state-0 cards; kana can reach Brown.
- input #6 — Missing test: Enter during IME composition must not submit (`KanaInput.test.tsx` / `ExerciseFrame.test.tsx`): both files live in `src/shared/ui` (contract tier); raised as a contract request.
- contract #11 — `nullAudio.canSpeak = signal(false)`: 43 test doubles spread `nullAudio` and 8 set `hasJaVoice: signal(true)` expecting to be audible; a false `canSpeak` would make `voiceAudible()` false for all of them. `canSpeak` stays optional and deliberately unset on `nullAudio`; documented in `audio.ts`, CHANGELOG and ARCHITECTURE §3.
- contract #9 — `KanaInput` `candidateReading` prop: optional; `TextAnswer` already gates `candidates` itself; no `shared/ui` change needed.
- contract #33 — shared `effectiveNewPerDay(settings, belt)` for `derived.ts`/`projection.ts`/RoadPage: cross-area (`store/derived.ts` cannot import `session/pickers`); the one-place rule should be hosted in `src/store/defaults.ts` next to `newPerDayFor` (cross-area request). → Closed in round 2a (store hosts it; `pickers.ts` re-exports it; RoadPage reads it).
- contract #34, #35 — requesters recorded no change needed.
- contract #39 — `scroll.test.ts` tsc error: baseline and final `tsc --noEmit` are clean for the whole repo; nothing to do.

### Deferred to the content pipeline / contract owner

The BUILD_STATUS items from this list (stale "1 skipped" wording; new Known-gaps lines for the pitch post-pass,
`.bak` stashes, Speed Read gating, kana `prod`, inflated FSRS difficulty) are applied in this file. Every doc edit below was applied by the round-2 scribe (design 01 §4.3, 07 §10, 06 §6, ARCHITECTURE §1, design 05 §1, the CHANGELOG lines); the optional migration and the cross-area requests are tracked in "Review round 2". As listed at the close of round 1:

- `docs/design/01` §4.3 token table: add `--kin-text` (#7A5A05 / #E0B341), `--shu-text` (#B0241F / #FF6A5E) and `--ink` (#1A1A1F, invariant) rows (app #19).
- `docs/design/07-architecture.md` §10: SW now serves `content/**` without caching (loader cache is the offline store); fonts in a stable cache; `CACHE_VERSION` stamped per build (app #2/#3/#16).
- `docs/design/06` §6: soften "五段 content pack" wording so the next content pass does not reintroduce it (app #9).
- `docs/ARCHITECTURE.md` §1: note that `derived.dueCount()` counts due reviews (`store/due.isDueReview`) while `CardsApi.dueOn` stays the raw primitive, and that re-initialising the store flushes the outgoing slot first.
- `docs/design/05-srs-and-pedagogy.md` §1: replace the D' line (FSRS-4.5 form) with the FSRS-5 update `ΔD = −w6·(g−3); D″ = D + ΔD·(10−D)/9; D' = w7·D0(4) + (1−w7)·D″`, clamped 1..10.
- `docs/CHANGELOG.md` (contract tier): `2026-10-17 · learn/fsrs.ts nextDifficulty` FSRS-5 damping entry + `fsrs-golden.ts` regeneration; additive exports `learn/distractors.ts` `meaningKeys`/`sharesMeaning`, `learn/queue.ts` `findBlank`.
- `docs/CHANGELOG.md`: entries for `RunnerOptions.persist`, `RunnerSnapshot.activeMs`, `SessionResult.startedAt`, `Progress.gateAttemptDay`, Nemesis block in Kumite/Shugyō, Particle Duel from Station 5, builder split (`params.ts` / `pickers.ts`), `TeachCard.tsx` split out of `ScrollView`.
- Optional: a one-off migration lowering inflated stored difficulties on cards with `lapses >= 1` (acceptable to leave for a pre-release build).
- Cross-area requests filed during the review (store → app/session/input; learn → session/store; input → shared/ui; contract → store `defaults.ts`) await their owners' next pass.

## Review round 2 (2026-10-17)

Two halves, same day, both census-clean at the end (`tsc --noEmit` 0 errors; `vitest run` 254 files / 6708 tests; `npm run build` 4.81 s; `validate-content --strict` 0 failures). Round 2a: the owners' pass on round-1 cross-area requests, six code lenses (deploy-shell, store, exercises, security-privacy, copy-i18n, mobile-a11y), per-area fixers, a contract pass, then a leftovers pass (owners closing 2a's cross-area requests, the `autoFocus` lint rule, the font slices regenerated with the UI glyph inventory). Round 2b: seven lenses over the shipped corpus and the session flow (pedagogy, session-flow, input, ja-vocab, ja-kanji-grammar, ja-stories, loader-vs-corpus), per-area fixers (scripts, learn, store, session, input, content), 18 content-polish agents and this scribe pass. No `_review2_` / `_skeptic2_` scratch remains in the tree; nothing was committed by the review itself (round 2a's work is in 10338df / e2d4682; round 2b is the working tree).

### Requests honoured (round 2a — the round-1 cross-area requests)

- session — `gateAttemptAt` written on a loss / cleared on a pass (`rematchAllowed` survives a reload); gate advance `n >= p.station ? n + 1 : p.station`; `RunnerSnapshot = SessionSnapshot`; form-forge / form-chain carry `kana`; Leave dialog on `useDialogFocus` with an early-capture Escape; `danShares` filled from `STRAND_SHARES.dan`; redundant `.session__leave` min-height dropped; EndCard regression test for state-0 / archived cards; `dojo-feed.gateForecast` + `SCROLL_BLOCK_MINUTES`; `pickStories` unread first; `scroll.ts` second immediate check per born facet (kana prod → kana-ear); nemesis duel blanks with `findBlank`.
- app — drill routes drop the duplicated `--safe-bottom`; OnboardingPage `station = max(1, station)`; ceiling copy "progress may not be saving" + notice un-dismiss; `isFirstRun` in `src/app/first-run.ts` with a non-string guard.
- store — `effectiveNewPerDay` hosted in `store/defaults.ts`; `cards.dueOn` skips state-0 cards (`DueOptions.includeNew`); `stats.ts` consumes `Math.round(tally.minutes)`.
- exercises — ProductionForge re-locates a broken blank with `findBlank`; MeaningGuard `correctChoice` tiers; SentenceListen frame-Enter finalizes the IME; six D text fallbacks gate on `voiceAudible`.
- input — StoryReader `isStoryRead` / `firstRead` from `progress.storiesRead`; `tts.test.ts` short-collocation assertions.
- art — boot barrel split (`art/index.ts` vs `art/studio.ts`); `yojijukugoEmpty` no longer says "五段 content pack"; `fourKGated` describes `canRender4k`; Studio custom sentence capped at 48 glyphs.
- contract — the IME-composition regression tests were already in place (round 1); `effectiveNewPerDay` and `findBlank` already on the barrels; no contract change needed.
- Leftovers pass (owners) — app: OnboardingPage uses the shared `NAME_MAX_GLYPHS` / `clampGlyphs` and `KanaInput maxLength`, stamps `profile.onboardedAt`; SettingsPage reset delegates to `store.resetSave()`; BackupPage refuses files over `IMPORT_MAX_BYTES` by size; DojoPage's fallback forecast takes the injected `gateForecast`; `LICENSE` + `CONTENT_LICENSE.md` + `package.json` `license` added. session: `pickers.effectiveNewPerDay` is the store's rule; RoadPage reads it; `params` sends `pos` + `accepts`; `use-auto-focus.ts` re-exports the shared hook; `gatekeeper.grudgeKeys()` isCardKey guard; `session/snapshot.ts` validates a snapshot before resume. exercises: `grammar/head-word.ts` (pos from the step, unique-fit inference, accepts rows graded); `?` / Hint registered in 17 drills; RapidFire / NemesisDossier on `useAutoFocus`. art: `normalizeData` clamps names and sentences (`SENTENCE_MAX_GLYPHS = 96`), `wallpaperData` gathers `作文: ` bookmarks and `dictatedSentence`, `fitSize` floors removed on learner-name callers, onsen columns, waveform footer, `canvasViolations`, hostile-string escaping test. input: WritingDojo imports / re-exports `shared/writing.ts`, `writingKept` copy restored, textarea on `useAutoFocus`. fonts: `build-fonts.py` UI inventory + `NO_REST_FAMILIES`, 23 slices regenerated, `fonts.test.ts` scans the shell sources. lint: rule 5 (no `autoFocus` on intrinsic elements) in `src/i18n/lint.test.ts`.

### Content polish (round 2b, 18 agents)

Grammar N5 (90 points, 4 files) audited against `CONJ_FORMS`: 17 points already declared the right `unlocksForms`; added g-n5-047 〜てください → `["te"]`, g-n5-087 〜なら → `["adj-ba"]` (19 / 90 declare); points that only apply an introduced form and forms with no `CONJ_FORMS` id left undeclared; V22 register clean (0 warnings). Grammar N4 (90 points, 3 files): 7 points already right; added g-n4-002 〜ている → `["te-iru"]`, g-n4-022 adversity passive → `["passive"]`, g-n4-049 〜くする / 〜にする → `["adj-adv"]`, g-n4-053 honorific れる/られる → `["passive"]` (11 / 90); three polite points had one casual example each (g-n4-082 / 083 / 090) rewritten polite. Further agents touched `conjugation/conjugation-003.json`, grammar N2 (002, 003) and N3 (001–004), `kanji/n3/kanji-n3-001.json`, 11 michikusa files (s02, s10, s11, s19, s20, s27–s29, s31, s36, s46 — V39 duplicate cards), 33 story files (s02, s06–s09, s12, s17, s20, s24, s25, s27, s29–s37, s39–s43, s46–s52 — ruby / kana / token fixes such as s-12-2 {何|なん}の, s-12-1 「でも、気持ちは強い。」, a ruby group straddling a token in s09), and 37 vocab files (N1 001–010, N2 004 / 007, N3 001 / 004 / 007–012, N4 001–005, N5 001–006 — pos vs ending (V37), glosses, readings); `stations/06–09` and `32–53` plus `manifest.json` were regenerated by `content:all` (POS floors at Stations 6–9; Black stations now span two vocab files each). Files rewritten with `JSON.stringify(obj, null, 1)` show whitespace-only diffs (`git diff -w` shows the real edits). Pitch: the 1,266 writer-set `high` values were left in place (policy open).

### Findings by lens

Round 2a (confirmed / refuted): deploy-shell 4 / 2 · store 7 / 3 · exercises 11 / 2 · security-privacy 5 / 1 · copy-i18n 10 / 2 · mobile-a11y 11 / 0 — 48 confirmed, 10 refuted. Refuted and why: the deploy workflow's missing `content:assign` (an authoring step by design; the corpus was simply uncommitted), bare `#/collections` → Dojo (documented fallback), the per-origin storage meter (the quota is per origin), the gzip flush "needs a macrotask" (Node zlib artefact, browsers resolve within the microtask checkpoint — reproduced in Chrome over CDP), the pre-`speedGrading` Zen save (no such save exists), Pitch Ear's `data-correct-index` (local-first app, test hook), Kana Flash's target chip on untimed mature cards (design 04 §1), the CSP proposal (nothing to mitigate), the Welcome Back copy (two of three strings are dead), 形 vs 型 (both correct in context).
Round 2b: 68 confirmed, 6 refuted across pedagogy, session-flow, input, ja-vocab, ja-kanji-grammar, ja-stories and loader-vs-corpus (the per-lens notes are in the round-2b scratch, not reproduced here).

### Fixed (round 2a — 58 findings, one line each)

- app #1 [major] — `sw.js` precaches the build's `assets/**` at install via a second stamped placeholder (`SHELL_ASSETS`); `cacheFirst()` answers 504 offline instead of rejecting.
- app #2 [major] — Yuji Syuku `rest` face dropped from `fonts.css` (completed by the fonts pass: UI glyph inventory in `base`).
- app #3 [minor] — `theme-color` seeds the light `--bg` (#F4EDE0) in `index.html` and the manifest; `theme.ts` flips it for dark users.
- app #4 [minor] — danger-zone reset replaces the header (new seed / createdAt / contentVersion) and clears the log ring.
- app #5 [minor] — `BackupPage.apply()` try/catch: a throw shows `bakInvalid` and returns the page to idle.
- app #6 [minor] — learner name capped at 24 code points at entry.
- app #7 [minor] — `dojoArcadeHint` reworded (nothing is marked Again; a miss comes back untimed).
- app #8 [major] — desktop nav strip renders between the notices and `<main>`, under the header.
- app #9 [major] — Settings Confirm dialog on `useDialogFocus` (Cancel first, Escape, Tab trap, opener refocused).
- app #10 [minor] — Dojo session-card text without opacity (contrast ≥ 4.5:1).
- app #11 [minor] — `.about__dl` stacks by default, two columns from 560 px.
- app #12 [minor] — Layout level chip named by visually hidden text, no `aria-label` on a generic span.
- store #1 [major] — merge into a fresh browser takes the backup's identity (`hasNoLearnerTrace`); `ImportSummary.name`.
- store #2 [major] — `.bak` stash failure is loud and safe: free the session key, compress, retry once, then `persist.freeze(key)`.
- store #3 [minor] — `fillMeta` validates enums, array elements and record values (`ELEMENT_GUARDS`, `RECORD_GUARDS`, `checkSettings`).
- store #4 [minor] — `applyImport` runs in one signals batch (one effect run per import).
- store #5 [minor] — replace-import clears the old in-progress session snapshot.
- store #6 [minor] — an unreadable review log is stashed as `.bak` like meta and shards.
- store #7 [major] — header caps: seed ≤ 64, chosenKanji one glyph, dictatedSentence ≤ 500, onboardedAt finite; `mergeLedger` never throws on garbage.
- store #8 [minor] — `IMPORT_MAX_BYTES` (32 MB) refused before reading; gzip bombs stop at the limit (`InflateLimitError` → `importTooLarge`).
- learn #1 [major] — `kanaGrid` never seats a homophone of the target (`soundsLike`: same romaji, ぢ≡じ / づ≡ず, を≡お / ヲ≡オ), pool and gojūon padding alike.
- session #1 [major] — `splitBunsetsu` cuts after a particle only when the next character is not hiragana; `COMPOUND_PARTICLES` gains のは / のが / のを / からは / までは.
- session #2 [major] — slow→Hard only with a visible ring (`ringShown`); SessionView draws the soft ring for untimed mature steps.
- session #3 [major] — Form Chain is always 5 links (`formChain`: own forms, met points' forms, `applicableForms`).
- session #4 [minor] — Minimal Pair draws the spoken side with the rng.
- session #5 [minor] — session aria-labels are English only.
- session #6 [minor] — Scroll heading shows the ordinal (`巻物 Scroll 2`) or "Captured words".
- session #7 [minor] — `examFurigana`: furigana off from the Orange Shinsa; Yellow intro copy says it stays on.
- session #8 [major] — Road page no longer scrolls on mount; "Go to your station" button.
- session #9 [minor] — Judge card takes focus on open and returns it to the exercise after the pick.
- session #10 [minor] — Begin / Resume / Continue focus through `useAutoFocus`.
- exercises #1 [major] — Scramble: interior 、 never becomes a bank piece.
- exercises #2 [major] — Kana Forge shows `wo` up front for を / ヲ at no hint cost.
- exercises #3 [major] — Form Forge / Form Chain read `params.kana` on grammar prod cards.
- exercises #4 [minor] — Form Chain without a head word infers the pos (`inferHeadWord`) and accepts the engine's alternates.
- exercises #5 [minor] — Gojūon Fighter accepts the display romaji (`isDisplayRomaji`).
- exercises #6 [blocker] — `voiceAudible` reached through `src/exercises/voice.ts`; the import lint is green.
- input #1 [minor] — Writing Dojo closing line made truthful (later restored once the art tier wired `writingSentences`).
- input #2 [minor] — Reader gloss sheet on `useDialogFocus` (Tab trap, focus back to the tapped token).
- art #1 [minor] — `png.download()` one anchor click everywhere, object URL revoked after a delay.
- art #2 [minor] — Library item detail shows facet labels, pitch glyph 高.
- art #3 [minor] — ceremony copy glosses Mon / Kakejiku on first contact.
- art #4 [minor] — Library item detail modal on `useDialogFocus`.
- records #1 [minor] — Records next-step line narrates a Kata to take, with a singular form.
- contract #1 — `KanaInput.maxLength` (IME path, no native attribute).
- contract #2 — ExerciseFrame progress / combo spans: visually hidden "Step i of n", no `aria-label`.
- contract #3 — `NAME_MAX_GLYPHS = 24` + `clampGlyphs`.
- contract #4 — `store.resetSave()`.
- contract #5 — ring on `timer` alone; `step.timed` only hardens expiry.
- contract #6/#33 — `PauseOverlay` on `useDialogFocus`; frame `inert` + `aria-hidden` while paused.
- contract #7 — shared `useAutoFocus`.
- contract #8 — `JudgeCard` focuses itself on mount.
- contract #9 — `voiceAudible` in `shared/audio.ts`.
- contract #10 — `StepParams.pos` / `accepts`.
- contract #11 — `shared/writing.ts`.
- contract #13 — atomic `applyImport`; `migrateShard` refuses an unknown level.
- contract #14 — `fillMeta` truncates name / nameKana to `NAME_MAX_GLYPHS`.
- contract #32 — the frame's `?` / Hint button call the drill's registered `onHint` and are hidden otherwise.

### Fixed (round 2b — 76 in the fixers' ledgers; the 43 code and pipeline fixes one line each, the content fixes summarised)

- scripts (request) 1 — `build-content-index`: `contentVersion` derived from the content (`c-` + 10 hex of sha256 over sorted `(path, sha256(bytes))` of every `public/content/**/*.json` except `manifest.json`); `--version` / `CONTENT_VERSION` remain overrides; header, CLI usage, README and CHANGELOG document it; V35 flags a stale derived version.
- scripts (request) 2 — V30 performance: Latin denylist terms compiled into 8 case-insensitive, letter-boundary-aware alternation regexes (longest first, 250 terms each), other terms into a first-code-unit bucket scan; identical results to the per-term matcher (equivalence test over every fixture string + 50 probes). V36: match pool cached per station, `unresolvedSpans` uses a first-char surface index. Full corpus: user 66.98 s → 2.40 s (strict 2.49 s), real 264.99 s → 7.11 s.
- scripts (request) 3 — V37 pos-vs-ending (W): v1 whose kana lacks an ichidan ending or whose word ends in する/くる, v5 whose word is a known ichidan verb; the golden table is ground truth where the head word appears; message names the suggested pos. V38 (W): repeated kanji component, list kept as written. Both in CONTENT_GUIDE's rule table (V39 duplicated michikusa card added by the ja-stories fixer the same way).
- scripts (request) 4a — V20 W when `vocabIds` covers < 60 % of the allowlisted vocab the linker detects (`VOCAB_IDS_MIN_COVERAGE`); fires in strict mode too, never fails.
- scripts (request) 4b — V33 proper-noun allowlist (weekdays, months, nationality / language adjectives, festivals, religions and deities, places, titles, 2–4-letter acronyms): the 71 corpus warnings drop to 0.
- scripts (request) 4c — V26 `DEFECTIVE_VERB_FORMS` exemptions (ある, 要る, できる / 出来る, 分かる / わかる, 見える, 聞こえる): both corpus warnings gone; real gaps on regular verbs still reported.
- scripts (request) 5 — `MAX_FILE_BYTES` stays 300 KiB (307,200 bytes); header names the constant and exact bytes; test asserts both.
- scripts (request) 6 — `npx vitest run scripts src/content`: 209 / 209; `tsc` clean; no new dependencies.
- input (request) — hint key (contract #32, input half): Shadow registers `onHint: hidden ? reveal : undefined` ("Show the text").
- input (request) — hint key: SayThreeWays registers `onHint: model && !showModel && !done ? revealModel : undefined` ("Show one model").
- input (request) — hint key: StoryReader exercise-step wrapper passes `frameHint`; the view registers `onHint: canRevealEn ? showEnglish : undefined`; the FIRST English reveal in the step counts as one hint, later toggles are free; standalone readers unchanged.
- input (request) — hint key: RolePlay (type / speak, learner phase, hint untaken) registers `onHint: useHint`; `useHint` also reports `ExerciseProps.onHint` (new optional `PlayProps.onHint`).
- input (request) — dictated sentence: `ListeningArena.submitDictation` writes `profile.dictatedSentence = toPlain(line.ja)` on a Good-band line (rating 3) at rate ≥ `DICTATED_MIN_RATE` (1×); plain surface, newest wins.
- store #1 (store part) — uncompletable Kata can be gated out of the draw: `PickOptions.canDo` / fourth `eligibleQuests` parameter; day-keyed gates `setQuestGates(day, closed)`, `questClosed(id, day)`, `resetQuestGatesForTests()`; `pickDailyQuests` skips a closed quest unless done today; `revalidateQuests(store)` exported and called on `session:started`; shuffle order fixed per (seed, day) so the other quests keep their place.
- learn #1 [minor] — `conjugate.ts` defective table keyed by the written head word, so the regular godan 炒る (いる, v5) keeps all 20 forms.
- learn #2 [major] — stative 分かる / 見える / 聞こえる / できる no longer get invented potential / imperative / passive forms (`null`).
- learn #3 [major] — one-kanji サ変 verbs (愛する, 達する, 罰する …) take the potential 〜せる (alt 〜し得る), never 〜できる.
- learn #4 [minor] — 出来る accepted for する potentials; `conjugate.test.ts` asserts golden-table alts ⊆ engine accepted surfaces.
- session #1 — Input block / Kumite role-play / Dojo episode now materialise mid-station (readable episodes, shared White allowlist at Stations 1–3).
- session #11 — early-station episodes pass the live coverage gate (`plusOne` tokens count as covered; `PlanContext.allowlist` = the White allowlist at Stations 1–3).
- session #2 — same-day Gatekeeper rematch reachable: the day's Kata / Kumite / Shugyō opens with a Grudge List block (`grudgeBlockSteps`, ≤ 20 reps).
- session #3 — pre-roll counts the +3 / +10 steps new cards owe (`plannedReps`).
- session #9 — forecast and pre-roll minutes include re-queues and ~15 s per teach card (`plannedMs`, `TEACH_CARD_MS`).
- session #4 — End card names promoted items (`itemHead(loader.get(id))`) instead of raw ids.
- session #5 — Dojo forecast pairs the day's due count and the Shugyō's Scroll count with the Shugyō minutes (one basis).
- session #6 — a card missed `MAX_SESSION_MISSES` (3) times in one run stops being re-queued; the feedback line says so.
- session #7 — Strike never hard-times a chunk's self-graded shadow rep (`SELF_GRADED`).
- session #8 — Ear phase dictates only story lines whose resolved tokens the learner knows, topped up with the station's own words (`stationSentences`).
- session #12 / #15 — Form Forge / Form Chain draw the head word from items that realise a declared form (adjective-only points drillable; ある never lands on たい).
- session #13 — Kanji Read matches the example vocab by surface and reading and blanks the first ruby-aligned occurrence (`alignedOccurrence`), never inside a compound.
- session #14 — Scramble is skipped when a sentence has one movable tile (`movableTiles`; も, bunsetsu starters, re-route).
- input #1 — Taiwa register target is the in-force `registerTarget`, not the dialogue's majority register (`registerAcceptable`; per-line `Turn.lineRegister` for chips / options).
- input #2 — `detectRegister` no longer marks natural polite / casual lines `mixed` (fragments, vocatives, trailing connectives, soft set phrases, ellipsis folding).
- input #3 — aizuchi chips and slot scoring follow the in-force `registerTarget`.
- input #4 — RolePlay no-voice fallback (`voiceAudible` false): partner lines shown as text behind a Continue button (Enter), nothing advances on its own, the no-voice notice is shown and an aizuchi slot opens only after the learner continues past the marked line.
- input #5 — choose-mode options and Build tiles render kanji with furigana (`withLineRuby` + `<Ruby mode={furigana}>`).
- input #6 — comprehension choice `aria-label`s use `toPlain` (no raw ruby markup).
- scripts #1 — N1 vocab files no longer interleave across every Black station: `orderRankedVocab` orders files by median `frequencyRank` and sorts by rank within a file (every Black station spans exactly 2 files); `build-content-index` warns when a station entry exceeds the 1 MiB budget.
- scripts #2 — the linker's one-kanji stem rule (`stemApplies`) claims a token only before okurigana or at token end, so 有名 no longer links to ある; stems of 2+ chars keep matching compounds; V36 segmentation uses the same rule.
- scripts #3 — V36 "definition contains the target" fires for 〜-marked affixes / counters (`definitionContainsTarget` compares bare surfaces; a one-character target counts only when its ruby reads as the target).
- content stories-s12 #2 [major] — s-12-2 L1 {何|なに}の → {何|なん}の, kana なにのさかな → なんのさかな.
- content stories-s12 #3 [minor] — s-12-1 L16 「気持ちは多い」 → 「でも、{気持|きも}ちは{強|つよ}い。」, tokens / tokenIds / vocabIds relinked (v-n5-0380 added).
- content stories-s09 #1 [major] — ruby group straddling a token fixed.
- content — the remaining polish fixes are summarised under "Content polish" above (grammar unlocksForms, register, V37 pos corrections, V39 michikusa duplicates, story ruby / kana / token repairs, vocab glosses and readings), with the regenerated bundles and manifest.

### Skipped after verification (round 2a + 2b)

- scripts — `.github/workflows/deploy.yml`: no change needed; CI runs `content:index` with no `--version`, so it derives the version; order validate → index → test → build is already correct.
- input — hint key for Comprehension, SpeedRead, FieldMission, Monologue, WritingDojo, ListeningArena: nothing to reveal, so per the request they register nothing.
- input — writing `dictatedSentence` on a `line:scored {kind:'dictation'}` emit: ListeningArena never emits `line:scored` (the only `kind:'dictation'` emitter is `exercises/listening/SentenceListen.tsx`); the write sits in the arena's actual dictation path instead.
- store — White-belt count (only two Kata at Stations 1–2): needs a contract / doc change, not a store change (`outside-twenty.fromStation` lowered to 1 by the contract owner; design 03 §6 now records two Kata at Stations 1–2).
- store — michikusa re-read counting (`michikusa:read` on an already-collected fragment): emitter is `session/MichikusaStep.tsx`, payload would need an `again` flag, and design 04 §10 says a re-shown fragment emits nothing; the store-side gate makes the quest disappear instead — wiring is the open session request.
- session #10 — dead days between the last Scroll and gate readiness / `ROAD_DAYS.white = 15`: the remedy is in `src/app` (OnboardingPage should consume `onboardingEstimate`) and design 02 §6.1; `pickers.ts` and the gate deliberately unchanged (Known gaps).
- session #2 — interim copy "The gate opens again tomorrow": not needed, the Grudge block makes the 20 reps reachable the same day.
- input #4 — racing `speak()` against `estimateMs()`: not a real path; the instant-resolve cases are exactly what `voiceAudible()` gates.
- input #1/#2 — a V22 / V27 warning when a learner gold line contradicts the in-force register: `scripts/` and the corpus are outside the input area; listed with the surviving line ids as a cross-area request.
- scripts — `builder.ts` comment "≤ 400 KB" → "≤ 1 MB raw" (`src/session/builder.ts:247`): outside the scripts area and being edited concurrently; cross-area request.
- 2a — GoshuinBook.css min-heights (verified not redundant, kept); form-chain per-form kana (no `StepParams` slot; drills conjugate each link themselves); store coordination for `dueOn` (not needed); pages setting a richer `document.title` (informational); `nullAudio.canSpeak = signal(false)` (would silence 43 doubles; contract owner's decision stands); ESLint `autoFocus` rule (no ESLint — became lint rule 5 in `lint.test.ts`); fonts pipeline from the contract fixer (done by the fonts pass); duplicate #33 entry.

### Docs reconciled by the scribe

`docs/CHANGELOG.md` (round-1 deferred contract lines verified and added: FSRS-5 damping + golden regeneration, `meaningKeys` / `sharesMeaning`, `findBlank`, `RunnerOptions.persist`, `RunnerSnapshot` alias, `SessionResult.startedAt`, `gateAttemptDay` / `At`, Nemesis block, Particle Duel from Station 5, builder split, `TeachCard`; round-2 session / exercises / input / store / learn / art / scripts lines; the claim that the validator imports `learn/conjugate.ts` corrected — it keeps its own `DEFECTIVE_VERB_FORMS`), `docs/ARCHITECTURE.md` (§0 no `prebuild`, art barrels, DojoPage `gate`; §1 `dueOn` semantics, `effectiveNewPerDay`, quest gates, re-init flush, `.bak` + freeze, import ceiling, merge identity, `onboardedAt`, `resetSave`; §3 `sttFailure`, `exercises/voice.ts`, derived `contentVersion`; §4 hint sites; §5 Scroll second check, snapshot validation, `pos` / `accepts`, `MAX_SESSION_MISSES`, Grudge block; §8 lint rules), `docs/CONTRACT_NOTES.md` (`applicableFormsFor` counts + `defectiveFormsFor`; round-2 section), `docs/CONTENT_GUIDE.md` (V26 rephrased to the validator's table + the engine rules, `unlocksForms` expectations, §20 `contentVersion` derivation and the pitch policy as shipped), `docs/design/01` §4.3 (`--kin-text` / `--shu-text` / `--ink`) + §4.4 (Road Nav), `02` §6.1 (onboarding estimate note), `03` §1 / §2 / §3 / §6, `04` §1 / §2 / §3 / §4 / §7 / §11 / §12, `05` §1 (FSRS-5 D' line, golden provenance), `06` §3 (4K gate, sentence caps) / §6 (五段 wording), `07` §3 / §4 / §5 / §6 / §8 / §10 / §11, `docs/module-plan.json` (V01–V39; `art/index.ts` boot-only + `art/studio.ts` entry), `README.md` (pipeline, repository map, fonts, licences). V01–V36 / V38 ranges everywhere → V01–V39.

## Next steps

1. **Pitch policy** — decide between accepting the 1,266 writer-set `pitchConfidence: "high"` (retire the V18 warning, document it in CONTENT_GUIDE §8) and running the licensed post-pass (reset the rest to `low`); the pitch drills are live either way.
2. **Quest gates wiring (E)** — call `setQuestGates(today, closed)` from the Dojo feed / session start for `learn-scroll` (no Scroll left) and `michikusa-one` (fresh-fragment pool exhausted), then let `revalidateQuests` re-draw; A: the Dojo quests header should name the count (two Kata at Stations 1–2).
3. **Browser pass on a GitHub Pages preview** — first push after `npm run content:all` output is committed: SW install → offline reload → update toast; PNG export of one wallpaper per size on a real device; ceremony animations; speech recognition opt-in; then a first-run walk Nihonbashi → Shinagawa gate on a phone (390 px).
4. **Onboarding estimate** — `OnboardingPage.roadMonths` / `ROAD_DAYS` should consume `derived.onboardingEstimate` (one basis with the Records projection).
5. **Store follow-ups** — `lastExportAt`, slot preference, Rapid Fire first-run day, per-kana latency, Perapera rolling windows, `.bak` listing on the Backup page, the optional difficulty migration; each a `SLICE_KEYS` + migration + `backup.mergeSaves` change.
6. **Content pass 3 leftovers** — V14 "≥ 2 examples" and V22 register notes still reported in strict mode; sentence-level transformation data for Transform, homophones for Pitch Ear, declared lookalikes for Lookalike Duel; the Kage-on-Mondays block fill and Speed Read's read-only gate when the planner schedules it.
