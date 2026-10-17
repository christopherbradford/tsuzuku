# KOTODAMA DOJO (言霊道場)
## Design Document v1 — "Words have spirit. Train yours."

*Written from the angle of a second-language-acquisition researcher and classroom Japanese teacher. The pedagogy comes first; the game is built around it, and anything that does not move the learner toward real fluency is cut.*

---

## 0. Executive summary

Kotodama Dojo is a static, offline-capable Vite + Preact single-page app that takes an English speaker from zero to post-N1 Japanese through a mastery-gated dojo ladder (10級 → 五段). Its spine is a scheduling engine (FSRS) that governs every learnable item across separate recognition / production / listening facets, a daily session composer that enforces the input/output balance appropriate to the learner's stage, graded i+1 reading and listening at adjustable TTS speed, scenario role-play with register feedback and aizuchi training, and an explicit "Plateau Arc" that forces the switch to native-style input at N3. The game layer (XP, belts, streak with forgiveness, 49 badges, 30 procedurally generated personalized wallpapers) is deterministic, transparent and non-manipulative. Content is JSON in 100–200-item chunks written by parallel AI writers against strict schemas and validated by Vitest at build time. Audio is Web Speech API only; all art is generated at runtime in SVG/Canvas.

Honest positioning: the app supplies roughly 600–900 hours of structured practice over 3–4 years and *drives* the remaining ~1,000+ hours of real input and conversation through an Input Ledger and Field Missions. No app produces fluency alone; this one is designed to be honest about that and to make the external hours happen.

---

## Part I — What actually produces fluency

### 1.1 Operational definition of "fluent"

We do not target "passes N1." We target what N1 holders often still lack. The learner is fluent when they can:

| Dimension | Target | How we measure it in-app |
|---|---|---|
| Listening | Understand ≥ 90% of natural-speed everyday speech and ~85% of a TV drama without subtitles | Listening passages at TTS rate 1.2×, dictation accuracy at 1.0× |
| Speaking | Sustain a 10-minute unscripted conversation; 100+ words/min in monologue; appropriate register switching | Monologue word count via SpeechRecognition; Register Switch accuracy; Field Mission logs |
| Reading | Newspaper / light novel at ≥ 400 chars/min with < 2% unknown words | Reading speed timer; coverage model against known set |
| Vocabulary | ~10,000 words receptive, ~6,000 productive; 2,136 jōyō kanji | FSRS stability ≥ 30 days on the relevant facet |
| Grammar | ~800 patterns, including contracted speech, keigo, discourse markers | Cloze production accuracy, Register Switch |
| Pronunciation | Mora timing and standard pitch accent on high-frequency vocabulary; no fossilized vowel-length errors | Pitch Ear accuracy; dictation error tags |

### 1.2 The eight principles that drive every design decision

