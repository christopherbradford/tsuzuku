# TSUZUKU (つづく) — Design Document

*A static, offline-capable Japanese fluency game for GitHub Pages. Version 1.0 design, written from the game-designer's chair.*

---

## 0. Name

| Candidate | Wordplay | Why it works / why not |
|---|---|---|
| **TSUZUKU** (つづく / 続く) | "To be continued." The brush-lettered end card of every anime episode. Also the verb for "your streak continues," and the proverb 継続は力なり ("continuation is strength"). | Zero IP, maximum nostalgia, and it *is* the product thesis: retention. The logo is an end card. Every session ends with one. |
| DANDAN (段々 / 段) | 段々 = "step by step, gradually"; 段 = dan rank in martial arts. | Great double meaning for progression; slightly less emotional pull. |
| KOTODAMA (言霊) | "Word-spirit": the old belief that spoken words carry power. Words as ki. | Perfect for a speaking-centric combat metaphor; harder for English speakers to say. |
| SHUGYŌ (修行) | The ascetic training journey; the word under every shonen training arc. | Strong theme, but the macron and the "ascetic" overtone read as grim. |
| HYAKUREN (百錬) | "A hundred forgings" (百錬成鋼: steel tempered a hundred times). SRS as forging. | Beautiful for the review loop, but obscure. |

**Pick: TSUZUKU.** Tagline: *"To be continued. Every day."* Brand motifs: the brush-lettered つづく end card, a 4 AM day-boundary "dawn," the 53 stations of the old Tōkaidō road. (Trademark search required before launch; fallback is DANDAN.)

---

## 1. Design Thesis

Fluency in Japanese for an English speaker is a ~3,000-4,000 hour problem. No mechanic shortens that. What a game *can* do is (a) make the learner show up for 20-45 minutes a day for three years, and (b) guarantee that every one of those minutes is spent on the highest-value activity for that learner at that moment.

So the design has one master rule: **the scheduler is the game master; the game is the costume.** A spaced-repetition engine (FSRS) decides *what* you need. The Tsuzuku layer decides *how it feels*: like a fighting game training mode where words are moves, retrieval under time is execution, and fluency is "the hands remembering."

Five pillars:

1. **Retrieval is the attack.** Every exercise is a retrieval or production act. Nothing rewards passive re-reading.
2. **Failure is a whiff, not a death.** New moves are expected to miss. The combat system is tuned so honest failure never feels punishing, because fear of failure is the number one killer of SRS habits.
3. **Rewards are earned at competence milestones, not at time spent.** Dopamine-honest: the big fireworks happen when an item becomes production-stable, when a boss falls, when a rank changes. Never for grinding known items.
4. **Steady, visible, truthful progression.** 53 stations on a road. You always know where you are, what is next, and roughly when you will arrive.
5. **No dark patterns.** No currency, no loot boxes, no strangers' leaderboards, no shame. Streaks forgive. The session end says "rest."

---

## 2. Core Loop (nested)

```
REP (3-8 s)        prompt -> retrieve -> answer -> instant feedback -> ki/combo tick
BOUT (1-3 min)     10-20 reps with a shared combo meter; ends with a mini-tally
SESSION (3/10/30)  warm-up -> new material -> sparring -> cooldown -> つづく card + 次回予告
DAY                streak flame, Three Kata (daily quests), Omikuji fortune, XP
WEEK               Kage (ghost rival) set, boss availability, fragment drops
ARC (2-5 weeks)    Station chapter -> Gatekeeper boss -> Station stamp -> wallpaper quadrant
SAGA (4-18 months) JLPT tier -> Dan examination -> belt/rank -> Masterwork wallpaper
LIFETIME           Total training days, 10th dan, the road beyond Kyoto
```

The rep loop is the fighting game. The session is a roguelike run (variable contents, fixed rules, always finishable). The arc/saga is the JRPG overworld.

---

## 3. Session Design

Day boundary is **4:00 AM local** (a 1 AM session counts for "yesterday"). Any completed session of any size counts as a training day.

### 3.1 Kata (型) — 3 minutes
*"Phone out, line at the coffee shop."*

- 15-25 due reviews only, no new items, combo meter on.
- Opens with 3 easy items (ki warm-up), closes with 2 easy items (peak-end rule).
- Exactly one **Spark**: a 10-second fragment (kanji origin, proverb, culture note) between reps 8 and 9.
- Ends with the つづく card and a one-line 次回予告 (next-episode preview).
- Keeps the streak. Counts as 1/3 of a "Full Training Day."

### 3.2 Kumite (組手, sparring) — 10 minutes
- Warm-up: 15-20 reviews (3 min).
- One **Scroll** (lesson): 4-6 new vocab or 1 grammar pattern or 2 kanji, each tested immediately (3-4 min).
- Mixed sparring: 15 reps interleaving new and due items, at least 2 listening reps and 2 speaking reps where available (3 min).
- Cooldown: 3 easy reps, tally, つづく, 次回予告 (30 s).

### 3.3 Shugyō (修行, training arc) — 30 minutes
- Warm-up reviews, up to the daily cap (8-12 min).
- Two Scrolls (8 min).
- **Tabi Nikki** episode: one graded reading passage with tap-furigana and 3 comprehension questions (5 min).
- Listening set (one dialogue, variable speed, dictation + meaning) (3 min).
- Shadow Strike: 5 spoken lines (2 min).
- Optional: Gatekeeper boss if the station is complete (7-10 min, replaces the listening/speaking block).
- Cooldown + tally + つづく + 次回予告.

### 3.4 Daily targets (Standard intensity)

| Knob | Casual | Standard | Hardcore |
|---|---|---|---|
| New items/day | 6 | 12 | 25 |
| Review cap/day | 60 | 120 | 250 |
| Desired retention (FSRS) | 0.85 | 0.90 | 0.90 |
| Expected minutes/day at steady state | 10-15 | 25-40 | 50-75 |

New-item mix at Standard: 8 vocab : 2 kanji : 1 grammar : 1 phrase/onomatopoeia. Kanji only unlock when all their components are Known; grammar unlocks in station order.

**Load Governor.** If due reviews exceed 2x the cap, the day enters *Backlog Mode*: new items pause, only `cap` reviews are presented (most-overdue, lowest-retrievability first), and the UI says: *"The gatekeeper holds the line. 120 of your 310 reviews today; the rest wait without penalty."* FSRS handles overdue items gracefully, so nothing is lost, and the scary pile (the single biggest churn cause in SRS apps) never appears as a number you must clear.

### 3.5 Morning page
Opening the app shows the Dojo with a one-line forecast: *"42 reviews · 1 scroll · 1 episode · ~18 min."* Predictable workload reduces avoidance.

---

## 4. The Kiai System (combo / ki / crits)

This is the fighting-game heart, and every rule is tuned so the thing it rewards is the thing that produces fluency: fast, accurate retrieval of hard material, and honest self-assessment.

### 4.1 Ki meter (気)
Range 0-100, no time decay (no anxiety).

| Event | Ki |
|---|---|
| Correct (Good) | +8 |
| Correct and fast (< 0.8x your personal median for that exercise type) | +12 |
| **Ippon!** (一本): correct, fast, and the item's FSRS difficulty ≥ 7/10 or stability < 3 days | +20 |
| Wrong guess | -10 |
| "Don't know" (Guard) | -4 |
| Hint used | -6 |

At 100: **Kiai state** for the next 10 reps: XP x1.5, screen edge glow, rising pitch on hit sounds. Then ki resets to 30. A learner doing well triggers Kiai every 12-15 reps, roughly 2-3 times per Kata. Kiai never alters SRS grading.

### 4.2 Combo
Consecutive correct answers in a session. Milestones: 10 ("十連"), 25, 50, 100.

Combo rules that protect learning:
- **Training dummy rule:** a miss on an item with fewer than 3 reviews does *not* break the combo. New moves are supposed to whiff.
- **Guard:** pressing "Don't know" halves the combo instead of resetting it. Honest unknowns are better SRS data than guesses, and the game should teach that.
- **Block:** a near-miss (typo distance ≤ 1, right reading wrong meaning, right meaning wrong politeness) holds the combo at its value ("Blocked").
- **Recovery:** a clean miss on a mature item resets the combo, but the item returns 3-5 reps later. Get it right and half the combo is restored. This mirrors burst/recovery and mirrors the pedagogy (immediate re-test after failure).

