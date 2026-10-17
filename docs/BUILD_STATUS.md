# TSUZUKU — build status

Snapshot taken 2026-10-17 after the integration pass. Numbers come from a clean run of
`npm run typecheck`, `npm test` and `npm run build` at the repo root; re-run them to refresh.

## Health

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | clean (0 errors) |
| `vitest run` | 233 test files · 5555 tests passed · 1 skipped (see below) |
| `vite build` | succeeds · 329 modules transformed · 21 JS chunks + 11 CSS files |
| `dist/` | 8527 KB in all (assets 1377 KB, copied `content/` 7144 KB) · largest JS chunk 224 kB (`index-B5hpS7zQ`), well under the 1200 kB warning limit · SW, manifest and favicon copied |
| `node scripts/validate-content.ts` | **2 failures, 84 warnings in 127 files** (report only; the corpus is being written by another fleet) |

The single skipped test is deliberate: `src/app/pages.test.ts` skips "a route whose module is not
built yet rejects" because every route module now exists (`missing.length === 0`).

## Counts

| Area | Source modules | Test files | Notes |
|---|---|---|---|
| `src/app` | 13 | 14 | shell, router, theme, SW registration, 5 pages, boot test |
| `src/shared` | 19 | 16 | contract tier incl. `shared/ui` |
| `src/content` | 4 | 3 | types, loader, ruby, fixtures |
| `src/store` | 23 | 21 | persistence, XP, quests, streak, ledger, defs, backup, derived |
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
| **Total** | **262** | **233** | 5556 tests incl. 1 skipped |

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
- `public/content/stories/`, `stations/NN.json` and `manifest.json` do not exist yet (validator: "bundles absent"; V34 "no item carries a station yet"). Run `npm run content:all` once the corpus lands; until then the loader's `manifest()` 404s and the Dojo falls back to `derived.forecastCounts()`.
- `public/fonts/` is absent: `base.css` references four OFL `.woff2` subsets (DotGothic16, Yuji Syuku, Shippori Mincho B1, Dela Gothic One). The page degrades through `local()` + `font-display: swap`; Vite warns at build time. Binary font assets must be committed by the lead (needs source TTFs + `pyftsubset`).

Store / schema:
- Rapid Fire "first run of the day" lives in the xp reducer closure; a reload the same day lets a second run earn XP (no save field).
- Perapera monthly snapshot is performed by `startPerapera` on `day:rolled`, not inside `store/day.ts` (by design; wired in `main.tsx`).
- `SaveMeta.writings` has not landed; Writing Dojo keeps sentences under `作文: ` bookmarks, and `WallpaperData.writingSentences` is always empty.
- `gojuonMs` is mined from the review log, but arcade reps are not logged, so it is `{}` until a per-kana latency store exists.
- Perapera 読/耳/口/場 use lifetime ratios instead of the design's rolling windows (no persistent window data).
- No last-export timestamp: the weekly backup reminder is "Monday, ≥7 days, ≥1 session", not "a week since the last export".
- Save-slot switching is read-only until `boot()` persists a slot preference; the danger-zone reset leaves the review-log ring in place (rolls over naturally).

Sessions / exercises:
- Shugyō "Kage replaces Output on Mondays" is supported by the template but `buildPlan` leaves the block empty; the dedicated Kage mode is the scored path.
- Sentence-listen/shadow steps built from vocab examples carry no `storyId`; Transform params are "rewrite with the pattern" between two examples (no sentence-level transformation data in content); an empty accept list shows the missing-item message and relies on the frame's Guard.
- LookalikeDuel without `params.choices`/declared lookalikes has no distractor pool and falls back to shown-not-tested; ParticleDuel's step-less fallback only blanks particles; PitchEar's minimal-pair contrast needs the homophone in the loader's sync cache; ComponentAssembly shows a loading line until `content.components()` resolves.
- RapidFire's "Free play / First run today" note is inferred from a synchronous `xp:gained` and hidden when reducers are not started.
- Kage mode with no recent/mature cards shows the honest empty state; the Dojo's Kage strip renders from `feed.kage`, the hi-score table lives on `#/train/kage`.

Art / verification:
- `exportPng`'s real PNG encode cannot run under jsdom; the pipeline is covered with a recording `RasterEnv` and the SVG was checked in headless Chrome, but a real Blob export has not been exercised in a browser.
- Ceremony animations and the standalone dakuten glyph offset are verified structurally in jsdom only; the stamp text inside an `<img>`-loaded SVG uses the system mincho fallback until consumers route text through `exportPng`.
- `vite build` warns that `SessionView.tsx` is both statically (TrainPage) and dynamically (ScrollView) imported, so it is not split into its own chunk. Harmless at the current size.

Deferred cross-group requests (no emitter/consumer yet): `ceremony:flush`, `word:captured`, `AttemptResult.why`; `SLIP_PARTICLES` may alias `learn/PARTICLES` once `も` is added there; G's local restatements of `isUnlocked`/`WALLPAPER_BY_ID`/`BADGE_CATEGORIES` in `KakejikuGallery.tsx` and `art/dojo/room.ts` can now import from `@/store`.

## Next steps

1. **Content pass 2** — resolve V32, land `stories/` (137 graded stories and dialogues against each station's allowlist), run `npm run content:all` to produce `stations/NN.json` + `manifest.json`, then re-run the validator with `--strict` so V34 quotas are checked.
2. **Content pass 3** — clear the V22/V26/V33/V06 warnings, fill the N5–N1 vocab examples the exercises mine (sentence-level transformation data for Transform, homophones for PitchEar, declared lookalikes for LookalikeDuel).
3. **Review workflow** — a browser pass on a GitHub Pages preview: SW install/update toast, PNG export of one wallpaper per size, ceremony animations, speech recognition opt-in; then a first-run walk Nihonbashi → Shinagawa gate on a phone.
4. **Store follow-ups** — `lastExportAt`, slot preference, Rapid Fire first-run day, per-kana latency, Perapera rolling windows; each is a `SLICE_KEYS` + migration + `backup.mergeSaves` change.
5. **Fonts** — commit the four `.woff2` subsets to `public/fonts/`.