1. **Comprehensible input is the engine; everything else is steering.** Vocabulary breadth and listening comprehension grow mainly from volume of understood input (Krashen's hypothesis is contested on mechanism, uncontested on necessity). The app therefore (a) ships ~1,200 graded passages, (b) selects passages at 95–98% known-word coverage computed against the learner's actual FSRS state, and (c) tracks external input hours in an Input Ledger with a 1,500-hour lifetime goal. Input time share rises from 25% at N5 to 50% at N2+.

2. **Retrieval, not re-exposure, builds durable memory.** Every learnable item is a set of retrieval cards scheduled by FSRS. Recognition and production are *separate* cards with separate schedules because they are separate skills (Nation's receptive/productive distinction). Reading explanations earns no XP; retrieving does.

3. **Output forces noticing** (Swain). Output starts on day 1 but is graded: copy → reconstruct → transform → free. Typing uses a romaji→kana→kanji IME so the learner produces real Japanese orthography, not multiple-choice guesses. Multiple choice is permitted only for first exposure and for perception (listening/pitch) tasks.

4. **Feedback must be immediate, specific and tagged.** Every error gets an error tag (particle, conjugation, vowel-length, voicing, kanji-reading, word-choice, register, word-order, pitch, transcription). Tags drive targeted micro-drills within 48 hours. In role-play, correction is delivered as a natural recast by the NPC, then logged — the way a good conversation partner does it.

5. **Automaticity requires speed pressure, separately from accuracy.** Accuracy practice (SRS) and fluency practice (timed Rapid Fire on *already-known* items, 4/3/2-style retell with shrinking time) are different modes and are scored differently. Fluency drills never touch FSRS state except on outright failure.

6. **Chunks over words.** Formulaic sequences (collocations, sentence frames, set phrases, aizuchi) are first-class items. Native-like fluency is largely retrieval of chunks (Wray; Pawley & Syder). Every vocab item carries 1–3 collocations; Kata recitals memorize whole functional scripts.

7. **Interleave and make it desirably difficult.** Blocked practice only on first introduction. The session composer never shows more than three consecutive cards of the same type, mixes facets, and mixes stages (older material resurfaces).

8. **Phonology from day 1, minimally.** Mora rhythm, long vowels, geminates, and pitch-accent *awareness* are trained from the kana stage because these fossilize. We train perception (cheap, effective) more than production (expensive, noisy to assess).

### 1.3 Input / output / form-focus balance by stage

| Stage | Form-focused (SRS, drills, grammar) | Input (reading, listening) | Output (speaking, writing, role-play) |
|---|---|---|---|
| Kana / 10–9級 | 70% | 15% | 15% |
| N5 / 8–7級 | 55% | 28% | 17% |
| N4 / 6–5級 | 45% | 35% | 20% |
| N3 / 4–3級 | 35% | 40% | 25% |
| N2 / 2–1級 | 25% | 50% | 25% |
| N1 / 初段–二段 | 20% | 50% | 30% |
| Beyond / 三段–五段 | 15% | 50% | 35% |

The composer enforces these shares per week, not per session, so a learner can have a pure-reading Sunday.

### 1.4 Error correction policy

- **Drills:** explicit, immediate. Show the correct form, highlight the diff, name the error tag in one line ("Vowel length: おばさん vs おばあさん"). No XP penalty; errors cost nothing. The corrected item re-enters the session within 3–8 cards (short-loop retrieval).
- **Role-play:** implicit recast. NPC reflects the corrected form ("ああ、明日*休みたい*ということですね") and continues. Correction is shown afterwards in the debrief, not mid-flow — flow is what we are training.
- **Writing:** guided self-correction with a rubric and pattern detection (required grammar pattern present? particles after each noun phrase? register consistent?). Exportable as text for a human tutor; we do not pretend to grade free composition reliably.
- **Weak Points (弱点):** each error tag holds an exponentially weighted error rate. Any tag above 20% spawns a 3-minute targeted set in the next session until it drops below 8%.

### 1.5 The intermediate plateau and how we break it

The plateau (roughly N3) has four causes, each with a countermeasure that is *mandatory* in the curriculum, not optional:

| Cause | Countermeasure (the "Plateau Arc", 4級–2級) |
|---|---|
| Input stays learner-graded; native speech feels like a wall | **Native Bridge**: passages shift from textbook register to authentic-style (news, forum posts, drama-style dialogue with contractions, fillers, dropped particles). Coverage target drops from 97% to 93%; speed ladder pushes listening to 1.1–1.25×. |
| Vocabulary breadth stalls at 3–4k | **Breadth Campaign**: new-word rate rises to 12–15/day drawn from frequency bands 3k–8k; J-J definitions replace English glosses on cards (English remains a tap-to-reveal fallback). |
| Output fossilizes in "safe" N4 patterns | **Say It Three Ways**: every day, one idea expressed in casual / polite / keigo. **Monologue Marathon**: 1-minute spoken monologue daily, word count tracked. **Reduce & Expand**: retell a passage in 60s → 45s → 30s. |
| Avoidance of real conversation | **Field Missions** escalate from "watch 20 min with JP subtitles" to "have a 15-minute conversation with a native speaker and log two things you couldn't say." |

The plateau is narrated as what it is in shōnen terms — the training-arc wall — with a VS-screen wallpaper at entry and a "Beyond the Wall" wallpaper at exit. The framing is motivational; the countermeasures are the actual medicine.

### 1.6 What we deliberately cut (and why)

| Cut | Reason |
|---|---|
| Hearts / lives / energy systems | Errors are the learning event; punishing them teaches avoidance. |
| Leaderboards and social comparison | No backend anyway; comparison undermines intrinsic motivation and adds nothing to fluency. |
| Loot boxes, random chests, variable-ratio rewards | Gambling psychology. All unlocks are deterministic and visible. |
| Time-limited events, "you'll lose this if you don't log in" | FOMO. Content never expires. |
| Picture-matching vocabulary beyond concrete N5 nouns | Pictures don't scale to abstract vocabulary and encourage shallow processing. |
| English-translation drills past N4 | Interferes with direct form-meaning mapping; replaced by J-J definitions and cloze. |
| Mandatory handwriting | Most learners type. Kanji is taught via components + reading-in-context. Stroke tracing exists as an optional module and does not gate anything. |
| Avatar pets, feeding mechanics, cosmetics shop | Zero fluency value; attention sink. |
| Grammar lectures over 120 words | Learners don't read them; patterns + 5 examples + one contrast beat prose. |
| Romaji anywhere except as an input method | Romaji past week two slows kana automaticity. |
| Self-rating as the sole grading mechanism | Learners overrate themselves; see the Judge mechanic in 5.2. |
| Heavy narrative / cutscenes | Story is seasoning, not the meal. Rank-up vignettes are ≤ 80 words. |

---

## Part II — Name

Five candidates, all original wordplay:

1. **Kotodama Dojo (言霊道場)** — *kotodama* is the folk belief that words carry spirit power; a dojo is where you train. Reads as "the dojo of word-spirits." Plays naturally with "kotoba" (words) and the martial-arts ladder.
2. **PERAPERA (ぺらぺら)** — the onomatopoeia for fluent speech (and for flipping pages). Literally the user's goal.
3. **Shugyō (修行)** — ascetic training; the training-arc word. "Shugyō: The Fluency Arc."
4. **Mōichido (もう一度)** — "once more": what a learner says to a sensei and what a game says on the continue screen.
5. **Renzoku (連続)** — "continuous": a fighting-game combo word (連続技) and the streak mechanic.

**Chosen: Kotodama Dojo.** It carries the martial-arts progression in the name, "kotodama" gives the reward system its fiction (mastered words are spirits you have tamed), and *perapera* is reused inside the app as the name of the fluency index. Tagline: "Words have spirit. Train yours."

---

## Part III — The learner model and scheduling engine

### 3.1 FSRS, not SM-2

We use FSRS (v4.5/5 algorithm; `ts-fsrs`, MIT) with default parameters, desired retention 0.90 (user-adjustable 0.80–0.95). FSRS produces ~20–30% fewer reviews than SM-2 for the same retention, handles per-card difficulty, and gives us *retrievability* as a continuous number, which the composer and the passage selector use directly.

### 3.2 Items, facets, cards

Each content item spawns one FSRS card per **facet**. Facets are introduced in a staggered way so that a new word does not create four cards at once:

| Item type | Facets (introduced when) | Exercise that grades it |
|---|---|---|
| Kana | `rec` (day 0), `listen` (day 0) | Kana Strike, Kana Ear |
| Vocab | `rec` (day 0) → `listen` (rec stability ≥ 2d) → `prod` (rec stability ≥ 4d) → `pitch` (prod stability ≥ 7d, high-frequency words only) | Meaning Flash, Audio Flash, Production Forge, Pitch Ear |
| Kanji | `comp` (components→kanji, day 0) → `read` (reading-in-context, day 1) | Kanji Forge |
| Grammar | `cloze` (after lesson) → `prod` (cloze stability ≥ 7d; typed transformation) | Pattern Cloze, Transform |
| Chunk / Kata line | `prod` only | Kata Recital, Shadow Dojo |
| Dialogue | not scheduled; replayed via Weak Points | Scenario Role-Play |

**Mastered** = every unlocked facet has stability ≥ 30 days. "Known" (for coverage calculation) = `rec` retrievability ≥ 0.85 right now.

### 3.3 Automatic grading → FSRS rating

Self-rating is error-prone, so objective exercises grade themselves:

| Outcome | Rating |
|---|---|
| Wrong, or needed the answer | Again (1) |
| Correct after a hint, or correct but latency > 2× the learner's rolling median for that exercise type | Hard (2) |
| Correct first try within normal latency | Good (3) |
| Easy (4) | Never auto-assigned. Only via the explicit "I already know this" button on a *new* item (pre-known vocabulary for learners with prior exposure). |

For the one self-graded exercise (Meaning Flash), see the Judge mechanic in 5.2.

### 3.4 Leeches and load

- **Leech**: 8 lapses on a facet. The card is pulled from pure recall for 14 days and served only in context (cloze in a sentence, passage encounter), then reintroduced. A Weak Point entry is created. Leech rate is a displayed stat; the "Leech Slayer" badge rewards rehabilitation, not avoidance.
- **Load governor**: if due cards > 1.5× the learner's review capacity (daily minutes × 0.4 ÷ 7 s), new items pause automatically and the app says so plainly ("Review load is high. New words resume when the backlog clears."). Overdue cards are served lowest-retrievability-first; the remainder are rescheduled by FSRS without penalty.
- **Cramming cap**: after 2× the daily target, new-item introduction stops (spacing beats massing); reviews, reading and listening remain available with full XP. This is the "positive addiction" governor: routine, not binge.

### 3.5 Daily session composer

Daily targets: **Light 15 min / Standard 30 min / Intense 50 min** (plus a recommended 20+ min of external input logged to the Ledger). Standard composition:

```
compose(profile, now):
  budget      = profile.goalMinutes * 60
  blocks      = []
  blocks     += Warmup(3 known sentences, shadowing, 90 s)              // prime the mouth
  due         = cards where retrievability(now) < 0.90 or due <= now
                ordered by retrievability asc, then interleaved by facet
  reviewSecs  = 0.40 * budget;  reviewCount = min(due.length, reviewSecs / 7)
  blocks     += Reviews(reviewCount)                                     // max 3 same-type in a row
  retention7d = correct / total over last 7 days of review log
  newRate     = stageNewRate(profile.rank)                               // e.g. 8 vocab + 1 grammar + 2 kanji at N5
  if retention7d < 0.85 or backlog > 1.2*cap: newRate *= 0.5
  blocks     += NewItems(newRate)                                        // lesson → 3 immediate checks → enters SRS
  blocks     += Input(selectPassage(stage, knownSet, mode = alternate(reading, listening), coverage >= target))
  blocks     += Output(rotate(RolePlay, Writing, Monologue, Kata))       // speaking tasks need mic; else fallback
  blocks     += WeakPointSet() if any tag.ewma > 0.20
  blocks     += Cooldown(summary, XP, ledger prompt)
  return blocks fitted to budget (Input and Output shrink last; Reviews never below 60% of due)
```

New-item rates by stage (per day at Standard): Kana 12 kana · N5 8 vocab + 1 grammar + 2 kanji · N4 10 + 1 + 3 · N3 12 + 1 + 3 · N2 12 + 0.5 + 3 · N1 15 + 0.5 + 3 · Beyond 12 chunks/words + register items. Steady-state review load at 10 new/day is ~60–80 cards/day ≈ 8 minutes.

### 3.6 The Perapera Index (the fluency score)

A 0–100 composite shown as a five-axis radar, recomputed nightly. This is the score the app cares about; XP is effort, belts are milestones, Perapera is fluency.

| Axis | Measure |
|---|---|
| 語彙 Vocabulary | Receptive known-word count (retrievability-weighted) against 10,000; productive against 6,000 |
| 耳 Listening | Highest TTS rate at which the learner scores ≥ 80% on stage-appropriate passages; dictation accuracy at 1.0× |
| 読 Reading | Chars/min at ≥ 80% comprehension on coverage-matched passages (native ≈ 500–600) |
| 口 Speaking | Monologue words/min (SpeechRecognition) or self-timed fallback; Shadow Dojo match rate; aizuchi timing |
| 場 Register | Register Switch accuracy; role-play "best" choice rate at N3+ |

---

## Part IV — The progression ladder

Martial-arts kyū/dan ranks map onto the curriculum. **Belts are mastery-gated by a Shinsa (審査, grading exam); they are never time-gated.** Level (XP) is effort and is a separate number.

| Rank | Belt | Curriculum | Cumulative content | Gate (Shinsa) |
|---|---|---|---|---|
| 10級 | White | Hiragana (46 + dakuten/handakuten/yōon + っ/ー), mora rhythm | 104 kana forms | All hiragana `rec` stability ≥ 3d; Kana Ear ≥ 90% |
| 9級 | White, stripe | Katakana, sound contrasts, 60 survival chunks, pitch intro, first Kata (self-intro) | 208 kana, 60 chunks | Katakana ≥ 3d; recite self-intro Kata |
| 8級 | Yellow | N5-A: 400 words, 50 grammar, 50 kanji | 400 / 50 / 50 | Shinsa (see 4.2), 80% |
| 7級 | Yellow, stripe | N5-B | 800 / 100 / 100 | Shinsa |
| 6級 | Orange | N4-A | 1,150 / 165 / 200 | Shinsa |
| 5級 | Orange, stripe | N4-B | 1,500 / 230 / 300 | Shinsa |
| 4級 | Green | N3-A, **Plateau Arc begins**, Immersion UI on | 2,600 / 315 / 475 | Shinsa |
| 3級 | Green, stripe | N3-B, Native Bridge | 3,750 / 400 / 650 | Shinsa incl. 1.1× listening |
| 2級 | Blue | N2-A, Breadth Campaign, Monologue Marathon | 4,900 / 500 / 825 | Shinsa |
| 1級 | Brown | N2-B, **Plateau Arc complete** | 6,000 / 600 / 1,000 | Shinsa incl. 1.2× listening, 300 cpm reading |
| 初段 | Black | N1-A, written/formal registers | 8,000 / 700 / 1,600 | Shinsa |
| 二段 | Black | N1-B, all jōyō kanji | 10,000 / 800 / 2,136 | Shinsa incl. 400 cpm, 2-min monologue |
| 三段 | Black | Keigo mastery (sonkeigo/kenjōgo/bikago), business & service speech, formal writing | +600 words, +60 patterns | Register Switch ≥ 90%; keigo role-plays |
| 四段 | Black | Natural speech: contractions, fillers, sentence-final particles, slang & internet Japanese, Kansai-ben recognition, media literacy | +900 words/chunks, +60 patterns | Kansai listening ≥ 80%; slang appropriateness test |
| 五段 | Black, gold | Literary flavor (classical fragments, yojijukugo, proverbs), specialized domains chosen by learner (aviation, tech, medicine, law…), maintenance mode | +500 | Final Shinsa; thereafter maintenance scheduling |

### 4.1 Realistic timeline

At the Standard plan (30 min in-app + ~20 min logged external input): **100% adherence** → N5 at ~4 months, N4 at ~7, N3 at ~14, N2 at ~21, N1 at ~30 months. **Typical 70% adherence** → 5.5 / 10 / 20 / 30 / 43 months. The onboarding screen shows both numbers. We do not promise "fluent in 3 months."

### 4.2 Shinsa (grading exam) specification

20–30 minutes, taken when the app signals readiness (≥ 90% of stage items at stability ≥ 21d). Five sections, pass = ≥ 80% in each:

1. **Listening** — 10 items at stage speed (N5 0.8× … N1 1.2×), no transcript until after answering.
2. **Reading** — 2 passages at stage length, timed; comprehension questions.
3. **Form** — 30 mixed production/cloze items from the stage pool (typed, IME).
4. **Speaking** — one role-play in Speak mode (Chromium) or Build mode (elsewhere), register-scored.
5. **Writing** (N4+) — 3–6 sentences to a prompt; rubric self-check; required patterns detected automatically.

Fail → the "Sensei's Notes" screen lists exactly which items/tags to drill; retake available after 3 days; no XP loss. Pass → promotion ceremony (≤ 80-word vignette, belt animation, wallpaper unlock, 500 XP).

---

## Part V — Exercise types (interaction specs)

Notation: **Grades** = which facet it grades. **Time** = target seconds per item. **Stage** = availability.

### 5.1 Kana Strike (かな打ち) — Stage 10–9級, grades `kana:rec`
Kana flashes center-screen in a pixel arcade frame; learner types romaji; correct → the kana "shatters" into particles, next appears. 6 s timeout = Again. Mirror mode (**Kana Ear**): TTS speaks a mora; learner taps the kana from a 3×3 grid of confusables (ね/れ/わ, シ/ツ, ソ/ン). Time 3 s.

### 5.2 Meaning Flash (認識) — all stages, grades `vocab:rec`
Word shown (furigana follows the "furigana fog" rule: visible while the kanji `read` facet stability < 7d, else hidden, tap to reveal). Learner recalls meaning, taps **Reveal**, rates Again/Hard/Good. **Judge mechanic**: on a random 25% of Good ratings, a 2-option verification appears (correct meaning vs a confusable from `confusables`). Failing the Judge forces Again and increments a calibration counter shown on the profile ("Honesty: 94%"). From N3, the revealed definition is J-J with English behind a tap. Time 5 s.

### 5.3 Audio Flash (耳認識) — grades `vocab:listen`
TTS says the word (and from N4, the word inside its collocation); learner picks meaning from 4 options including one minimal-pair distractor (雨/飴, 橋/箸), or types it. Time 5 s.

### 5.4 Production Forge (鍛造) — grades `vocab:prod`, `grammar:prod`
Prompt = English gloss + a context sentence with a blank (so word choice is constrained). Learner types via the built-in IME: romaji → kana live; **Space** cycles kanji candidates drawn from the target plus known homophones (so choosing the right kanji is itself tested); **Enter** submits. Accepts kana-only answer at N5 (Good), requires kanji from N4 for words whose `read` facet is ≥ 7d (kana-only → Hard). Particle slips are tagged separately and do not fail the vocabulary card. Time 8 s.

IME rules: `nn`/`n'` → ん, `n` before consonant → ん; doubled consonant → っ; `x`/`l` prefix → small kana; `-` → ー in katakana mode; **Shift** toggles hira/kata.

### 5.5 Grammar Dojo lesson (型稽古) — first exposure only
Pattern card: pattern · one-line label · formation · ≤ 120-word explanation · 5 example sentences with TTS · one contrast ("〜てもいい vs 〜てもかまわない") · 3 immediate checks (cloze MCQ → cloze typed → transform). Then the pattern enters SRS as `cloze` cards.

### 5.6 Pattern Cloze and Transform (活用) — grades `grammar:cloze`, `grammar:prod`
Cloze: sentence with blank, type the pattern piece (N5: pick from 4 tiles; from 8級 second half: typed). Transform: "食べる → て-form", "行きます → casual negative past", "先生が言った → sonkeigo". Typed; conjugation errors tagged `conjugation`. Time 8 s.

### 5.7 Scramble (並べ替え) — Stage 10級–5級 only, grades `grammar:cloze` (Hard/Good only)
Word tiles into order for word-order and particle placement. Retired after N4 because it is too easy and encourages recognition over production.

### 5.8 Dictation (聴写) — N5+, grades `sentence listen` → feeds vocab `listen` facets of tokens
TTS plays a sentence at the learner's current speed tier; replay allowed twice (each replay → Hard ceiling). Learner types; diff view shows character-level errors colored by tag (vowel-length, voicing, particle, transcription). Score = 1 − normalized edit distance; ≥ 0.95 Good, ≥ 0.80 Hard, else Again. Speed ladder: 0.75 → 0.9 → 1.0 → 1.1 → 1.25; advance a tier after 10 consecutive ≥ 0.9 scores. Time 25 s.

### 5.9 Shadow Dojo (影稽古) — 9級+, grades chunk `prod`
Sentence with pitch-accent contour drawn over the kana; TTS plays; learner speaks. Chromium: SpeechRecognition transcript is normalized (NFKC, kanji→reading via token data) and token-matched; ≥ 90% Good, ≥ 70% Hard. Elsewhere: learner hears TTS again, hears their own recording (MediaRecorder), and self-checks a 3-item checklist (mora count, long vowels, pitch shape). Time 15 s per line.

### 5.10 Pitch Ear (アクセント耳) — 9級+, grades `vocab:pitch`
TTS says a word; learner chooses the pattern: 平板 heiban / 頭高 atamadaka / 中高 nakadaka / 尾高 odaka (shown as contour glyphs). Minimal-pair rounds ask "which did you hear: 雨 or 飴?" Restricted to high-frequency words where TTS voices are reliable. Time 4 s.

### 5.11 Kanji Forge (漢字鍛造) — 8級+, grades `kanji:comp`, `kanji:read`
Component view: the kanji explodes into its components (each with our own keyword and glyph), mnemonic shown once. Exercises: (a) components + keyword → type the reading of the kanji in a given word; (b) sentence with the kanji in context → type its reading; (c) look-alike discrimination (未/末, 微/徴) by tapping the one that fits the sentence. Time 7 s.

### 5.12 Reading Scroll (巻物) — 8級+, grades passage; captures words
Passage rendered as a horizontal scroll (vertical text toggle at N3+). Tap any token → gloss (J-E through N4, J-J + EN behind tap from N3). Timer runs silently; chars/min recorded. 3–5 comprehension questions. Any glossed word not in the learner's set can be **captured** (one tap) into SRS as a new vocab item. Passage selection: coverage ≥ 97% (N5–N4), ≥ 95% (N3), ≥ 93% (N2+, Native Bridge). Time 3–8 min.

### 5.13 Listening Arena (聴解) — 8級+
Audio only (TTS at speed tier), no text. Questions first, then transcript reveal with karaoke-style highlight, then a mandatory re-listen at +0.1 speed. Long passages are split into ≤ 180-char utterances to avoid speechSynthesis cutoffs. Time 3–6 min.

### 5.14 Scenario Role-Play (対話) — 9級+, feeds Weak Points and Register score
Branching dialogue with an NPC voice. Three modes auto-selected by stage and device: **Choose** (3–4 options: best / acceptable / register-wrong / grammar-wrong — the wrong ones are plausible, and choosing them shows the recast), **Build** (tiles), **Speak** (free speech; matched against `accept` list and `mustInclude` content words; register markers checked). **Aizuchi slots**: at marked pauses in long NPC lines, the learner must insert a backchannel (はい / ええ / そうですね / へえ) by tap or voice within 1.2 s — this is the single most under-taught conversational skill and it is drilled here. Debrief shows a register meter and all recasts. Time 3–5 min.

### 5.15 Rapid Fire (連続技) — 7級+, fluency mode
60-second blitz over items with stability ≥ 14d only. Score = correct count; combo counter; only *wrong* answers touch FSRS (Again). Arcade cabinet skin, chiptune-style procedural audio (Web Audio API oscillators). This is where speed pressure lives, isolated from accuracy practice.

### 5.16 Monologue Marathon & Reduce-and-Expand (独白) — 4級+
Daily 60-second (later 120-second) monologue on a prompt. Chromium: word count and fillers tracked; elsewhere: timer + self-report. Reduce-and-Expand: retell a just-read passage in 60 s, then 45 s, then 30 s (Nation's 4/3/2).

### 5.17 Say It Three Ways (三変化) — 4級+, grades `grammar:prod` for register patterns
One idea; type or speak it in casual, polite and keigo. Pattern detector checks markers (だ/です/でございます, 〜てくれる/〜てくださる/〜ていただく).

### 5.18 Writing Dojo (作文) — 5級+
Prompt + required patterns + target length (3–12 sentences by stage). Live checks: required patterns present, particle sanity, register consistency, kanji usage for known words. Rubric self-check. **Export** button copies text for a tutor or exchange partner. XP on completion; no automatic "grade."

### 5.19 Kata Recital (型) — 9級+, grades chunk `prod`
Memorize and recite functional scripts: self-introduction, ordering, asking directions, phone call, apology, job-interview opening, speech opener. Progressive hiding: full text → kana only → first mora of each line → nothing.

### 5.20 Field Missions (現場) — 9級+
Real-world tasks with self-report (and optional pasted text as proof-to-self): "Order in Japanese", "Write a 3-line comment on a Japanese forum", "Watch 20 minutes with Japanese subtitles and log 3 new words", "Have a 15-minute conversation; log two things you couldn't say" (those become Weak Points). 50–150 XP; minutes flow into the Input Ledger.

### 5.21 Mini-Shinsa (小審査) — weekly, 5 minutes
Random mixed test over the last two weeks' material regardless of FSRS due dates (the testing effect). Results are logged as reviews.

---

## Part VI — Content schemas (TypeScript)

Design rules for parallel AI writers: every file is one `ContentFile<T>` with 100–200 items; ids are stable and prefixed (`v-`, `k-`, `g-`, `s-`, `p-`, `d-`, `c-`, `kn-`, `kt-`, `m-`); no franchise names, real people, or copyrighted mnemonic keywords; sentences may contain at most one word above the item's stage (listed in `advanced`); every vocab item carries a pitch pattern; natural Japanese over textbook-ese. A Vitest content-lint validates every file against these schemas and cross-references ids.

```ts
// ---------- envelope ----------
export type StageId = 'kana' | 'n5' | 'n4' | 'n3' | 'n2' | 'n1' | 'b1' | 'b2' | 'b3'; // b1 keigo, b2 natural/slang/dialect, b3 literary/domain
export type Register = 'plain' | 'polite' | 'keigo-sonkei' | 'keigo-kenjo' | 'casual' | 'slang' | 'written' | 'dialect-kansai';
export type Kind = 'kana' | 'vocab' | 'kanji' | 'component' | 'grammar' | 'sentence' | 'passage' | 'dialogue' | 'kata' | 'mission';

export interface ContentFile<T> {
  schema: 'kotodama/1';
  kind: Kind;
  stage: StageId;
  chunk: number;          // 0-based within stage+kind
  items: T[];             // 100–200 (passages/dialogues: 20–50)
}

export interface Manifest {
  schema: 'kotodama/1';
  files: { path: string; kind: Kind; stage: StageId; chunk: number; count: number; sha: string }[];
}

// ---------- kana ----------
export interface KanaItem {
  id: string;                      // 'kn-0001'
  kana: string;                    // 'きゃ'
  romaji: string[];                // ['kya']
  script: 'hira' | 'kata';
  group: 'basic' | 'dakuten' | 'handakuten' | 'yoon' | 'special';
  row: string;                     // 'k'
  confusables?: string[];          // kana ids
  mnemonic?: string;               // original
  strokes?: string[];              // original SVG path data, optional
}

// ---------- vocabulary ----------
export type Pos = 'n' | 'v1' | 'v5' | 'vs' | 'vk' | 'adj-i' | 'adj-na' | 'adv' | 'prt' | 'conj' | 'expr' | 'cnt' | 'pn' | 'num' | 'pref' | 'suf' | 'ono' | 'intj';

export interface VocabItem {
  id: string;                      // 'v-n5-0001'
  stage: StageId;
  surface: string;                 // '食べる'
  reading: string;                 // 'たべる' (katakana for loanwords)
  pitch: number;                   // accent nucleus mora (0 = heiban)
  pos: Pos;
  meanings: string[];              // ≤ 3 concise English
  jjDef?: string;                  // required for n3+
  freqRank?: number;
  register: Register[];
  tags: string[];                  // 'food', 'counter', 'onomatopoeia', 'aizuchi'
  chunks: string[];                // 1–3 collocations: 'ご飯を食べる'
  sentences: string[];             // ≥ 3 Sentence ids
  kanjiIds?: string[];
  confusables?: string[];          // vocab ids used by Judge and distractors
  mnemonic?: string;
  minimalPair?: string;            // vocab id (雨 ↔ 飴)
}

// ---------- sentences ----------
export interface Token { s: string; r?: string; v?: string; k?: string[] } // surface, reading, vocab id, kanji ids

export interface Sentence {
  id: string;                      // 's-n5-00001'
  stage: StageId;
  ja: string;
  reading: string;                 // kana with spaces at token boundaries
  tokens: Token[];
  en: string;
  grammar: string[];               // GrammarPoint ids
  register: Register;
  advanced?: string[];             // vocab ids above stage (max 1)
}

// ---------- grammar ----------
export interface ClozeTemplate {
  sentence: string;                // Sentence id
  blank: string;                   // exact substring removed
  accept: string[];                // acceptable fills
  distractors: string[];           // 3 plausible wrong fills
  hint?: string;
}
export interface Transform { from: string; instruction: string; accept: string[]; tag: 'conjugation' | 'register' | 'word-order' }

export interface GrammarPoint {
  id: string;                      // 'g-n5-0012'
  stage: StageId;
  pattern: string;                 // '〜てもいいです'
  label: string;                   // 'permission: may ~'
  formation: string;               // 'Vて + もいい(です)'
  explanation: string;             // ≤ 120 words
  examples: string[];              // ≥ 5 Sentence ids
  contrasts?: { id: string; note: string }[];
  register: Register[];
  cloze: ClozeTemplate[];          // ≥ 6
  transforms?: Transform[];        // ≥ 3 from n5-B
  pitfalls?: string[];
}

// ---------- kanji ----------
export interface Component { id: string; glyph: string; keyword: string; note?: string; variants?: string[] } // 'c-0001'

export interface KanjiItem {
  id: string;                      // 'k-n5-0001'
  stage: StageId;
  char: string;
  strokes: number;
  grade: number;                   // 1–6 school, 7 secondary, 8 non-jōyō
  components: string[];            // Component ids
  keyword: string;                 // our own
  meanings: string[];
  on: string[]; kun: string[];
  mnemonic: string;                // original, ≤ 60 words, uses component keywords
  words: string[];                 // ≥ 3 vocab ids covering main readings
  readingCloze: { sentence: string; target: string; reading: string }[]; // ≥ 3
  lookalikes?: string[];           // kanji ids
}

// ---------- passages ----------
export interface Question {
  type: 'mcq' | 'tf' | 'short' | 'order';
  prompt: string;                  // Japanese from n4-B
  options?: string[];
  answer: string | number;
  explain?: string;
}

export interface Passage {
  id: string;                      // 'p-n4-0032'
  stage: StageId;
  title: string;
  mode: 'reading' | 'listening' | 'both';
  genre: 'story' | 'dialogue' | 'article' | 'email' | 'sign' | 'ad' | 'diary' | 'news' | 'essay' | 'review' | 'forum' | 'announcement';
  register: Register;
  text: string;                    // paragraphs separated by \n; speaker labels 'A：' for dialogue
  tokens: Token[];                 // every content word tagged with a vocab id for coverage
  glosses: Record<string, string>; // surface → gloss (J-E ≤ n4, J-J n3+)
  questions: Question[];           // 3–5
  charCount: number;
  targetGrammar: string[];
  bridge?: boolean;                // Native Bridge (authentic-style) passage
}

// ---------- dialogues ----------
export interface LearnerOption {
  id: string; ja: string; reading: string; en: string;
  quality: 'best' | 'ok' | 'register' | 'grammar';
  feedback: string;                // ≤ 25 words, the recast
}
export interface DialogueNode {
  id: string;
  npcLine?: { ja: string; reading: string; en: string; aizuchiSlots?: number[] }; // char offsets
  learnerTurn?: {
    options: LearnerOption[];      // exactly one 'best'
    accept: string[];              // normalized acceptable utterances for Speak/Type
    mustInclude: string[];         // content words required
    registerMarkers: string[];     // e.g. ['ます', 'です']
  };
  next: string | Record<string, string>; // node id, or option id → node id
  end?: boolean;
}
export interface Dialogue {
  id: string;                      // 'd-n4-0007'
  stage: StageId;
  scenario: string; setting: string; goal: string;
  registerTarget: Register;
  npc: { name: string; role: string; voice: 'f' | 'm' };
  start: string;
  nodes: Record<string, DialogueNode>; // 6–14 nodes
}

// ---------- kata & missions ----------
export interface Kata { id: string; stage: StageId; title: string; purpose: string; lines: string[] /* Sentence ids, 4–12 */ }
export interface Mission {
  id: string; stage: StageId; title: string;
  type: 'conversation' | 'media' | 'reading' | 'writing' | 'listening' | 'errand';
  description: string; proof: 'self-report' | 'text-paste';
  xp: number; ledgerMinutes?: number;
}

// ---------- learner state ----------
export type Facet = 'rec' | 'prod' | 'listen' | 'pitch' | 'cloze' | 'comp' | 'read';
export type ErrorTag = 'particle' | 'conjugation' | 'vowel-length' | 'voicing' | 'kanji-reading' | 'kanji-meaning' | 'word-choice' | 'register' | 'word-order' | 'pitch' | 'transcription' | 'aizuchi';
// FSRS card packed as a tuple to fit localStorage: [due, stability, difficulty, reps, lapses, state(0 new,1 learning,2 review,3 relearning), lastReview]
export type CardTuple = [number, number, number, number, number, 0 | 1 | 2 | 3, number];

export interface Progress {
  cards: Record<`${string}:${Facet}`, CardTuple>;
  introduced: Record<string, number>;     // item id → timestamp
  leeches: Record<string, number>;        // card key → until timestamp
  captured: string[];                     // vocab ids captured from passages
  passagesRead: Record<string, { cpm: number; score: number; t: number }>;
  dialoguesDone: Record<string, { best: number; total: number; t: number }>;
  katasDone: Record<string, number>;
  missionsDone: Record<string, number>;
}
export interface ReviewLogEntry { t: number; card: string; rating: 1 | 2 | 3 | 4; ms: number; ex: string; err?: ErrorTag }
export interface InputLedgerEntry { day: string; minutes: number; kind: 'listen' | 'read' | 'speak' | 'watch'; source: 'app' | 'external'; note?: string }
export interface StreakState { current: number; best: number; lastDay: string; charms: number; plannedRest: string[]; totalDays: number; repair?: { target: number; done: number } }
export interface LearnerProfile {
  id: string; name: string; nameKana: string; created: number; tz: string;
  goalMinutes: 15 | 30 | 50; retention: number;
  rank: string; level: number; xp: number;
  streak: StreakState;
  ledger: InputLedgerEntry[];
  badges: Record<string, number>;                          // badge id → unlock timestamp
  wallpapers: Record<string, { unlocked: number; seed: number }>;
  weakPoints: Record<ErrorTag, { n: number; ewma: number }>;
  goals: string[]; favoriteKanji?: string; yearKanji?: string;
  perapera: { vocab: number; listen: number; read: number; speak: number; register: number; t: number };
  settings: { voice?: string; speedTier: number; immersionUi: boolean; furiganaFog: boolean; mic: boolean };
}
export interface SaveFile { app: 'kotodama'; version: 1; exportedAt: string; profile: LearnerProfile; progress: Progress; log: ReviewLogEntry[]; monthly: MonthlyStats[] }
export interface MonthlyStats { month: string; reviews: number; correct: number; minutes: number; inputMinutes: number; newItems: number }
```

Content volume targets: 12,000 vocab (60 files), 2,336 kanji (14 files), 250 components (2 files), 950 grammar points (6 files), ~40,000 sentences (250 files), ~1,200 passages (40 files), ~400 dialogues (14 files), 60 kata (1 file), 150 missions (1 file). All audio is TTS at runtime, which is what makes a 40,000-sentence corpus feasible on GitHub Pages.

---

## Part VII — The game layer

### 7.1 Ethics charter (binding on all features)
- Every unlock condition is visible in advance and deterministic. No randomness in rewards (procedural art seeds are cosmetic and freely re-rollable).
- Nothing is ever taken away. "Total training days" never decreases. Content never expires.
- No comparison with other learners. No notifications (static site), no guilt copy.
- Stopping is rewarded: the daily summary says "Enough for today. The dojo will be here tomorrow." New items stop at 2× target.
- Mistakes are free. Rest is designed in.

### 7.2 XP and levels (effort track)
| Action | XP |
|---|---|
| Review correct (Good / Hard) | 2 / 1 |
| New item learned (3 immediate checks passed) | 5 |
| Dictation | 5–10 scaled by accuracy × speed tier |
| Shadow line | 3 |
| Reading Scroll | 15 + 5 per question correct |
| Listening Arena | 20 + 5 per question |
| Role-play | 25 (+10 if all "best") |
| Writing Dojo | 30 |
| Monologue / Three Ways | 15 |
| Field Mission | 50–150 |
| Daily goal met | 25; Ledger entry logged: 10 |
| Mini-Shinsa | 40 |
| Shinsa pass | 500 |

Standard day ≈ 250–350 XP. Level curve: cumulative XP to reach level L = `round(60 · L^1.9)`. L10 ≈ 4.8k (2 weeks), L25 ≈ 27k (3 months), L50 ≈ 102k (11 months), L75 ≈ 221k (2 years), L100 ≈ 378k (3.5 years). Levels are cosmetic and unlock nothing pedagogical; the UI says plainly "Level = effort. Belt = skill."

### 7.3 Streak (連続) with forgiveness
- A day counts with ≥ 5 minutes or ≥ 20 reviews. Low bar: the goal is showing up.
- Day boundary is 4 a.m. local; a missed day is not broken until 4 a.m. the day after (36-hour soft window).
- **Omamori charms (御守り)**: earned 1 per 7-day streak, hold max 3, auto-applied on a missed day.
- **Planned rest**: declare up to 1 rest day per week in advance; it does not consume a charm. Rest is celebrated (Onsen wallpaper).
- **Comeback (復帰)**: if the streak breaks, practicing 3 of the next 5 days restores the previous count. "Fall seven times, rise eight."
- Displayed alongside: lifetime training days (never decreases) and the Ledger total.

### 7.4 Badges (49)

| # | ID | Name | Condition |
|---|---|---|---|
| 1 | gojuon | 五十音 Gojūon | All 46 basic hiragana `rec` stability ≥ 7d |
| 2 | katakana | 片仮名開眼 Katakana Awakening | All katakana stability ≥ 7d |
| 3 | dakuten | 濁点の心得 Voiced | All dakuten/handakuten/yōon forms ≥ 7d |
| 4 | hajimemashite | 初めまして | Recite the self-introduction Kata with all text hidden |
| 5 | first-word | 一語入魂 First Word | First `prod` card graded Good |
| 6 | first-voice | 声出し First Voice | Complete first Shadow Dojo line |
| 7 | five-senses | 五感 Five Senses | Complete every exercise type at least once |
| 8 | mikka-bozu | 三日坊主、打破 Three-Day Monk Defeated | 4-day streak |
| 9 | week | 七日 Seven Days | 7-day streak |
| 10 | month | 三十日 Thirty Days | 30-day streak |
| 11 | hundred-days | 百日修行 Hundred-Day Training | 100-day streak |
| 12 | year | 一年 One Year | 365-day streak |
| 13 | rise-eight | 七転び八起き Fall Seven, Rise Eight | Complete a Comeback repair |
| 14 | rest-master | 休息の達人 Rest Master | Use 5 planned rest days |
| 15 | days-500 | 五百日 Five Hundred Days | 500 lifetime training days |
| 16 | senbon | 千本ノック Thousand Strikes | 1,000 reviews |
| 17 | manbon | 万本 Ten Thousand | 10,000 reviews |
| 18 | jumanbon | 十万本 Hundred Thousand | 100,000 reviews |
| 19 | scrolls-100 | 読書百巻 Hundred Scrolls | 100 passages read |
| 20 | million-chars | 百万字 Million Characters | 1,000,000 characters read (in-app + Ledger estimate) |
| 21 | ears-100 | 耳百時間 Hundred Hours of Ears | 100 hours listening (app + Ledger) |
| 22 | input-1000 | 千時間 Thousand Hours | 1,000 Ledger hours |
| 23 | dictation | 聴写名人 Dictation Adept | 50 dictations ≥ 95% at 1.0× |
| 24 | fast-ear | 倍速の耳 Fast Ear | 20 Listening Arena passages passed at 1.25× |
| 25 | shadow-500 | 影武者 Shadow Warrior | 500 shadowed lines |
| 26 | pitch-ear | アクセント耳 Pitch Ear | 90% over 100 consecutive Pitch Ear items |
| 27 | rain-candy | 雨と飴 Rain and Candy | Pass the full minimal-pair set |
| 28 | components | 部品博士 Component Scholar | All 250 components learned |
| 29 | joyo | 常用漢字 Jōyō Complete | All 2,136 kanji `read` stability ≥ 30d |
| 30 | combo-50 | 連続技 Renzoku | 50-correct combo in Rapid Fire |
| 31 | combo-100 | 百連 Hundred Chain | 100-correct combo |
| 32 | keigo | 敬語の達人 Keigo Master | Register Switch module ≥ 90% |
| 33 | aizuchi | 相槌名人 Aizuchi Master | 20 role-plays with ≥ 80% aizuchi timing |
| 34 | kansai | 関西弁わかる Kansai Listener | Kansai recognition module ≥ 80% |
| 35 | three-ways | 三変化 Three Forms | 100 Say-It-Three-Ways completions |
| 36 | monologue | 一分間独白 One-Minute Monologue | 60 s continuous speech, ≥ 80 words recognized (or 30 self-timed monologues) |
| 37 | sakubun-100 | 作文百篇 Hundred Compositions | 100 Writing Dojo pieces |
| 38 | vocab-1000 | 千語 Thousand Words | 1,000 words mastered |
| 39 | vocab-5000 | 五千語 Five Thousand | 5,000 mastered |
| 40 | vocab-10000 | 万語 Ten Thousand Words | 10,000 mastered |
| 41 | belt-yellow | 黄帯 | Reach 8級 |
| 42 | belt-orange | 橙帯 | Reach 6級 |
| 43 | belt-green | 緑帯 | Reach 4級 |
| 44 | belt-blue | 青帯 | Reach 2級 |
| 45 | belt-brown | 茶帯 | Reach 1級 |
| 46 | belt-black | 黒帯 | Reach 初段 |
| 47 | godan | 五段 | Reach 五段 |
| 48 | honest | 正直者 Honest One | ≥ 95% Judge agreement over 200 checks |
| 49 | weak-point | 弱点克服 Weakness Conquered | Bring any error tag from > 20% to < 5% |
| 50 | leech-slayer | 蛭退治 Leech Slayer | Rehabilitate 25 leeches to stability ≥ 30d |
| 51 | field-10 | 現場主義 Field Operative | 10 Field Missions |
| 52 | first-convo | 初対話 First Real Conversation | Log a `conversation` mission |
| 53 | backup | 備えあれば Prepared | Export a save file for the first time |
| 54 | beyond-wall | 壁を越えて Beyond the Wall | Complete the Plateau Arc (reach 1級) |

(54 listed; 49 required minimum met.)

### 7.5 Wallpaper collection (30)

Rendering: desktop **2560×1440** (16:9) and phone **1080×2340** (9:19.5), downloadable PNG. Each is a procedural scene seeded by `hash(learnerId + wallpaperId + rerollCount)`, so every learner's copy is unique and stable; "Reforge" rerolls freely. Personalization fields: `nameKana`, `rankKanji`, `yearKanji`, `favoriteKanji`, mastered phrases, stats.

| # | ID | Name | Procedural art concept | Personalization | Unlock |
|---|---|---|---|---|---|
| 1 | kotodama | 言霊 Kotodama | Dark indigo field; drifting luminous kana "spirits" (radial-gradient blobs with kana glyphs, feTurbulence displacement) | Kana you learned today | First session complete (everyone's first reward) |
| 2 | white-dawn | 白帯の朝 White Belt Dawn | Pixel-art dojo interior, sunrise through shōji grid, dust motes; Bayer-dithered gradients | Your nameplate (木札) in katakana | 9級 |
| 3 | kana-sky | 五十音の星座 Kana Constellation | Star field; constellations trace the 5 kana you learned slowest | Those kana, your name as a constellation label | Badge gojuon |
| 4 | wave | 大波と一字 The Wave and One Character | Ukiyo-e wave: layered Bezier crests, claw-foam dots, washi paper texture (feTurbulence + multiply), vermilion seal | Your 年の漢字 (year kanji) large; seal with your name | 8級 |
| 5 | torii | 鳥居の道 Torii Path | Receding vermilion torii tunnel in one-point perspective, mist gradient | Torii count = lifetime training days (capped 365) | 30-day streak |
| 6 | sakura | 桜吹雪 Sakura Storm | Poisson-disc petals with motion blur over a pixel castle silhouette at dusk | Petal count = words mastered | 500 words mastered |
| 7 | neon | ネオン看板 Neon Signboard | Synthwave alley: wet-asphalt reflections, neon tubes (stroke + gaussian glow), rain streaks | Sign reads your most-mastered phrase in vertical neon | 7級 (N5 complete) |
| 8 | insert-coin | 挿入硬貨 Insert Coin | Arcade cabinet front, CRT scanlines, marquee | Screen shows your Rapid Fire high score and initials in katakana | Badge combo-50 |
| 9 | vs | 対戦画面 VS Screen | Fighting-game intro: split diagonal, speed lines, "VS" slab | Left: your name; right: 壁 (The Wall) | Reach 4級 (Plateau Arc begins) |
| 10 | wall-broken | 壁を越えて Beyond the Wall | The same composition, wall shattered into kanji fragments, light pouring through | Fragments are grammar points you mastered during the arc | 1級 |
| 11 | scroll | 巻物 The Scroll | Unrolled makimono with vertical text columns, aged edges, seal stamps | Your 20 most recently mastered sentences | 100 passages |
| 12 | moon-blade | 月下の刀 Moonlit Blade | Katana silhouette against a huge moon, bamboo in foreground, film grain | Rank kanji engraved on the tsuka | 6級 |
| 13 | status | ステータス画面 Status Window | JRPG menu: bevelled window, pixel font, stat bars | Level, belt, retention, hours, Perapera radar | Level 20 |
| 14 | dojo-night | 道場の夜 Dojo Night | Pixel dojo exterior in rain, paper lanterns, puddle reflections | Lantern text = your name; window glow count = streak/10 | 100-day streak |
| 15 | koi | 鯉 Koi | Top-down pond, procedural koi (Bezier bodies, spot noise), ripples | One koi per 100 kanji learned | 300 kanji |
| 16 | fuji | 富士 Fuji Lines | Minimal Fuji with layered gradient bands | Ridge line is your last 90 days of minutes practiced (data art) | 5級 (N4 complete) |
| 17 | bamboo | 竹林 Bamboo Grove | Tall stalks with depth fog, light shafts | Node count across stalks = grammar points mastered | 200 grammar |
| 18 | lanterns | 提灯祭り Lantern Festival | Floating sky lanterns with warm glow, bokeh | Each lantern bears one kanji you struggled with most | 4級 |
| 19 | station | 駅名標 Station Sign | Generic rail station sign plate (no real operator design), platform at dusk | Center: your name in katakana; left/right: previous/next rank | 3級 |
| 20 | vending | 自販機の夜 Vending Machine Night | Glowing vending machine in an alley, cans with labels | Labels are katakana loanwords you mastered | 500 katakana words |
| 21 | onsen | 温泉の湯気 Onsen Steam | Rotenburo at night, steam curls (feTurbulence), mountain silhouette | Count of planned rest days as stones | Badge rest-master |
| 22 | continue | 続けますか？ Continue? | Retro continue screen, countdown digits, CRT curvature | Shows comeback count and "YES" highlighted | Badge rise-eight |
| 23 | speedlines | 集中線 Speed Lines | Manga panel with radial speed lines and halftone | Onomatopoeia you've learned burst in bold | 100 onomatopoeia words |
| 24 | daruma | 達磨 Daruma | Vermilion daruma, gold brushwork | One eye painted at 2級, second eye at 初段 (wallpaper upgrades in place) | 2級 |
| 25 | kabuki | 歌舞伎の幕 The Curtain | Tri-color stage curtain motif, stage lights | Your name in bold brush-style lettering (canvas text with jittered strokes) | 1級 |
| 26 | ema | 絵馬 Ema Plaques | Rack of wooden plaques with cords, shrine shade | Plaques carry the goals you typed in onboarding | 365 lifetime days |
| 27 | black-belt | 黒帯 Black Belt | Near-black field, gold 初段 stamp, subtle paper grain | Your name, date of promotion | 初段 |
| 28 | rain-shoji | 雨の障子 Rain on Shōji | Shōji grid, raindrop shadows, ink wash tree | Quiet; the rain density = Ledger hours/10 | Badge input-1000 |
| 29 | waveform | 聴写の波形 Waveform | Oscilloscope-style waveform of a sentence you dictated perfectly | That sentence in pixel font | Badge dictation |
| 30 | summit | 五段の山頂 Summit | Above the clouds at dawn, prayer-flag-like streamers of kanji | Full path: all 15 rank kanji along the ridge | 五段 |

---

## Part VIII — Procedural art system

**Pipeline** (`src/art/`):
1. `scene = template(wallpaperId).build(learnerData, seed, aspect)` → declarative scene JSON (layers, shapes, text runs).
2. **Shape layer**: rendered as SVG (gradients, `feTurbulence` noise, `feGaussianBlur` glow, clip paths), serialized to a Blob URL, drawn to an offscreen canvas via `Image`.
3. **Text layer**: drawn with Canvas 2D `fillText` (not inside the SVG, because an SVG in an `<img>` cannot use document webfonts). Fonts loaded via Google Fonts CSS and awaited with `document.fonts.load()` before rendering: Noto Sans JP, Shippori Mincho (ukiyo-e/scroll), DotGothic16 (pixel Japanese), Press Start 2P (pixel Latin). Brush effects = multiple jittered strokes.
4. **Post layer**: optional ordered-Bayer dithering, scanlines, grain, vignette applied on the canvas pixel buffer.
5. `canvas.toBlob('image/png')` → `<a download="kotodama-<id>-<desktop|phone>.png">`. Thumbnails at 384×216 for the gallery.

**Generators** shared across wallpapers: seeded PRNG (mulberry32), Poisson-disc sampler, Bezier wave builder, perspective helper, pixel rasterizer (draw to small canvas, upscale with `imageSmoothingEnabled=false`), neon stroke, halftone, speed-line radial, data-ridge (array → smoothed polyline).

The same system renders in-app UI art (belt icons, badge medallions, the sensei's fox-mask silhouette) so the look is consistent and zero image assets ship.

---

## Part IX — Architecture

- **Stack**: Vite + TypeScript + Preact + `@preact/signals`; hash routing (`#/dojo`, `#/train`, `#/scroll/:id`, `#/arena/:id`, `#/taiwa/:id`, `#/kanji/:id`, `#/shinsa`, `#/gallery`, `#/profile`, `#/ledger`, `#/settings`). `vite.config.ts` sets `base: '/<repo>/'`; hash routing avoids GitHub Pages 404s. Optional `vite-plugin-pwa` for offline content caching.
- **Modules**: `content/` (manifest loader, lazy chunk fetch, in-memory index), `srs/` (ts-fsrs wrapper, facet unlock rules, leech logic), `session/` (composer, interleaver, time fitting), `exercises/` (one component per type, each implementing `grade(): Rating | null`), `ime/` (romaji→kana table, candidate cycling), `speech/` (voice selection preferring ja-JP voices by quality list; sentence splitting ≤ 180 chars to dodge the Chromium 15-second cutoff; `onvoiceschanged` handling; recognition wrapper with normalization and graceful "self-check mode"), `art/`, `game/` (xp, streak, badges, wallpapers — pure functions over state), `store/` (signals + persistence), `export/` (JSON save download/import with schema migration).
- **Persistence**: single key `kotodama.save.v1` in localStorage, written debounced (1 s) and on `visibilitychange`. Budget math: a 二段 learner holds ~10k items × ~3 facets = 30k `CardTuple`s ≈ 1.5 MB raw; compressed with `lz-string` to ~0.5 MB. Review log kept as the last 50,000 entries plus `MonthlyStats` aggregates. A "storage health" meter is shown in Settings; export is nagged (gently, once a week) and rewarded with a badge.
- **Content delivery**: `/public/content/manifest.json` + chunk files; only the current stage ±1 is prefetched. Content lint runs in CI (Vitest): schema validity, id uniqueness, cross-reference integrity, ≤ 1 `advanced` word per sentence, every vocab has `pitch`, every grammar ≥ 6 cloze, no forbidden strings (franchise/person blocklist).
- **Tests (Vitest)**: FSRS wrapper determinism and facet unlock rules; romaji→kana converter (table-driven cases incl. ん/っ edge cases); session composer time-fitting and interleave constraints; passage selector coverage math; streak/charm/comeback state machine; XP/level curve; badge evaluators; wallpaper scene builders (snapshot of scene JSON per seed); save-file migration.

---

## Part X — Metrics, risks, honesty

**Effectiveness metrics (shown to the learner, not hidden)**: actual vs desired retention; reading cpm trend; highest listening tier; monologue words/min; leech rate; Weak Point heat map; Ledger hours vs the 1,500-hour goal; Perapera radar over time.

**Risks and mitigations**
- *TTS quality varies by platform* (Apple voices are offline and good; Chromium's best ja-JP voice is online-only). Mitigation: voice picker with a quality preference list, and the Ledger pushes learners to real native audio daily.
- *SpeechRecognition is Chromium-only and noisy.* Mitigation: every speaking task has a self-check fallback; speaking is never a hard gate for ranks below 三段.
- *AI-written content quality.* Mitigation: strict schemas, lint, native-speaker review checkpoints per stage, in-app "report sentence" flag exported with the save file.
- *Motivation dip at months 2–4.* Mitigation: forgiving streak, Field Missions from 9級, Plateau Arc framing, visible Perapera growth, rank Shinsa as concrete goals.
- *localStorage limits.* Mitigation: packed tuples + compression + aggregated logs; export reminders.

**What the app will not claim**: that it alone produces fluency. It will say, on the first screen, that fluency requires roughly 1,500 hours of real listening and reading and hundreds of real conversations, and that its job is to make every one of those hours count and to make sure they happen.

---

## Appendix A — Guide for parallel AI content writers (summary)

1. One `ContentFile` per task; 100–200 items (20–50 for passages/dialogues); file name `content/<kind>/<stage>-<chunk:03>.json`.
2. IDs: `<prefix>-<stage>-<nnnn>` zero-padded; ranges assigned per writer to avoid collisions.
3. Japanese must be natural and current. Vary register as tagged. Dialogue at N3+ must include contractions, fillers and aizuchi slots.
4. Every sentence: full `tokens` with vocab ids; at most one `advanced` word.
5. Every vocab: `pitch` from standard Tokyo accent; ≥ 1 collocation; ≥ 3 sentences; `confusables` where any exist.
6. Kanji mnemonics and component keywords must be original; do not reproduce published keyword systems or mnemonic sets.
7. Grammar explanations ≤ 120 words, one contrast, ≥ 6 cloze with 3 distractors each.
8. Passages: declared genre, coverage designed for the stage, 3–5 questions in Japanese from N4-B, `bridge: true` for authentic-style N3+ passages.
9. No franchise names, character names, real public figures, brand names, or lyrics. Evoke; never cite.
10. Run the lint locally before submitting: `npm run lint:content`.