### 4.3 Ippon (critical hits, skill-based)
Criteria are public: fast + correct + hard item. There is no RNG in crits. Variability comes from the content stream, which is naturally unpredictable. Ippon shows a brush-stroke 一本 flash and a drum hit.

### 4.4 Item belts (micro meta-progression)
Every item has a belt from its FSRS stability S (days): White (new) → Yellow (S ≥ 1) → Green (S ≥ 7, "Known") → Brown (S ≥ 30 and at least one production success, "Mastered") → Black (S ≥ 120). Promotions fire a small animation and XP (20/40/80/160). This is the per-item "level up" and it is where most of the mid-session dopamine lives, because it tracks genuine memory consolidation.

### 4.5 Nemesis (宿敵)
An item with ≥ 8 lapses becomes a Nemesis: it gets a dossier (components, mnemonic, 3 extra sentences, confusable comparison) and shows up in a "Nemesis Duel" (production, then listening, then cloze in one go). Defeating a Nemesis (3 consecutive successes across sessions) awards 200 XP. Leech handling with a face on it.

### 4.6 Zen mode
One toggle hides timers, ki, combo, and sounds. Everything still schedules identically. For anxious learners, and for accessibility. 30 Zen sessions earns a badge; the game does not treat Zen as lesser.

---

## 5. Bosses: Sekisho (関所) and Gatekeepers

The road from Edo to Kyoto had checkpoints. Each of the 53 stations ends at a **Gatekeeper**.

### 5.1 Station boss (7-10 minutes)
```
Gatekeeper of Hakone  (Station 10, end of N5)
HP 60     = correct answers required
Guard 6   = mistakes allowed (7th mistake = Retreat)

Phase 1  "Flash"  20 items, recognition (meaning MC / reading typing), 4 s each
Phase 2  "Strike" 20 items, production typing (EN->JP, cloze, conjugation), 12 s each
Phase 3  "Ear"    12 items, audio-only dictation or meaning at 1.0x, 2 replays each
Phase 4  "Final Form" 3 prompts: write (or speak) a sentence using a named grammar
          pattern from this station. Rubric check (pattern regex + length + no
          banned filler) + self-grade against a model answer. Counts as 8 HP.

Pressure Rounds: between phases, 5 items in 10 s total. Misses count as half a mistake.
Item sampling: 70% this station, 30% cumulative, weighted toward low-retrievability items.
```
Victory: Station stamp in your **Goshuin-chō** (stamp book), 1,000 XP (+500 for Perfect Guard: zero mistakes), one wallpaper quadrant revealed if a wallpaper is tied to the station, 2 fragments.

Defeat ("Retreat to train"): every missed item goes to the **Grudge List**. Rematch is allowed the same day after ≥ 20 reps across Grudge items. Third defeat unlocks the **Assisted Gate** (timers x1.5, no Phase 4) with a provisional pass; the full Gatekeeper returns later as a *Revenge Match* worth 1.5x XP. Content is never locked for more than one day.

### 5.2 Dan examination (昇段審査, 20-25 minutes)
At each tier boundary (N5, N4, N3, N2, N1). Four sections modeled on the JLPT plus speaking: Vocabulary/Kanji (30), Grammar/Reading (2 passages + 15 items), Listening (12 items at 1.0x, one at 1.25x), Speaking (5 shadow lines + 2 free answers). Pass = ≥ 80% per section. Reward: 5,000 XP, belt, title, Masterwork wallpaper.

### 5.3 Kage (影), the ghost rival
Weekly, a 30-item **Ghost Set** is sampled deterministically (seeded by ISO week) from items you knew ≥ 7 days ago. Score = accuracy x speed index. You "beat the ghost" if you beat your best of the last 4 weeks. The versus screen is you vs. your own silhouette. Beneath your scores sits an arcade-style default hi-score table of fictional dojo masters (initials and fixed scores, like a cabinet fresh from the factory), so the first weeks have targets before you have history.

---

## 6. Difficulty Curve

### 6.1 Within a rep
Timer rings are personal: "fast" is relative to *your* median for that exercise type over the last 200 reps. Targets at start: kana 1.5 s, meaning MC 3 s, reading typing 5 s, production typing 8 s, cloze 12 s, dictation 15 s. Outside boss timed phases, running out of time never fails a rep; it only removes the speed bonus.

### 6.2 Within a session (the wave)
The Kata Composer orders items by predicted retrievability into a wave: `E E E H M H M H M H E E`. Easy items build ki, hard items spend it. No item repeats within 4 reps; no more than 3 consecutive reps of the same exercise type (forced interleaving).

### 6.3 Across the road
- **Early game (kana, Stations 1-3): fast wins.** Hiragana in 4-6 days, katakana in 4-6 more, first Gatekeeper within two weeks. First wallpaper inside week two.
- **Mid game (N4-N3, Stations 11-31): the wall.** Vocabulary volume quadruples and grammar gets abstract. Counter-design: at Station 21 the game introduces **Second Wind**: the Tabi Nikki story becomes the primary XP source, bookmarked words from reading become a sanctioned source of new items (learner-driven acquisition), and bosses add narrative stakes. This matches the pedagogy: past N4, input volume matters more than drills.
- **Late game (N2-N1, Stations 32-53): endurance.** Speed reading and 1.25x-1.5x listening become daily quests; the Kage set shifts to speed; Dan exams get a timed essay-style Final Form.
- **Post-game (Beyond, the road past Kyoto): breadth.** Keigo, casual, slang, dialect awareness, media Japanese, literary awareness. No bosses; "Dōjō Yaburi" (道場破り, dojo challenges) instead: themed 10-minute gauntlets.

---

## 7. Variable Reward Without Gambling

Rules: no purchasable randomness, no scarcity, all odds visible, nothing gated by luck, every collectible reachable by every learner.

