# TSUZUKU - ARCHITECTURE: shared contracts (v1)

`docs/design/01-07` are the spec; on conflict **this file wins** (ids are hyphen-form `v-n5-0001`, card keys `v-n5-0001#prod`). Pseudo-TS: `s n b` = string number boolean; type-only cycles between contract files are fine.

## 0. Tiers and the import rule
- **Contract tier** (frozen day 0; changes need lead sign-off + a CHANGELOG line): `src/shared/**` (incl. `catalog.ts`: BADGE_IDS (66), WALLPAPER_IDS (28), QUEST_IDS (17), MISSIONS, ShinsaSection; and `shared/ui/{Ruby,KanaInput,ExerciseFrame,Feedback,JudgeCard}.tsx`, owned by D), `src/content/{types,loader,ruby}.ts`, `src/content/fixtures/**`, `src/store/{index,derived,testing}.ts`, `src/learn/{index,apply}.ts` (`index` pure; `apply` = the impure writer, imported as `@/learn/apply`).
- **Day 0:** the lead authors every `[CONTRACT]` file from the pseudo-TS in this document and commits them before the groups fork (they are fully specified here; no group waits on another group's contract). B ships `makeTestStore` on day 1 as an in-memory store with no reducers wired, so every group's tests run from day 1. `src/store/index.ts` re-exports only B-internal modules; the derived read-model that needs `@/learn` (`selectors`, `perapera`, `projection`) lives in `src/store/derived.ts`, which UI imports directly.
- Any module may import the contract tier; everything else imports **only inside its own group folder**. Exception: A's `src/app/pages.ts` + `src/main.tsx` import other groups' barrels to wire routes, exercises and services. All other cross-group behaviour flows through the bus, the exercise registry, the audio slot and the store.
- **Content pipeline scripts** (`scripts/{validate-content,assign-stations,build-content-index,writer-packet}.ts`, owner C, `[P1]`) run under `node --experimental-strip-types` so they import `src/content/types.ts` and `src/content/ruby.ts` directly (no duplicated regexes). `npm run build` is preceded by `prebuild = content:validate && content:index`, so `manifest.json` and `stations/NN.json` always exist in `dist/`.

## 1. Store (`src/shared/store-types.ts`; API `src/store/index.ts`, B)
Slices = design 07 S3, plus: `Profile.kanaKnown`, `Settings.{ttsVoiceURI2?,verticalText,speedGrading:b}` (`speedGrading` = "speed affects grading", default **off** in Zen, on otherwise; `speaking` defaults to `'self'` until the learner opts into recognition after the network notice, 06 §7 #10; `maxReviews` is the White–Orange base cap, scaled by belt in `learn/governors.ts`), `Streak.lastRepairDay?`, `Progress.{awayDays,welcomeBackDue,shinsaNotes.belt}`, `KageState.beatenWeek?`, `WeakPoints[tag].peak`, `Ledger.missions:{day;tier;conversation}[]`, `medianMs` keyed by `DrillId`, `stats` keys = `STAT_KEYS` (incl. `kanjiBrown`, `vocabBrown`, `katakanaBrown`, `grammarBrown`, `reviews` (arcade reps excluded), `bestCombo` (arcade excluded), `rapidBest`, `gojuonBest`).
```ts
type EpochDay = n;      // 04:00 boundary (shared/time.ts)
type Rating = 1|2|3|4;  // Again..Easy
type ItemKind = 'kana'|'vocab'|'kanji'|'grammar'|'component'|'chunk';   // chunk = set-phrase|aizuchi VocabItem
type ItemBelt = 'white'|'yellow'|'green'|'brown'|'black';
type CardTuple = [due:EpochDay,s:n,d:n,reps:n,lapses:n,state:0|1|2|3,last:EpochDay,flags:n]; // flags 1 archived 2 nemesis 4 kaiden 8 step-pending
type LogEntry = [t:n,cardKey:CardKey,rating:Rating,ms:n,exerciseIdx:n,tagsMask:n];   // ring 5000
export const store: {
  ready:Signal<b>; /* Signal<SaveMeta[K]> each: */ profile; settings; streak; progress; quests; collections; kage; weakPoints; ledger; stats; medianMs; captured; bookmarks; perapera; daily;
  meta():SaveMeta; seed():s; now():n; today():EpochDay;
  patch<K extends keyof SaveMeta>(k:K, fn:(prev:SaveMeta[K])=>SaveMeta[K]):void;   // immutable update -> signal -> persist
  cards:{ get(k):CardTuple|undefined; set(k,t); delete(k); byItem(itemId):Partial<Record<Facet,CardTuple>>; dueOn(day):CardKey[]; forEach(fn); count():n; version:Signal<n> };
  log:{ push(e:LogEntry); recent(n):LogEntry[]; forCard(k):LogEntry[] };  session:{ load():SessionSnapshot|null; save(s:SessionSnapshot); clear() };   // opaque to B
  storage:Signal<{bytes:n;level:'ok'|'warn'|'ceiling'}>; flush():Promise<void>;
};
export function initStore(o?:{slot?:n; now?:()=>n; storage?:Storage}):Promise<void>;
```
Keys `tsuzuku.meta.v1[.slot]`, `tsuzuku.cards.v1.<kind>.<level>[.slot]` (`CardShard` carries `kind` **and** `level` from day 0: `vocab.n5 … vocab.n1`, `kanji.n5 … kanji.n2`, `grammar.n5 … n1`, `kana.kana`, `misc.kana` for components/chunks; a review rewrites ≤ 450 KB), `tsuzuku.log.v1[.slot]`, `tsuzuku.session.v1[.slot]`; debounce 1 s/shard, flush on `visibilitychange|pagehide`. **Bytes are UTF-16:** `bytes(str) = str.length * 2`; warn **3.5 MB**, ceiling **4.5 MB** of the 5 MB quota (ceiling = log ring → 2,000, daily rows > 2 y → monthly, then `CompressionStream('gzip')` on the largest shard); only B touches storage.

## 2. Event bus (`src/shared/events.ts`)
`bus.emit(name,p)` is synchronous, subscribers isolated; `bus.on(name,fn)` returns unsubscribe; `bus.reset()` for tests. D/E/F emit facts; B reduces them (XP, stats, streak, quests, weak points, badges, wallpapers) and emits derived events; G listens for ceremonies. **XP amounts are decided only in B.**
```ts
interface Events {
 'attempt:graded': AttemptResult & {sessionId:s;exercise:ExerciseId;itemId:s|null;kind:ItemKind|null;facet:Facet|null;cardKey:CardKey|null;rating:Rating|null;judge?:'pass'|'fail';mature:b;ippon:b;kiai:b;combo:n;recovery:b;firstProd:b};
 'item:introduced':{itemId:s;kind:ItemKind;station:n}; 'item:promoted':{itemId:s;kind:ItemKind;from:ItemBelt;to:ItemBelt};
 'session:started':{sessionId:s;mode:SessionMode;zen:b}; 'session:finished':SessionResult; 'scroll:completed':{scrollId:s;itemIds:s[];flawless:b};
 'story:read':{storyId:s;mode:'read'|'speed';chars:n;cpm:n;correct:n;total:n;glossTaps:n;minutes:n;bridge:b}; 'listening:set':{storyId:s;correct:n;total:n;rate:n;minutes:n};
 'line:scored':{kind:'dictation'|'shadow';score:n;pass:b;tier?:1|2|3|4|5;replays?:n;path?:'recognition'|'self'}; 'roleplay:done':{storyId:s;best:n;total:n;aizuchiHit:n;aizuchiTotal:n;registerOk:b};
 'output:done':{kind:'three-ways'|'monologue'|'reduce-expand'|'writing';seconds?:n;words?:n;registersCorrect?:0|1|2|3;patternsHit?:n;path?:'recognition'|'self'};
 'arcade:done':{mode:'rapid'|'gojuon';correct:n;misses:n;ms:n;recheck:CardKey[]}; 'weak-point:set-done':{tag:ErrorTag}; 'weak-point:cleared':{tag:ErrorTag}; 'michikusa:read':{id:s}; 'nemesis:defeated':{itemId:s}; 'session:abandoned':{sessionId:s;steps:n};
 'gate:result':{station:n;outcome:'pass'|'perfect'|'fail'|'assisted'|'revenge';score:n;phases:n[]}; 'shinsa:result':{belt:Belt;passed:b;sections:Record<ShinsaSection,n>};
 'kage:result':{week:n;score:n;beat:b}; 'ledger:entry':{minutes:n;kind:0|1|2|3;source:0|1}; 'field-mission:done':{tier:1|2|3|4|5;minutes:n;conversation:b}; 'kiai:entered'|'backup:exported'|'welcome-back:done':{};
 // emitted by B
 'xp:gained':{amount:n;reason:s;total:n}; 'level:up':{level:n}; 'badge:earned':{id:BadgeId}; 'wallpaper:unlocked':{id:WallpaperId}; 'wallpaper:revealed':{id:WallpaperId;quadrant:1|2|3|4};
 'stamp:earned':{station:n;perfect:b;assisted:b}; 'belt:promoted':{belt:Belt}; 'streak:changed':{current:n;state:'lit'|'gold'|'ember'|'frozen'|'rest'|'broken'}; 'quest:completed':{id:s;allDone:b}; 'day:rolled':{day:EpochDay;awayDays:n};
}
```

## 3. Content loader (`src/content/loader.ts`, C)
```ts
type ContentItem = KanaItem|VocabItem|KanjiItem|GrammarItem|StoryItem|MichikusaItem|ComponentDef;
interface ContentLoader {
  manifest():Promise<ContentManifest>; station(n):Promise<StationBundle>; cumulative(n):Promise<Record<'kanaIds'|'vocabIds'|'kanjiIds'|'grammarIds',Set<s>>>;  // all stations <= n
  load(ids:s[]):Promise<void>; preloadStation(n):Promise<void>; prefetchStation(n):void;
  get<T extends ContentItem=ContentItem>(id:s):T|undefined;   // SYNC, memory cache
  getAsync<T extends ContentItem=ContentItem>(id:s):Promise<T|undefined>;   // loads the one file that holds `id` on demand (Gloss tap, capture)
  components():Promise<Map<s,ComponentDef>>;
  resolveId(id:s):s; stationOf(id:s):n|undefined; kindOf(id:s):IdKind; version:Signal<s|null>;
}
export const content:ContentLoader; export function createLoader(fetchImpl?:typeof fetch,base?:s):ContentLoader;
type IdKind = ItemKind|'story'|'michikusa'|'conjugation'|'station';   // shared/ids.ts; `kindOfId` and `kindOf` return the same union
```
Station entry stays lazy: a story opens with **only the learner's cards + the story file** because `StoryLine.tokenIds` (generated by the linker) names the item behind every token and `StationBundle.surfaces` (surface → id for the cumulative allowlist) covers non-story text; `get()` is never required for allowlist items that are not loaded, and Gloss uses `getAsync(id)` on tap. The conjugation golden table (`conjugation/*.json`, ≈ 903 rows) is **not** exposed by the loader; only `learn/conjugate.test.ts` reads it from disk.
Helpers: `content/ruby.ts` (`parseRuby toPlain toKana hasKanji`), `content/fixtures` (`FIXTURE`, `createFakeLoader()`), `shared/ids.ts` (`cardKey parseCardKey kindOfId stationOfId`, `IdKind`). Audio/STT only via `shared/audio.ts` (`services.audio|stt`, `nullAudio`, `installServices()`); `speak(text, {kana?})` takes the **plain surface** (`toPlain(ja)`) for sentences and kana only for kana items.

## 4. Exercises (`src/shared/exercise-types.ts`, D)
```ts
interface AttemptResult { correct:b; nearMiss:b; hintUsed:b; guard:b; timedOut:b; ms:n; errorTags:ErrorTag[]; answer?:s; selfRating?:1|2|3; score?:n /*0..1*/; replays?:n;   // from session-types
  implicit?:{cardKey:CardKey;rating:Rating}[] }
interface ExerciseProps<P extends StepParams=StepParams> { step:Step&{params:P}; item:ContentItem|null; feel:Settings['feel']; furigana:Settings['furigana']; jj:b; speedTier:1|2|3|4|5; exposures:n;
  onResult(r:AttemptResult):void; onHint():void; onReplay():void; requestJudge(o:{correct:s;distractors:[s,s,s]}|{rubric:s;regex:s}|{minimalPair:[s,s]}):Promise<b> }   // 4-option meaning Judge; rubric-item Judge (Final Form); perception Judge (shadow)
interface ExerciseFrameProps { step:Step; index:n; total:n; ki:n; combo:n; comboTier:0|1|2|3; timer:{ms:n;startedAt:n}|null; feel; feedback:FeedbackState|null; onGuard; onHint; onPause; onContinue; children }
interface ExerciseMeta { id:DrillId; facet:Facet|null; needsTts:b; needsStt:b; selfGraded:b; timeable:b; keys:'choices'|'text'|'kana'|'none' }
export function registerExercise(meta:ExerciseMeta, c:FunctionComponent<ExerciseProps>):void;  export function resolveExercise(id:DrillId):{meta;Component}|undefined;
```
`ExerciseFrame`, `Feedback` and `JudgeCard` live in `src/shared/ui/` (contract tier, authored by D) because **E renders them**: `SessionView`/`GateView`/`ShinsaView` wrap the resolved exercise in `<ExerciseFrame>` and feed it the runner's `ki/combo/timer/feedback`; E's own `Hud` shows only the Forge Bar / backlog count. `ExerciseFrame` owns keys 1-9 / Enter / Space / ? / Shift+Enter / Esc; exercises never bind keys. Japanese renders via `<Ruby>` (`shared/ui/Ruby.tsx`); typed Japanese via `<KanaInput>` (`shared/ui/KanaInput.tsx`, IME `shared/kana-ime.ts`, utils `shared/jp.ts`). Only the 35 `DRILL_IDS` are ever registered (26 by D, 9 by F); `RUNNER_IDS` are `SessionMode`s.

## 5. Sessions (`src/shared/session-types.ts`, E)
```ts
type SessionMode = 'kata'|'kumite'|'shugyo'|'kage'|'weak'|'rapid'|'gojuon'|'gate'|'shinsa'|'scroll'|'welcome'|'dan';
type BlockKind = 'warmup'|'reviews'|'scroll'|'sparring'|'input'|'output'|'weak'|'michikusa'|'cooldown'|'phase';
type StepParams = Partial<{ choices:s[]; answer:s; accept:s[]; answers:s[]; candidates:s[]; targetForm:ConjForm; forms:ConjForm[]; sentence:s; blank:[n,n]; blanks:[n,n][]; tiles:s[]; layout:'lr'|'tb'|'enc'; storyId:s; lineIndex:n; rate:n; distractorIds:s[]; promptEn:s; seconds:n;
  tag:ErrorTag; pool:CardKey[]; phase:1|2|3|4; michikusaId:s; scrollId:s; registerTarget:RegisterTag; mode:'choose'|'build'|'type'|'speak'|'reduce-expand'; kanaOnlyPolicy:'good'|'hard'; patternIds:s[]; missionId:s; recheck:b }>;
// answers = per-form answers (form-chain); candidates = kanji candidates Space cycles (production-forge); blanks = 1-3 particle slots (particle-duel); layout = component-assembly frame; patternIds = required grammar (writing-dojo); recheck = untimed re-test of an arcade miss
interface Step { id:s; block:BlockKind; exercise:DrillId; itemId:s|null; cardKey:CardKey|null; params:StepParams; timed:b; timerMs?:n; isNew:b; stepTag:'intro'|'+3'|'+10'|'recovery'|'relearn'|null; exposures:n; estMs:n }
interface SessionPlan { id:s; mode:SessionMode; day:EpochDay; createdAt:n; station:n; steps:Step[]; blocks:{kind:BlockKind;label:s;estMinutes:n;stepIds:s[]}[]; meta:{dueTotal:n;dueTaken:n;backlog:b;newCount:n;scrollIds:s[];storyId?:s;michikusaId?:s} }
interface StepResult extends AttemptResult { stepId:s; cardKey:CardKey|null; rating:Rating|null; ki:n; combo:n; ippon:b; kiai:b; xpDelta:n; promotion?:ItemBelt }
interface Tally { reps:n; correct:n; accuracy:n; bestCombo:n; ippon:n; xp:n; minutes:n; promotions:{itemId:s;to:ItemBelt}[]; questsDone:s[]; backlogWaiting:n }
interface SessionResult { planId:s; mode:SessionMode; startedAt:n; endedAt:n; steps:StepResult[]; tally:Tally; zen:b; resumed:b }
interface KiaiState { ki:n; combo:n; bestCombo:n; kiaiLeft:n; ippon:n; recoveryQueue:{cardKey:CardKey;at:n}[] }
interface SessionSnapshot { schema:'tsuzuku.session/1'; plan:SessionPlan; cursor:n; results:StepResult[]; kiai:KiaiState }
```
Rep loop (E): `resolveExercise` -> render -> `onResult` -> `recordAttempt()` (`@/learn/apply`: rating, FSRS, facet unlock, promotion, store writes, `attempt:graded`) -> `kiaiStep()` -> feedback -> next.

## 6. Routes (`src/shared/routes.ts`, A)
`dojo #/` `onboarding` `train/:mode` `scroll/:id` (`<station>-<n>`) `road` `station/:n` `gate/:n` `shinsa/:belt` `story/:id` `listen/:id` `taiwa/:id` `dan` `library` `collections/:tab` `studio/:wallpaperId` `records` `ledger` `settings` `backup` `about`. API: `type Route` (discriminated union), `href(r)`, `parseHash(h)`, `navigate(r,{replace?})`, `route:Signal<Route>`; never hand-write `#/...`.

## 7. CSS tokens (`src/styles/tokens.css`, A) and classes
Colors (01 S4.3): `--bg --surface --raised --fg --fg-muted --line --shu --kin --ai --sakura --matcha --neon-c --neon-m --kon --hai --focus`, `--belt-white ... --belt-black`, `--bronze --silver`. Fonts `--font-ui --font-ja --font-pixel --font-brush --font-mincho --font-neon`; sizes `--fs-1..8`; motion `--ease --dur-1 --dur-2`; layout `--gutter` 16 px, `--touch` 44 px, `--radius`, `--sp-1..6`. Theme: `:root` light; dark under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme=light])`, and under `:root[data-theme=dark]`. Body classes `feel-zen|feel-dojo|feel-arcade`, `crt`, `reduced-motion`. Shared class names (`.hanko .status-window .forge-bar .combo ...`) are declared atop `src/styles/components.css`; nobody imports A components. Live region `#live`.

## 8. Conventions
- Files `kebab-case.ts`; components `PascalCase.tsx`; pages `*Page.tsx` under `<group>/pages/`. **Default export only for pages**; all else named. Tests beside modules as `name.test.ts(x)`.
- Engines pure (`now`, `rng`, `day` injected), table-driven; each group ships the test doubles others need (`store/testing.ts`, `content/fixtures`, `bus.reset()`, `nullAudio`). TS strict, no `any`; no `Math.random`/`Date.now` outside `shared/hash.ts` and `store.now()`.
- UI copy in each folder's `strings.ts` (Sensei voice), linted by `src/i18n/banned.test.ts`. Japanese text carries `lang="ja"`. Module-level signals only in `store`.
- Phases `[P1]-[P3]` are tagged in the module plan; an unregistered exercise is skipped by the builder. No new runtime deps; nothing is ever deleted from a save (archive = flag).
- "Mature" means **the facet being tested has S ≥ 14 d** (`learn/grading.ts isMature`); every timer, speed ring, Flash/Strike sample, Kage speed half and Rapid Fire pool uses that one definition.