1. **Content surprise is the slot machine.** The scheduler's stream is inherently unpredictable, and Ippon crits are skill-based. That is enough "variable ratio" for the rep loop.
2. **Fragment drops (巻物).** Each station has 8 fragments (etymology, proverb, culture, pitch fact, kanji origin, usage note, yojijukugo, history). Each session delivers one, chosen by hash of (userSeed, day) from the un-collected pool. It *feels* like a drop; it is fully deterministic and completable.
3. **Omikuji (御神籤).** A daily fortune drawn at first open, seeded by (userSeed, day), not re-rollable. All outcomes positive, odds shown in the UI: 大吉 15% (Kiai lasts 15 reps today), 中吉 25% (+20% XP on one item kind), 小吉 30% (first Ippon today +100 XP), 吉 20% (one penalty-free hint), 末吉 10% ("a small blessing later": tomorrow's warm-up starts with ki at 60). Each fortune carries a proverb fragment, so even the fortune teaches.
4. **Progressive reveal.** Wallpapers reveal in quadrants as their condition progresses (a scratch-off without randomness). Anticipation, not chance.
5. **次回予告 (Jikai Yokoku).** Every session ends with a next-episode preview: one sentence from tomorrow's episode with exactly one unknown rendered as ???, three words you will meet, and "the Gatekeeper of Totsuka awaits in 4 days." Curiosity, not FOMO. No countdown timers anywhere in the product.

---

## 8. Long-Term Meta-Progression

### 8.1 The Tōkaidō: 53 stations
The curriculum is a road. Station 0 is Nihonbashi (kana). Stations 1-10 are N5, 11-20 N4, 21-31 N3, 32-42 N2, 43-53 N1 (Sanjō Ōhashi, Kyoto). The road past Kyoto (B1-B6) is Beyond. Real station names (Shinagawa, Kawasaki, Odawara, Hakone...) are used as chapter names; each station's reading episodes are set there.

### 8.2 Obi (belts) and Dan
Rank-up requires **all three**: XP threshold, mastery coverage (≥ 85% of the tier's items at Green or better, ≥ 60% at Brown), and the exam (Gatekeeper for kyū, Dan examination for dan).

| Rank | Belt | Title | Content | Cumulative XP |
|---|---|---|---|---|
| 10 kyū | White | 見習い Apprentice | Hiragana | 0 |
| 9 kyū | White/yellow tip | | Katakana | 10,000 |
| 8 kyū | Yellow | | N5 Stations 1-3 | 20,000 |
| 7 kyū | Yellow/orange | | N5 Stations 4-7 | 60,000 |
| 6 kyū | Orange | 門下生 Disciple | N5 complete (Hakone exam) | 120,000 |
| 5 kyū | Green | | N4 Stations 11-14 | 200,000 |
| 4 kyū | Green/blue | | N4 Stations 15-18 | 300,000 |
| 3 kyū | Blue | | N4 complete | 420,000 |
| 2 kyū | Purple | | N3 Stations 21-26 | 560,000 |
| 1 kyū | Brown | 師範代 Assistant Master | N3 Stations 27-31 | 760,000 |
| 初段 Shodan | Black | | N3 exam passed | 1,000,000 |
| 二段 | Black, 1 gold stripe | | N2 Stations 32-37 | 1,300,000 |
| 三段 | Black, 2 stripes | 師範 Master | N2 exam | 1,700,000 |
| 四段 | 3 stripes | | N1 Stations 43-48 | 2,200,000 |
| 五段 | 4 stripes | | N1 Stations 49-53 | 2,800,000 |
| 六段 | Red/white | 達人 Adept | N1 exam | 3,500,000 |
| 七段 | | | Keigo and business | 4,200,000 |
| 八段 | | | Casual, slang, dialect awareness | 5,000,000 |
| 九段 | | 宗師 Grandmaster | Media, literary and classical awareness | 6,000,000 |
| 十段 | Red | 続く者 The One Who Continues | 1,000 total training days and 10,000 words Mastered | 7,500,000 |

A Standard-intensity learner earns 1,800-2,500 XP/day, so N5 is ~4-5 months, N4 ~9-10 months, N3 ~17-20 months, N2 ~30 months, N1 ~48 months; Hardcore roughly halves these. The Dojo Records page shows a truthful **Projected Arrival** ("N3: March 2028 at your current pace"). Honesty about the length of the road is a feature; learners who are lied to about effort churn when reality arrives.

### 8.3 XP table
| Event | XP |
|---|---|
| Review correct: Hard / Good / Easy | 8 / 10 / 12 |
| Review Again (effort XP) | 2 |
| Recovery success after a miss | 5 |
| New item introduced | 15 |
| First production success on an item | 25 |
| Item belt promotion Y / G / Br / Bk | 20 / 40 / 80 / 160 |
| Combo 10 / 25 / 50 / 100 | 50 / 100 / 250 / 600 |
| Ippon | 15 |
| Kiai state | x1.5 on rep XP for 10 reps |
| Scroll completed | 100 |
| Episode read with ≥ 2/3 comprehension | 60 (+40 when later speed-read) |
| Listening set | 60 |
| Shadow Strike pass / set of 5 | 15 / +50 |
| Three Kata all done | 200 |
| Gatekeeper / Perfect Guard | 1,000 / +500 |
| Dan examination | 5,000 |
| Kage beaten | 300 |
| Nemesis defeated | 200 |

No daily XP cap. XP is deliberately not the gate; mastery and exams are. Grinding known items yields only baseline XP and no promotions, so the optimal XP path is the optimal learning path.

### 8.4 The Dojo (home screen)
Procedural SVG that reflects state: tatami count by rank; a wall scroll with your **chosen kanji** (picked at each rank-up from the kanji you have Mastered); a bonsai whose L-system depth is total training days (blooms at 100-day streak); lanterns per badge category; a rack of 53 stamps; the Kage silhouette sitting in the corner after you beat it.

### 8.5 Collections
- **Menko (badges)**: traditional card-disc style, 57 designs.
- **Kakejiku (wallpapers)**: 28 Masterworks, downloadable PNG.
- **Goshuin-chō (station stamps)**: 53 procedurally varied vermilion stamps, one per Gatekeeper, in a stamp book you can also export as a single PNG.
- **Makimono (fragments)**: 424 scrolls (8 per station) in the Library.
- **Yojijukugo**: 100 four-character idioms, unlocked by milestones, each shown with a tiny episode of its origin.

---

## 9. Streaks With Forgiveness (the Tsuzuku Flame)

- A day counts with any completed Kata or larger. Full Training Day (all Three Kata) turns the flame gold; a plain day keeps it orange. Both continue the streak.
- **Freeze tokens (氷)**: earned 1 per 7 streak days, hold up to 3, auto-applied on a missed day.
- **Rest days (休み)**: schedule up to 1 fixed rest day per week in settings. It never breaks the streak and is shown as a planned pause. The app recommends it: *"Even samurai rest."*
- **Dawn grace**: the day ends at 4 AM, and a late-night session is credited to the day you intended.
- **Nanakorobi Yaoki (七転八起, "fall seven, rise eight")**: if a streak breaks, complete sessions on 3 consecutive days to restore the previous count. One repair per 30 days. Free; no ads, no currency.
- **Identity over anxiety**: the header shows *Total training days* in the same type size as the current streak ("412 days trained · 3-day streak"). A break does not erase who you have become.
- **Comeback**: returning after 30+ days triggers a *Welcome Back* session: 20 items the scheduler predicts you still know, so the first session back is a win, then a badge. No guilt copy anywhere.
- No push notifications (static site). Optional: download a daily `.ics` reminder.

---

## 10. Pedagogy: What Actually Produces Fluency

The curriculum follows Nation's four strands in roughly equal time, shifting weight toward input as the learner advances.

| Strand | Share (N5 → N1) | Tsuzuku systems |
|---|---|---|
| Meaning-focused input | 20% → 40% | Tabi Nikki graded episodes (i+1), listening sets, Library fragments |
| Meaning-focused output | 15% → 25% | Shadow Strike, Free Answer, Translation Sprint, Register Shift |
| Language-focused learning | 45% → 20% | Scrolls, SRS reps, Component Assembly, Conjugation Kata, Pitch Check |
| Fluency development | 20% → 15% | Kata speed reps, Speed Read, 1.25x-1.5x listening, Kage sets |

Principles encoded as mechanics:
- **Testing effect**: every item is retrieved, never just shown; new vocab is tested within 30 seconds of introduction.
- **Spacing**: FSRS v5 for every item, desired retention 0.90, interval cap 365 days.
- **Interleaving**: the Kata Composer caps same-type runs at 3 and mixes kinds within one stream.
- **Generation effect**: production exercises arrive once an item has S ≥ 4 days; Mastery requires production.
- **Desirable difficulty**: wave sequencing and personal speed targets.
- **Comprehensible input (i+1)**: every passage is tagged with its vocab and grammar IDs; the reader engine computes known-coverage against *your* save and only serves episodes with ≤ 5% unknown tokens (≤ 8% in Beyond). Unknown tokens are tap-glossable; tapping bookmarks them as candidates for your new-item queue.
- **Noticing**: in Scrolls, the episode is re-shown with the new grammar highlighted.
- **Dual coding and elaboration**: kanji are taught as component stories; vocab cards carry collocations and a mnemonic line.
- **Phonological loop**: shadowing with variable speed.
- **Chunking**: set phrases and collocations are first-class items (PhraseItem), not just words.
- **Feedback quality**: wrong answers show the correct form, the diff, and a one-line *why* (grammar) or confusable contrast (vocab).

### 10.1 Facet rotation (how one item becomes fluent)
Each item has a single FSRS schedule, but the exercise type is chosen by maturity and by a facet bitmask that records which facets have succeeded:

| Stability | Exercise types offered |
|---|---|
| New, S < 1 | Meaning Guard (MC), Reading Strike |
| 1 ≤ S < 4 | Reading Strike, Meaning Recall (typed) |
| 4 ≤ S < 15 | Production Strike, Cloze Combo, Listening Meaning |
| 15 ≤ S < 60 | Listening Dictation, Shadow Strike, Cloze Combo |
| S ≥ 60 | Translation Sprint, Shadow Strike, Judgment Call (N2+) |

A rep is graded against the hardest facet attempted. An item cannot reach Brown without at least one production success (typed or spoken). This keeps load at one card per item while guaranteeing output.

### 10.2 Grading map (auto, no self-report buttons by default)
Wrong or Guard → **Again**. Correct with hint, or slower than 2x personal median → **Hard**. Correct → **Good**. Correct, faster than 0.6x median, no hint, S ≥ 7 → **Easy**. A "classic" setting exposes the four FSRS buttons for learners who want them. New items get two in-session short-term steps (re-presented at +3 and +10 reps) before FSRS takes over.

### 10.3 Kanji method
~250 components are items in their own right (ComponentItem) with a keyword each. A kanji unlocks only when its components are Known; it is introduced with: components laid out and named, a writer-supplied mnemonic story that uses the component keywords, the primary reading, stroke count, and 2-3 vocab that use it. Secondary readings are learned through vocabulary, never as isolated lists. Exercises: Component Assembly, Reading Strike, Kanji Recall Write (freehand canvas, self-checked against a 20% opacity overlay; optional stroke-order data from KanjiVG, CC BY-SA, is a Phase 3 add-on).

### 10.4 Grammar method
A GrammarItem is a pattern card: formation formula, meaning, ≤ 120-word explanation, nuance, one contrast with a confusable pattern, 5-8 example sentences with audio, and seeded exercises (cloze, scramble, transform, judge, translate). Grammar is never "finished" on a card: it is reviewed through sentence cloze with rotating sentences so the learner cannot memorize the surface.

### 10.5 Pitch accent
Every vocab item carries `pitch` (drop mora index; 0 = heiban; null = unknown) and `pitchConfidence`. Pitch is drawn as a line over the kana on every card. Pitch Check is a low-weight awareness exercise (not SRS-graded). TTS cannot be forced to a pitch pattern, so the game never claims the audio proves the pattern; it shows the pattern and plays the voice.

### 10.6 Speaking
Chromium: `webkitSpeechRecognition` (`lang: 'ja-JP'`, `maxAlternatives: 5`). Each alternative is normalized to hiragana (using the item's own reading data for kanji) and compared to the target by Levenshtein over mora; best score ≥ 0.80 passes, 0.60-0.79 is "Blocked" (shown with a diff), below is a miss. Elsewhere: MediaRecorder captures your attempt, plays target then you, and asks "Match? Yes / Partly / No" with the explicit note that honest self-grading is part of the training. Speaking XP is identical in both paths.

### 10.7 Listening
`SpeechSynthesisUtterance.rate` presets 0.7 / 0.85 / 1.0 / 1.25 / 1.5. Dictation gives partial credit by mora accuracy and shows a character diff. Minimal Pair Ear targets the known English-speaker traps: long vowels (おばさん/おばあさん), geminates (きて/きって), ん vs. vowel, つ/す, voiced/unvoiced.

### 10.8 Reading fluency
Episode CPM (characters per minute) is logged. Speed Read replays a previously read episode line-by-line at a chosen CPM with a comprehension check. Targets: N5 80 CPM, N4 150, N3 250, N2 350, N1 450+.

---

## 11. Curriculum Map

| Tier | Stations | Vocab (new / cumulative) | Kanji | Grammar | Phrases | Episodes | Listening sets | Est. hours |
|---|---|---|---|---|---|---|---|---|
| Kana | 0 | 107 kana + 60 loanwords | 0 (+40 components) | 0 | 20 | 6 | 4 | 15 |
| N5 | 1-10 | 800 / 800 | 100 (+80 components) | 80 | 100 | 40 | 20 | 300 |
| N4 | 11-20 | 700 / 1,500 | 200 / 300 (+70 components) | 80 | 120 | 50 | 25 | 350 |
| N3 | 21-31 | 1,700 / 3,200 | 350 / 650 (+40 components) | 100 | 150 | 66 | 33 | 600 |
| N2 | 32-42 | 2,000 / 5,200 | 350 / 1,000 (+20) | 100 | 150 | 66 | 33 | 900 |
| N1 | 43-53 | 4,000 / 9,200 | 1,150 / 2,150 (jōyō + 14 common) | 120 | 150 | 66 | 44 | 1,500 |
| Beyond | B1-B6 | 1,800 / 11,000 | 150 jinmeiyō/common extra | 60 register patterns | 400 | 60 | 60 | open |

Beyond modules: B1 Keigo (sonkeigo/kenjōgo/teineigo, business mail, service phrases); B2 Casual speech (contractions ～ちゃう/～じゃん/～っけ, particle dropping, sentence-final particles); B3 Slang and net Japanese (each item carries an `era` tag because slang expires); B4 Dialect awareness, receptive only (Kansai, Hakata, Tōhoku markers); B5 Natural speech and media (fillers, aizuchi, news headline grammar, 1.5x listening); B6 Literary and classical awareness (～ず/～べし/～なり, kotowaza, yojijukugo).

Onomatopoeia (giongo/gitaigo, 300 items) is a dedicated strand across N4-N3, because it is high-frequency in real speech and manga, and because anime fans already half-know it.

### 11.1 Tabi Nikki (旅日記): the story is the reader
The graded reader is a serialized travel diary: an unnamed traveler (second person, "you") walks the Tōkaidō. Each station has 4-6 episodes written strictly from that station's allowlist (vocab and grammar up to the current station plus at most 5% from the next). Episodes end with つづく. Writers receive a story bible (recurring original characters: an innkeeper, a wandering monk, a rival traveler, a cat). This fuses the narrative hook of continuing the story with the input strand.

### 11.2 Scroll (lesson) format, 6-8 minutes
1. Hook: one line from this station's episode you cannot fully read yet.
2. 4-6 new words with audio, pitch line, one sentence each; each tested once immediately (Meaning Guard, then Reading Strike).
3. Grammar pattern: formula, 3 examples, 1 contrast.
4. The episode excerpt with new items highlighted (noticing).
5. 8-10 mixed drills over the new items.
6. Shadow two lines.

---

## 12. Exercise Types: Interaction Specs

Global controls: keyboard-first on desktop, thumb zone on mobile. **Enter** submits, **Enter** again continues; **Space** replays audio; **?** reveals a hint (grade capped at Hard, ki -6); **Shift+Enter** or the Guard button = "Don't know." Answer input sits at the bottom third of the screen. A shrinking ring around the prompt shows the personal speed target (hidden in Zen).

**Kana Forge (romaji → kana IME)**: live conversion as you type; Hepburn and Kunrei accepted (shi/si, chi/ti, tsu/tu, fu/hu, ji/zi/di, sha/sya...), `nn` or `n'` → ん, `n` before a consonant → ん, doubled consonant → っ, `xtsu`/`ltsu` → っ, `-` → ー; unresolvable trailing romaji stays visible; Caps Lock or a toggle switches katakana mode. Answer normalization: NFKC, half/full width, punctuation and whitespace stripped, katakana/hiragana folded when the item allows, おう/おー long-vowel variants accepted for kana-typed answers.

| # | Exercise | Prompt | Response | Pass rule | Speed target | SRS-graded |
|---|---|---|---|---|---|---|
| 1 | Kana Flash | One kana (or digraph) | Type romaji; auto-submits on match | Exact (variants accepted) | 1.5 s | Yes |
| 2 | Kana Strike | TTS sound or romaji | Pick from 3x3 kana grid (keys 1-9) | Exact | 2 s | Yes |
| 3 | Reading Strike | Word in kanji | Type reading via Kana Forge | Any listed reading | 5 s | Yes |
| 4 | Meaning Guard | Word + audio | 4 choices (keys 1-4); distractors from same POS/station | Exact | 3 s | Yes (new items only) |
| 5 | Meaning Recall | Word + audio | Type English | Fuzzy: synonyms list, Levenshtein ≤ 1 for ≥ 5 chars, optional "to"/articles; "I meant that" override logged | 5 s | Yes |
| 6 | Production Strike | English + POS/register hint | Type Japanese (kana or kanji accepted) | Any listed form | 8 s | Yes |
| 7 | Cloze Combo | Sentence with blank, EN gloss | Type the inflected word | Answer list | 12 s | Yes |
| 8 | Scramble | EN sentence + shuffled bunsetsu tiles | Tap/number keys to order | Exact order or listed alternates | 20 s | Yes (grammar) |
| 9 | Particle Duel | Sentence with particle slots | Pick from は/が/を/に/で/と/へ/から/まで/より/の (keys) | Exact per slot; partial = Hard | 3 s/slot | Yes (grammar) |
| 10 | Conjugation Kata | Dictionary form + target form (て, ない, た, potential, passive, causative, volitional, ば, たら) | Type | Exact | 6 s | Yes |
| 10b | Form Chain | One verb, 5 target forms in sequence | Type each | 5/5 = Easy, 4/5 = Good, ≤ 3 = Again | 25 s | Yes |
| 11 | Listening Dictation | Audio only, rate selector | Type | ≥ 90% mora = Good, 70-89% = Hard, else Again; diff shown | 15 s | Yes |
| 12 | Listening Meaning | Audio only | 4 choices or typed English | Exact / fuzzy | 5 s | Yes |
| 13 | Minimal Pair Ear | Audio of one of two near words | Pick A/B | Exact | 3 s | No (skill stat) |
| 14 | Shadow Strike | Audio + text (text hidden after first play at S ≥ 30) | Record; SR or self-grade | Mora similarity ≥ 0.80 | 10 s | Yes (speaking facet) |
| 15 | Free Answer | Question in Japanese naming a target pattern | Type or speak freely | Rubric: pattern regex present, ≥ N characters; model answer shown; self-confirm | none | No (XP only) |
| 16 | Component Assembly | Kanji meaning + reading | Choose 2-4 component tiles from 8 | Exact set | 10 s | Yes (kanji) |
| 17 | Kanji Recall Write | Meaning + reading | Freehand on canvas, then overlay | Self-grade | none | Yes, self |
| 18 | Pitch Check | Word in kana | Pick pattern among 4 drop positions | Exact | 5 s | No |
| 19 | Episode Read | Passage with tap-furigana and gloss | Read; 3 MC questions | ≥ 2/3 | CPM logged | No (XP, bookmarks) |
| 20 | Speed Read | Known passage revealed at chosen CPM | 1 MC question | Correct | CPM | No |
| 21 | Translation Sprint | English sentence | Type Japanese | Token overlap (kana-normalized) ≥ 0.75 against any reference, else diff + override | 25 s | Yes (S ≥ 60) |
| 22 | Register Shift | Plain sentence + target register | Type | Answer list | 15 s | Yes (Beyond) |
| 23 | Judgment Call | Sentence | ○ / × plus shown explanation | Exact | 5 s | Yes (N2+) |
| 24 | Nemesis Duel | Leech item | Production → Listening → Cloze chain | 3/3 to defeat | per type | Yes |

---

## 13. Data Schemas (TypeScript)

Content ships as static JSON under `/public/content/<kind>/<level>/chunk-NNN.json`, 100-200 items per file, validated by Zod at build time. IDs are globally unique and encode kind and level: `v:n5:0123`, `k:n4:0007`, `g:n3:0031`, `p:n5:0003`, `c:comp:0042`, `kana:h:ka`, `r:n5:s03e02`, `l:n4:0012`, `f:n5:s03:05`.

```ts
export type Level = "kana" | "n5" | "n4" | "n3" | "n2" | "n1" | "beyond";
export type ItemId = string;
export type Register = "neutral" | "polite" | "casual" | "formal" | "slang" | "literary";
export type POS = "n" | "v1" | "v5" | "vs" | "vk" | "adj-i" | "adj-na" | "adv" | "prt" | "conj" | "expr" | "ctr" | "pn" | "num" | "int" | "pref" | "suf";

export interface ContentFile<T> {
  schema: "tsuzuku.content/1";
  kind: "vocab" | "kanji" | "component" | "grammar" | "phrase" | "reading" | "listening" | "fragment" | "kana" | "station";
  level: Level;
  chunk: number;          // 1-based
  idRange: [ItemId, ItemId];
  items: T[];
}

export interface Token { s: string; r?: string; ref?: ItemId }  // surface, reading, item link

export interface Sentence {
  ja: string;             // kanji/kana as written
  kana: string;           // full hiragana reading
  en: string;
  tokens?: Token[];       // for tap-furigana and coverage
  vocabRefs?: ItemId[];
  grammarRefs?: ItemId[];
}

export interface VocabItem {
  id: ItemId; level: Level; station: number;
  word: string; kana: string; pos: POS;
  meanings: string[];     // first meaning <= 4 words
  accept?: string[];      // extra accepted English answers
  altForms?: string[];    // accepted Japanese spellings
  pitch: number | null;   // drop mora index, 0 = heiban
  pitchConfidence?: "high" | "medium" | "low";
  kanjiRefs?: ItemId[];
  register: Register;
  frequencyRank?: number;
  collocations?: string[];
  mnemonic?: string;      // <= 30 words
  confusables?: { ref: ItemId; note: string }[];
  sentences: Sentence[];  // 3-5, allowlist-constrained
  tags?: string[];        // "onomatopoeia", "counter", "keigo", ...
}

export interface ComponentItem {
  id: ItemId; char: string; name: string; keyword: string; hint: string; variants?: string[];
}

export interface KanjiItem {
  id: ItemId; level: Level; station: number;
  char: string; meanings: string[];
  onyomi: string[]; kunyomi: string[]; primaryReading: string;
  components: ItemId[];   // all must be Known before unlock
  strokes: number;
  mnemonic: string;       // uses component keywords, <= 60 words
  exampleVocab: ItemId[]; // 2-3
  grade?: number;
}

export interface GrammarExercise {
  type: "cloze" | "scramble" | "transform" | "judge" | "translate" | "particle";
  prompt: Sentence;
  answer: string[];
  chunks?: string[];      // scramble tiles
  slots?: string[];       // particle answers in order
  natural?: boolean;      // judge
  explanation: string;    // <= 40 words
}

export interface GrammarItem {
  id: ItemId; level: Level; station: number;
  pattern: string;        // "〜てもいい"
  title: string;          // "Permission: may / it's okay to"
  formation: string[];    // ["V-て + もいい", "Adj-い -> くてもいい"]
  meaning: string;
  explanation: string;    // <= 120 words
  nuance?: string;
  contrast?: { ref: ItemId; note: string }[];
  examples: Sentence[];   // 5-8
  exercises: GrammarExercise[]; // >= 8
  register: Register;
}

export interface PhraseItem {
  id: ItemId; level: Level; station: number;
  ja: string; kana: string; en: string; literal?: string;
  usage: string; register: Register; pitch?: string;
  sentences: Sentence[]; tags?: string[]; era?: string; // era for slang
}

export interface MCQuestion { q: string; qEn?: string; choices: string[]; answer: number; explanation?: string }

export interface ReadingPassage {
  id: ItemId; level: Level; station: number; episode: number;
  title: string; titleEn: string; genre: "diary" | "dialogue" | "letter" | "sign" | "news" | "essay" | "story";
  paragraphs: Sentence[];
  vocabRefs: ItemId[]; grammarRefs: ItemId[];
  questions: MCQuestion[];  // exactly 3
  charCount: number;
  nextTeaser?: string;      // one-line 次回予告 seed
}

export interface DialogueLine { speaker: string; ja: string; kana: string; en: string; voice: "f" | "m" }

export interface ListeningSet {
  id: ItemId; level: Level; station: number;
  title: string; lines: DialogueLine[]; questions: MCQuestion[];
  dictationLines: number[]; // indices used for dictation
  minimalPairs?: { a: string; b: string; aKana: string; bKana: string; target: "a" | "b" }[];
}

export interface Fragment {
  id: ItemId; level: Level; station: number;
  kind: "culture" | "etymology" | "proverb" | "pitch" | "history" | "kanji-origin" | "usage" | "yojijukugo";
  title: string; ja?: string; body: string; // <= 90 words
  relatedRefs?: ItemId[];
}

export interface BossPhase {
  name: "flash" | "strike" | "ear" | "final";
  count: number; secondsPerItem: number;
  exerciseTypes: string[]; hpValue?: number;
}

export interface Station {
  id: ItemId; number: number; name: string; nameJa: string; level: Level;
  theme: string;
  vocabIds: ItemId[]; kanjiIds: ItemId[]; grammarIds: ItemId[]; phraseIds: ItemId[];
  readingIds: ItemId[]; listeningIds: ItemId[]; fragmentIds: ItemId[];
  boss: { name: string; nameJa: string; hp: number; guard: number; phases: BossPhase[]; cumulativeRatio: number };
  wallpaperId?: string;
}
```

Save state (localStorage key `tsuzuku.save.<slot>`, 3 slots, debounced 500 ms, versioned migrations):

```ts
export interface CardState {
  s: number;        // FSRS stability (days)
  d: number;        // FSRS difficulty (1-10)
  due: number;      // epoch day
  last: number;     // epoch day
  reps: number; lapses: number;
  st: 0 | 1 | 2 | 3;  // New, Learning, Review, Relearning
  f: number;        // facet bitmask: 1 recog, 2 reading, 4 production, 8 listening, 16 speaking, 32 sentence
  intro: number;    // epoch day introduced
  nem?: 1;          // nemesis flag
}

export interface SaveFile {
  schema: "tsuzuku.save/1";
  seed: string;                 // per-profile random seed for deterministic "drops"
  createdAt: number; updatedAt: number;
  profile: { name?: string; nameKana?: string; chosenKanji?: string; rank: string; title: string; startedAt: number };
  settings: {
    intensity: "casual" | "standard" | "hardcore" | "custom";
    newPerDay: number; maxReviews: number; desiredRetention: 0.85 | 0.9 | 0.95;
    dayBoundaryHour: 4; restDays: number[]; zen: boolean; timers: boolean; sounds: boolean;
    ttsVoiceURI?: string; ttsRate: number; speechRecognition: boolean;
    furigana: "always" | "tap" | "unknown-only" | "off"; reducedMotion: boolean; theme: "auto" | "dark" | "light";
  };
  srs: Record<ItemId, CardState>;
  bookmarks: ItemId[];
  progress: { station: number; stationsCleared: number[]; bossAttempts: Record<number, number>; examsPassed: string[] };
  streak: { current: number; longest: number; lastDay: number; totalDays: number; freezes: number; repairAvailableAt: number; restDaysUsed: number };
  xp: { total: number; today: number; todayDay: number; history: [day: number, xp: number][] };
  quests: { day: number; ids: string[]; done: string[] };
  collections: {
    badges: Record<string, { at: number }>;
    wallpapers: Record<string, { at: number; revealed: 0 | 1 | 2 | 3 | 4; seed: string }>;
    stamps: Record<number, { at: number; perfect: boolean }>;
    fragments: ItemId[];
    yojijukugo: string[];
  };
  kage: { week: number; scores: { week: number; acc: number; speed: number }[] };
  stats: {
    medianMs: Record<string, number>;           // per exercise type
    byType: Record<string, { n: number; ok: number }>;
    retentionObserved: number; cpmHistory: [day: number, cpm: number][];
    speakingPass: { n: number; ok: number }; minimalPairs: { n: number; ok: number }; pitch: { n: number; ok: number };
  };
  log: { day: number; mode: "kata" | "kumite" | "shugyo" | "boss" | "exam"; reps: number; ok: number; ms: number; maxCombo: number; ippon: number }[]; // ring buffer, 400
}
```

Export is the JSON file (optionally gzipped via `CompressionStream` to `.tsuzuku.json.gz`); import validates with Zod and offers merge (max of streak/xp, union of collections, newer card state) or replace. 11,000 items x ~70 bytes keeps the save under 1 MB.

---

## 14. Badges: Menko (57)

| # | Badge | 和名 | Unlock |
|---|---|---|---|
| 1 | First Step | 一歩 | Complete your first session |
| 2 | Kana Awakening | 仮名開眼 | All hiragana Green (S ≥ 7) |
| 3 | Katakana Hunter | カタカナ狩り | All katakana Green |
| 4 | Seven Days | 七日 | 7-day streak |
| 5 | Thirty Suns | 三十日 | 30-day streak |
| 6 | Hundred Days | 百日 | 100-day streak |
| 7 | One Year | 一年 | 365-day streak |
| 8 | Fall Seven, Rise Eight | 七転八起 | Repair a broken streak |
| 9 | Even Samurai Rest | 侍も休む | 10 planned rest days taken |
| 10 | Thousand Cuts | 千本 | 1,000 reviews |
| 11 | Ten Thousand | 万本 | 10,000 reviews |
| 12 | Hundred Thousand | 十万本 | 100,000 reviews |
| 13 | Ten-Chain | 十連 | 10 combo |
| 14 | Fifty-Chain | 五十連 | 50 combo |
| 15 | Hundred-Chain | 百連 | 100 combo |
| 16 | Unscathed | 無傷 | A Kata of ≥ 15 reps at 100% |
| 17 | Ippon! | 一本 | First Ippon |
| 18 | Hundred Ippon | 一本百回 | 100 Ippon |
| 19 | Lightning | 電光石火 | 100 correct reps under 2 s |
| 20 | Dawn Training | 朝稽古 | 10 sessions before 7 AM |
| 21 | Moonlight Training | 月下稽古 | 10 sessions after 10 PM |
| 22 | Gatekeeper's Respect | 関守の敬意 | First Gatekeeper cleared |
| 23 | Perfect Guard | 完全防御 | Clear a Gatekeeper with 0 mistakes |
| 24 | Revenge | 雪辱 | Clear a Gatekeeper after a Retreat |
| 25 | Departure | 旅立ち | Station 1 cleared |
| 26 | Halfway | 道半ば | Station 27 cleared |
| 27 | Kyoto | 京 | Station 53 cleared |
| 28 | Bookworm | 本の虫 | 50 episodes read |
| 29 | Speed Reader | 速読 | Speed Read at ≥ 300 CPM with the question correct |
| 30 | Golden Ear | 地獄耳 | 100 dictations at ≥ 90% |
| 31 | Sharp Ear | 聞き分け | 200 minimal pair trials at ≥ 95% |
| 32 | Voice Unlocked | 声出し | First Shadow Strike pass |
| 33 | Kiai | 気合 | 100 Shadow Strike passes |
| 34 | Hundred Characters | 百字 | 100 kanji Brown |
| 35 | Five Hundred | 五百字 | 500 kanji Brown |
| 36 | Thousand Characters | 千字 | 1,000 kanji Brown |
| 37 | Jōyō Complete | 常用制覇 | All jōyō kanji Brown |
| 38 | Thousand Words | 千語 | 1,000 vocab Brown |
| 39 | Five Thousand | 五千語 | 5,000 vocab Brown |
| 40 | Ten Thousand Words | 一万語 | 10,000 vocab Brown |
| 41 | Grammarian | 文法家 | All N5 and N4 grammar Brown |
| 42 | Form Chain | 活用連鎖 | 20 perfect Form Chains |
| 43 | Particle Sage | 助詞の賢者 | 500 Particle Duel slots at ≥ 95% |
| 44 | Keigo Initiate | 敬語入門 | 20 keigo phrases Brown |
| 45 | Street Smart | 砕けた口 | 100 casual/slang items Brown |
| 46 | Kansai Ear | 関西の耳 | Complete the dialect awareness module |
| 47 | High and Low | 高低 | 200 Pitch Checks at ≥ 80% |
| 48 | Scroll Collector | 巻物集め | 50 fragments |
| 49 | Librarian | 書庫番 | All fragments of a tier |
| 50 | Idiom Keeper | 四字熟語 | 50 yojijukugo |
| 51 | Shadow Breaker | 影を越えて | Beat your Kage 10 weeks |
| 52 | Nemesis Slayer | 宿敵討ち | Defeat 10 Nemeses |
| 53 | Comeback | 復活 | Return after 30+ days and complete a session |
| 54 | Backup Made | 保存 | Export a save file |
| 55 | Zen | 禅 | 30 Zen-mode sessions |
| 56 | Training Arc | 修行 | 50 Shugyō sessions |
| 57 | To Be Continued | つづく | 100 sessions ended on the つづく card |

Each Menko is procedural: a circular disc, a two-color ukiyo-e palette, the kanji in brush type, a border pattern (seigaiha waves, asanoha hemp leaves, kikkō hexagons) chosen by category, and a hidden stamp with the unlock date.

---

## 15. Wallpapers: Kakejiku (28 Masterworks)

Every wallpaper is a seeded, deterministic SVG scene with two compositions (landscape 1920x1080 and portrait 1080x2340 abstract units) rendered to PNG at the viewer's chosen resolution. **Personalization tokens**: name in katakana, chosen kanji, rank seal (hanko), streak or total days, a Mastered sentence of the learner's choice, station number, date. Phone layouts keep the top 12% and bottom 10% as safe zones for the clock and gesture bar. Wallpapers tied to evolving state ("living" ones) can be re-rendered any time from the Print Studio.

| # | Wallpaper | Procedural concept | Personalization | Unlock |
|---|---|---|---|---|
| 1 | Torii at Dawn 朝の鳥居 | Gradient sky, 5 layered mountain ridges from 1D noise, mist bands (feGaussianBlur), a vermilion torii | Your name on a hanging ema plaque | 9 kyū (hiragana) |
| 2 | Pixel Dojo ドット道場 | 8-bit tile dojo interior, `image-rendering: pixelated`, tatami tiles, lanterns | Wall scroll shows your chosen kanji; pixel bonsai grows with total days | 7-day streak |
| 3 | Neon Alley 電脳横丁 | One-point-perspective alley, rain streaks, neon signs with glow filters, puddle reflections | Signs read your Mastered N5 words | Station 1 |
| 4 | Sakura Storm 桜吹雪 | 3,000 petal particles through a curl-noise wind field, a planted sword silhouette | Vertical haiku-style text of a Mastered sentence | 30-day streak |
| 5 | Ink Wave 墨波 | Sumi-e wave built from jittered Béziers with ink-bleed (feTurbulence + displacement) | Red hanko of your rank | 6 kyū (N5 complete) |
| 6 | Arcade Cabinet 筐体 | Procedural cabinet, marquee, CRT screen with scanlines and a hi-score table | Marquee has your name; hi-score = your XP, your initials vs. the dojo masters | 10,000 reviews |
| 7 | Glyph Rain 文字の雨 | Falling kana/kanji columns, green phosphor palette, bloom | Columns are your Mastered kanji | 100 kanji Brown |
| 8 | Seal Wall 判子の壁 | Grid of carved vermilion seals with worn edges (noise-eroded paths) | Each seal is a Mastered kanji; center seal is your rank | 500 kanji Brown |
| 9 | Lantern River 灯籠流し | Floating lanterns with warm point glows, dark water, reflections | Each lantern carries one word you learned this month | 100-day streak |
| 10 | Fifty-Three Stations 五十三次 | Ukiyo-e style horizontal road map with hills, pines, station markers | Your position, stamps for cleared stations (living) | Station 10 |
| 11 | Mountain Temple 山寺 | Stone stairs through cedar trunks (L-system), fog layers, temple roof | Stone marker inscribed with your total days | 3 kyū (N4 complete) |
| 12 | Kendo Dawn 剣道の朝 | Silhouette mid-strike, motion arcs, a huge sun disc, dust motes | 一本 count carved under the figure | 100 Ippon |
| 13 | Shōji Light 障子 | Minimalist shōji grid with a maple-branch shadow (L-system) cast by low sun | A Mastered sentence in vertical type | 50 episodes read |
| 14 | Tokyo Night Rain 夜雨 | Isometric city blocks, lit windows (noise), elevated train with light trail, neon | Signage from your N3 vocabulary | 2 kyū |
| 15 | Dragon Gate 登竜門 | Carp leaping a waterfall (koi-becomes-dragon legend), spray particles, gold leaf | Gate inscription is your rank kanji | Shodan |
| 16 | Versus 残像 | Fighting-game character select/versus layout: two silhouettes, health bars, brush "VS" | Your name vs. 影 (Kage); bars = this week's accuracy vs. ghost | Beat Kage 10 times |
| 17 | Bonsai of Days 盆栽 | L-system tree, depth and branch count from total days, blossoms from badges | Tree = your history (living) | 365 total days |
| 18 | Starfield Dojo 星空道場 | Open-air dojo under a Milky Way (density-noise stars, dust lanes) | Your chosen kanji drawn as a constellation | 30 Zen sessions |
| 19 | Woodblock Poster 浮世絵番付 | Kabuki-style poster frame, bold title cartouche, woodblock paper texture | Title reads your rank and name (「師範代 クリス」) | 3 dan (N2 complete) |
| 20 | Thunder Katana 雷刀 | Recursive-branching lightning striking a planted katana, violet sky | 電光石火 with your fastest rep time | Lightning badge |
| 21 | Rice Field Sunset 田んぼの夕暮れ | Rolling paddies with water reflections, telephone poles, cicada-summer haze | Your name on a rural mailbox | 50 Shugyō sessions |
| 22 | Golden Screen 金屏風 | Byōbu folding screen with stylized cloud bands on gold leaf | Mastered keigo phrases written across the panels | 7 dan |
| 23 | Festival Night 祭り | Lantern strings, taiko stand, happi-coat crowd silhouettes, fireworks (particle bursts) | Casual/slang words on the festival banners | 8 dan |
| 24 | Thousand Cranes 千羽鶴 | Low-poly origami cranes in a spiral, soft shadows | One crane per 10 Mastered words, count displayed (living) | 1,000 vocab Brown |
| 25 | Kyoto Arrival 京の橋 | Great bridge at dusk, pagoda, lantern reflections, geese | Your full title and arrival date | Station 53 |
| 26 | The Road Continues 無限の道 | Perspective road into sunrise, telephone poles receding, つづく end card typography | Streak and total days on the signpost | 10 dan |
| 27 | End Card つづく | Pure black screen, brush つづく, grain | Your streak written below in small type | Nanakorobi Yaoki badge |
| 28 | Synth Grid 電脳夕陽 | Synthwave horizon grid, striped sun, chrome kana | Hi-score and name in chrome | 100,000 XP |

Rendering pipeline: build the scene graph → serialize the SVG (no text) → `Image` → `canvas.drawImage` at target resolution → draw text layers with Canvas 2D (`document.fonts.load` on self-hosted OFL fonts: Noto Sans JP, Shippori Mincho, DotGothic16 for pixel scenes, Yuji Syuku or Kaisei Decol for brush type) → `canvas.toBlob('image/png')` → download link (iOS Safari: open in new tab with a long-press hint). Resolutions: desktop 1920x1080 / 2560x1440 / 3840x2160; phone 1170x2532 / 1290x2796 / 1440x3120. Each generator has a Vitest snapshot test asserting the same seed produces the same SVG string.

---

## 16. Daily Quests: Three Kata

Three quests per day, picked deterministically (seed, day) from a pool with variety constraints (never three of the same strand):
Clear all due (or 50) · Learn a Scroll · Read an episode · 5 Shadow Strikes · Reach a 20 combo · Trigger one Kiai · 5 dictations · 3 Form Chains · 5 Nemesis reps · 5 Pitch Checks · Read one fragment in the Library · Speed Read one episode · One Minimal Pair set.

All three complete = Full Training Day (+200 XP, gold flame). Quests never require more than ~12 minutes beyond reviews.

---

## 17. Audio and Speech

- **Voices**: `speechSynthesis.getVoices()` on `voiceschanged`; filter `lang` starting with `ja`; rank by a heuristics table (Google 日本語, Microsoft Nanami/Keita, Kyoko, O-Ren); learner can pick. Warm-up utterance on first gesture to avoid Chrome's first-utterance delay. Queue with cancel-on-navigation. If no Japanese voice exists: kana shown at full size, a one-time help panel for installing one (Windows language pack, macOS Spoken Content, Android TTS data).
- **Rate** presets as in 10.7. Dialogues alternate two voices where available.
- **Recognition**: feature-detect `webkitSpeechRecognition`; `lang 'ja-JP'`, `interimResults false`, `maxAlternatives 5`; 8-second max capture; fallback path in 10.6.
- **Sound design**: all synthesized with WebAudio (no samples): hit = short filtered noise + sine, combo pitch rises a semitone per 5 combo, Ippon = low drum + brush swish, Kiai = gong. Muted in Zen and by setting.

---

## 18. Architecture

- **Stack**: Vite 5, TypeScript strict, Preact 10 + `@preact/signals`, hash router (`preact-iso` or a 60-line custom), Vitest + `@testing-library/preact`, Zod for content and save validation, `ts-fsrs` for FSRS v5 (default weights; the optimizer is a Phase 3 Web Worker task using the local review log).
- **Routes**: `#/` Dojo · `#/train/kata|kumite|shugyo` · `#/scroll/:id` · `#/road` · `#/station/:n` · `#/boss/:n` · `#/exam/:tier` · `#/story/:id` · `#/library` · `#/collections/badges|wallpapers|stamps` · `#/studio/:wallpaperId` · `#/kage` · `#/records` · `#/settings` · `#/backup`.
- **State**: a `store` of signals, persisted via a debounced writer with schema versioning and migrations; `beforeunload` flush. Every write is wrapped in try/catch; quota errors trigger a prompt to export.
- **Content loading**: `content/manifest.json` lists files with hashes and id ranges; the `ContentIndex` lazy-loads chunks on demand, caches them in memory and in the Cache API; `vite-plugin-pwa` precaches the shell and the current tier's chunks for offline Kata.
- **Engines** (pure, tested): `KanaForge` (IME), `Grader` (normalization, fuzzy match, mora diff), `Sensei` (FSRS wrapper, facet rotation, load governor), `KataComposer` (session builder, wave ordering, interleaving, short-term steps), `KiaiSystem` (ki, combo, Ippon rules), `Sekisho` (boss and exam runners), `ReaderEngine` (coverage, episode selection, CPM), `UkiyoEngine` (seeded PRNG, simplex noise, L-systems, SVG builders, PNG export), `Rewards` (badges, wallpapers, fragments, quests, Omikuji, Kage).
- **Session builder sketch**:
  ```
  due   = cards.filter(due <= today).sort(by overdueDays desc, retrievability asc)
  cap   = {kata: 25, kumite: 60, shugyo: maxReviews}[mode]; governor adjusts
  news  = mode == kata ? [] : pickNew(min(newPerDay - introducedToday, {kumite: 6, shugyo: 12}), mix 8:2:1:1, kanji deps satisfied)
  stream = wave(interleave(due.take(cap), news)) with no item within 4 reps, <= 3 same type in a row
  insert short-term steps for each new item at +3 and +10
  blocks = [warmup(3 easiest), stream, scrolls?, episode?, listening?, speaking?, cooldown(2-3 easiest), tsuzukuCard]
  ```
- **Deployment**: `base: '/<repo>/'`, GitHub Actions on push to `main` builds and deploys `dist` to Pages; `404.html` copy of `index.html` for hash routing is unnecessary but harmless.
- **Tests**: Kana Forge table (≥ 300 cases), grader edge cases (long vowels, width folding, synonyms), FSRS wrapper (grade mapping, governor), composer invariants (interleaving, no repeats), Kiai rules (dummy, guard, block, recovery), reader coverage, badge and wallpaper unlock conditions, art determinism snapshots, save migrations and import merge.

---

## 19. Content Production Pipeline (parallel AI writers)

- Each writer receives one assignment: `kind`, `level`, `station`, `idRange`, the station theme, the **allowlist** (all vocab and grammar IDs up to this station, plus the next station at ≤ 5%), the story bible, and the style guide. Output is exactly one file, e.g. `content/vocab/n5/chunk-003.json` with ids `v:n5:0301` to `v:n5:0450`.
- **Style guide (excerpt)**: readings in hiragana only; first English meaning ≤ 4 words; sentences 4-14 words at N5, up to 30 at N1; every sentence has `kana` and `en`; no copyrighted names, titles, characters, or brands; register tagged; `pitch` as an integer or null with confidence; mnemonics ≤ 30 words and must use component keywords for kanji; slang carries `era`.
- **Validator (`npm run validate:content`)**: Zod schema; id uniqueness and range; all refs resolve; kana fields contain only kana and ー; sentence token coverage ≥ 90% against the allowlist (≥ 95% for reading episodes); duplicate detection across chunks (word + kana); a forbidden-string list (IP names); per-station counts within tolerance; manifest regeneration. CI fails on any violation and prints the writer's file and item id.
- **Review pass**: a second AI pass audits a 10% sample per chunk for naturalness and pitch; humans spot-check boss sets and Dan exam pools.

---

## 20. Ethical Gamification Checklist

- No purchases, currency, ads, loot boxes, timed offers, or energy systems.
- No leaderboards against strangers (no backend, and by design); competition is you vs. your Kage.
- Every unlock condition is listed in the collection UI before unlock; Omikuji odds are displayed.
- Streaks forgive (freeze, rest days, dawn grace, repair) and total days sit beside the streak.
- The session end says "Good training. Rest." A 60-minute day shows a gentle overtraining note (spaced beats massed), never a nag to continue.
- The 次回予告 is informational: no countdowns, no "last chance."
- Zen mode removes every pressure element without reducing learning or XP.
- "How this game works" panel explains FSRS, the grading map, the ki rules, and why the governor hides your backlog.
- Accessibility: reduced motion, no flashing above 3 Hz, color plus shape for ki and combo states, scalable type, full keyboard navigation, ARIA labels, furigana modes.

---

## 21. Mechanic-to-Learning Audit

| Mechanic | Learning principle | Risk | Mitigation |
|---|---|---|---|
| Speed-based ki and Ippon | Automaticity; fluency is fast retrieval | Anxiety, guessing | Personal medians, Guard half-combo, Zen mode, time never fails a rep |
| Combo | Sustained attention, flow | Fear of hard items | Training dummy rule, Block, Recovery |
| Item belts | Visible consolidation, generation effect | Farming easy items | Scheduler owns item choice; promotions only on real stability gains |
| Bosses | Cumulative testing, interleaving, output under pressure | Gatekeeping frustration | Same-day rematch, Assisted Gate, Grudge List as targeted practice |
| Kage ghost | Fluency development on known material | Discouragement | Self-referential only; NPC hi-score table gives early targets |
| Omikuji | Novelty, daily variation | Gambling feel | No cost, no negatives, no gating, odds displayed |
| Fragments | Elaboration, culture, curiosity | Distraction | 10 seconds each, one per session |
| Tabi Nikki | Comprehensible input, narrative motivation | Too hard | Coverage-gated selection, tap gloss, bookmarks feed acquisition |
| Load governor | Spacing survives real life | Hidden backlog | Honest count shown, no penalty, FSRS handles overdue |
| Wallpapers | Identity, long-horizon goals | Hollow reward | Personalized with real competence (kanji, phrases, rank) |
| Streak | Habit formation | Shame churn | Forgiveness suite, total-days identity, Comeback session |

---

## 22. Build Plan

- **Phase 1 (MVP, Stations 0-10)**: kana and N5 content; Sensei, Kata Composer, Kiai System; exercises 1-12, 16; Scrolls; Tabi Nikki reader; 10 Gatekeepers plus the N5 Dan exam; Dojo, Road, Records; 20 badges; wallpapers 1-8; export/import; PWA shell; GitHub Pages deploy.
- **Phase 2 (Stations 11-31)**: N4 and N3 content; Shadow Strike with recognition and fallback; Speed Read; Kage; Nemesis; Form Chain; Three Kata; Omikuji; stamps book; badges to 45; wallpapers to 20; Second Wind.
- **Phase 3 (Stations 32-53 and Beyond)**: N2, N1 and Beyond content; Judgment Call, Register Shift, Pitch Check; Dan exams for N2 and N1; Dōjō Yaburi gauntlets; optional KanjiVG stroke order; FSRS optimizer in a Web Worker; all 57 badges and 28 wallpapers.

File layout: `/src/{app,engines,ui,art,content-index,store}`, `/public/content/{kana,vocab,kanji,component,grammar,phrase,reading,listening,fragment,station}/<level>/chunk-NNN.json`, `/public/content/manifest.json`, `/public/fonts/*.woff2` (OFL, self-hosted), `/tools/validate-content.ts`, `/tools/writer-brief/*.md`, `/.github/workflows/pages.yml`.

つづく。