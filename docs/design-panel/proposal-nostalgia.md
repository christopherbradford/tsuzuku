# 言霊 KOTODAMA — Design Document
### *"The training arc you actually finish."*

A static, offline-capable dojo for Japanese that carries an English speaker from あ to N1 and beyond, built on Vite + TypeScript + Preact (+ signals), hash routing, Vitest, localStorage, Web Speech API, and 100% original procedural art.

---

## 0. The Name

| Candidate | Wordplay | Fate |
|---|---|---|
| **言霊 KOTODAMA** | "Word-spirit." The old belief that words carry spiritual power. Also *koto* (word/thing) + *tama* (soul, and *jewel*: the collectible). Every learned item is a spirit you have earned; the gallery is a shrine. | **Chosen app name** |
| 続く TSUZUKU | "To be continued," the end card of every episode. *Tsuzukeru* = to keep going. | Becomes the daily loop / streak system |
| 百錬 HYAKUREN | "A hundred temperings" (百錬の刀: a blade folded a hundred times). Spaced repetition *is* forging. | Becomes the SRS engine |
| 五十音ファイター GOJŪON FIGHTER | "The Fifty Sounds" (the kana chart) + fighting game. | Becomes the kana arcade mode |
| 修行 SHUGYŌ | Ascetic training: THE training-arc word. *Shu* (master) + *gyō* (practice). | Becomes the curriculum path |

**Why Kotodama wins:** pronounceable by English speakers, zero IP collision, and the collectible conceit is *pedagogically honest*. You are collecting words (the real unit of fluency), not gems. It also hands us a visual language: hitodama flames, shrines, scrolls, seals.

**Tagline:** "Words have spirits. Train yours."
**Learner's default name if none is given:** 無名 *Mumei* ("Nameless"), the wandering-swordsman default. It reads as cool, not as a missing field.

**Logo:** 言霊 brushed in sumi (Yuji Syuku), the final stroke of 霊 breaking into a 4-pixel-tall chiptune flame. Monochrome version is a single enso circle with a pixel flame inside.

---

## 1. Creative Thesis

Three eras fused, each mapped to a *function* so the mix never feels random:

| Era | Where it lives in the app | Why |
|---|---|---|
| **Dojo / ukiyo-e / sumi-e** | Ceremony, rank, reading scrolls, light theme | Mastery is earned slowly; washi and ink convey patience |
| **90s arcade / pixel** | Drills, combos, kana fighter, sound | Fast feedback loops; reaction-time training needs arcade energy |
| **JRPG status screens / synthwave Tokyo** | Home, stats, gallery, dark theme | The "numbers go up" pleasure, framed as a character sheet, not a slot machine |

**Four creative pillars**

1. **Earned, not bought.** Nothing in the game is purchasable, random, or time-limited. Every pixel of reward is a receipt for learning.
2. **Ceremony over confetti.** Big moments get *slow* ritual (taiko, ink, seal). Small moments get 80 ms chiptune. Nothing in between.
3. **Nostalgia through motif, never IP.** Torii, sakura, neon kanji, CRT bezels, pixel dojos, katana silhouettes, hanko, scrolls, arcade cabinets, speed lines, halftone. No characters, no franchise names, no logos.
4. **Fluency is a body skill.** Martial arts vocabulary is literal, not decorative: *kata* (patterns drilled to automaticity), *randori* (free output), *shinsa* (graded exam), *keiko* (practice), *shugyō* (the long path).

**Voice of the app ("Sensei voice"):** terse, warm, dry. Failure copy: "Again. That's the training." Return copy after absence: "The dojo kept your place." Banned phrases: "You lost your streak," "Don't let ___ down," "Only X hours left," "Hurry."

---

## 2. Visual Identity

### 2.1 Typography (all open-license, bundled via @fontsource or Google Fonts subsets)

| Role | Latin | Japanese | Notes |
|---|---|---|---|
| UI body | Inter 400/600 | Noto Sans JP 400/700 | `font-feature-settings: "palt"` for JP |
| Pixel / arcade | Press Start 2P | **DotGothic16** | DotGothic16 is a full-JIS pixel font: the single most important nostalgic asset we have |
| Ceremony / brush | — | **Yuji Syuku** (brush), Shippori Mincho B1 (formal) | Rank kanji, enso, seals |
| Neon display | Dela Gothic One (works for kana + Latin) | same | Signage in Neon Alley, level numbers |
| Manga SFX | — | Reggae One / Rampart One | Onomatopoeia in Training Arc wallpaper |
| Furigana | — | Noto Sans JP at 0.5em via `<ruby>` | Toggle: always / hover / off |

Type scale: 12 / 14 / 16 / 20 / 28 / 40 / 64 / 120 (ceremony kanji). Japanese line-height 1.8, Latin 1.5.

### 2.2 Color System (CSS custom properties on `:root`, two themes)

**Core palette (named like pigments):**

| Token | Hex | Name | Use |
|---|---|---|---|
| `--sumi` | `#0B0B10` | Ink | Dark bg, all ink art |
| `--washi` | `#F4EDE0` | Paper | Light bg, scroll surfaces |
| `--shu` | `#E63B2E` | Vermilion | Torii, hanko, primary action |
| `--kin` | `#E0B341` | Gold | XP, masterwork tier, dan ranks |
| `--ai` | `#1F2A6B` | Indigo | Secondary, N-level chips |
| `--sakura` | `#F7B2C4` | Blossom | Streak accents, success-soft |
| `--matcha` | `#7BB661` | Tea | Correct, grammar category |
| `--neon-c` | `#2EE6D6` | Cyan | Arcade UI, listening |
| `--neon-m` | `#FF3DA6` | Magenta | Arcade UI, speaking |
| `--kōn` | `#1F3A93` | Prussian blue | Ukiyo-e water/sky |
| `--hai` | `#8A8578` | Ash | Disabled, hints |

**Themes:** `Arcade Night` (dark, default; sumi bg, neon accents, optional CRT scanline overlay at 6% opacity) and `Dojo Morning` (light; washi bg with 3% feTurbulence paper grain, sumi text, shu/kin accents). Theme auto-follows `prefers-color-scheme`, manual override persisted.

**Category colors (consistent everywhere, incl. spirits on the home shrine):** Kana `--sakura`, Vocab `--neon-c`, Kanji `--kin`, Grammar `--matcha`, Listening `--ai`, Speaking `--neon-m`, Reading `--shu`.

**Belt colors:** white `#F4EDE0`, yellow `#F2D54A`, orange `#F08A24`, green `#3E9B4F`, blue `#2F6FD6`, purple `#7A3FB5`, brown `#6B3F23`, red `#C8102E`, black `#0B0B10` (gold stitching for dan).

### 2.3 UI Motifs & Components

| Component | Motif | Spec |
|---|---|---|
| **Status Window** | JRPG menu frame | 2px double border, corner notches, DotGothic16 labels (Lv / HP / XP), background 92% sumi |
| **Scroll Card** | Makimono | Lesson/reading cards with rolled ends (SVG caps), unroll animation 240 ms on open |
| **Hanko Button** | Seal | Primary CTA is a square vermilion seal; press = 60 ms scale 0.96 + ink-bleed filter pulse |
| **Forge Bar** | Fighting-game HP bar | Due reviews shown as a depleting HP bar labelled 百錬; segments chip off per correct answer |
| **Combo Counter** | Arcade | Top-right, Press Start 2P, grows 1.0→1.3 scale per tier, shakes at 20+ |
| **Torii Gate Nav** | Shrine path | Rank ladder is a vertical path of torii; locked gates are grey stone, unlocked are vermilion |
| **Tategaki Column** | Vertical text | Mastered sentence of the day shown vertically on home screen right edge |
| **CRT Toggle** | Arcade cabinet | Optional scanlines + 1px chromatic aberration on arcade screens only |
| **Spirit Flames** | Hitodama | Canvas particle system on the home Shrine: one flame per mastered item (capped at 400 rendered, counter shows true total), colored by category, drifting on a noise field |

### 2.4 Motion

UI transitions 120–220 ms, `cubic-bezier(.2,.8,.2,1)`. Ceremonies 6–12 s, always skippable with any key/tap. `prefers-reduced-motion` disables particles, speed lines, screen shake; keeps opacity fades.

---

## 3. Sound & Haptics (original chiptune, Web Audio API, zero samples)

All sounds synthesized at runtime, so nothing is copyrighted and the bundle stays tiny. Master volume slider, default 60%, mute remembered. `navigator.vibrate` where available.

| Event | Recipe | Length |
|---|---|---|
| Correct | Square wave C5→E5 two-note arpeggio, 8 ms attack, 60 ms decay | 90 ms |
| Correct, combo tier 2 (10+) | Adds G5; tier 3 (20+) adds C6 and a noise-burst hi-hat | 120 ms |
| Wrong | Triangle wave A2, low-pass 600 Hz, soft "donk". Never a buzzer. | 140 ms |
| Review submitted (any grade) | Metallic click: short noise burst through band-pass 2 kHz (anvil tap, the forge) | 40 ms |
| Lesson complete | 5-note square fanfare G4 C5 E5 G5 C6 with triangle bass | 900 ms |
| Level up | 8-note fanfare + arpeggiated sawtooth chord sweep | 1.6 s |
| Badge earned | Hanko stamp: low sine thump 80 Hz + paper-slap noise burst | 300 ms |
| Rank ceremony | Taiko: 55 Hz sine with pitch drop + brown-noise burst, ×3 hits; then shakuhachi-ish sine with 5 Hz vibrato and breath noise | 12 s |
| Wallpaper unlock | Wind chime: 4 random pentatonic sine partials with long decay | 2.5 s |
| Streak day secured | Two koto-like plucked notes (Karplus-Strong via delay-line buffer) | 600 ms |
| TSUZUKU end card | Single rising triangle gliss with reverb (convolver from generated impulse) | 1.2 s |

Haptics: correct 10 ms, wrong 30 ms, badge 10-30-10 ms pattern.

---

## 4. The Progression Ladder (Belts as Ceremony)

### 4.1 Two separate axes, on purpose

- **Level (Lv 1–99)** = effort. Earned by XP. Continuous, always rising, never gates content. The JRPG axis.
- **Rank (10 kyū → 5 dan)** = mastery. Earned only by passing a **Shinsa** (graded exam) *and* meeting mastery thresholds. XP cannot buy a rank. The dojo axis.

This separation is the single most important ethical/pedagogical decision in the design: grinding is rewarded with levels (harmless), but identity (rank, belt, enso) is tied to demonstrated competence.

### 4.2 The ladder

| Rank | Belt | Curriculum block | Approx. cumulative content (vocab / kanji / grammar) | Can-do target | Est. time at 150 XP/day |
|---|---|---|---|---|---|
| 10級 | White | Kana I: hiragana 46 + dakuten/handakuten | 0 / 0 / 0 | Read any hiragana | Week 1 |
| 9級 | Yellow | Kana II: katakana, yōon, sokuon, long vowels, pitch intro, 60 loanwords | 60 / 0 / 2 | Read menus, sound out names | Weeks 2–3 |
| 8級 | Orange | N5-A | 400 / 50 / 40 | Introduce self, shop, ask directions | Month 2–3 |
| 7級 | Green | N5-B (N5 complete) | 800 / 100 / 80 | Simple past/future, desires, invitations | Month 4–5 |
| 6級 | Blue | N4-A | 1,150 / 200 / 130 | Potential, te-form chains, giving/receiving | Month 6–8 |
| 5級 | Purple | N4-B (N4 complete) | 1,500 / 300 / 180 | Conditionals, passive/causative, short narratives | Month 9–11 |
| 4級 | Brown | N3-A | 2,600 / 475 / 240 | Opinions, news headlines, casual register | Year 1.0–1.4 |
| 3級 | Brown, black stripe | N3-B (N3 complete) | 3,700 / 650 / 300 | Native-speed daily conversation, manga/light novels with glossing | Year 1.4–1.8 |
| 2級 | Red | N2-A | 4,850 / 825 / 365 | Essays, workplace Japanese, nuance | Year 1.8–2.2 |
| 1級 | Red, black stripe | N2-B (N2 complete) | 6,000 / 1,000 / 430 | Newspapers, TV drama without subs | Year 2.2–2.6 |
| 初段 Shodan | Black | N1-A | 8,000 / 1,600 / 505 | Abstract/academic, literary register | Year 2.6–3.0 |
| 二段 Nidan | Black | N1-B (N1 complete, all 2,136 jōyō) | 10,000 / 2,136 / 580 | Anything written for adults | Year 3.0–3.4 |
| 三段 Sandan | Black | **Keigo & Business**: sonkeigo/kenjōgo/teineigo, emails, meetings, phone | +600 set phrases | Work in a Japanese office | +3 months |
| 四段 Yondan | Black | **Street**: casual contractions, slang, internet Japanese, onomatopoeia (300), youth speech, gendered/role language | +1,200 | Banter, stream chat, variety TV | +3 months |
| 五段 Godan → title 師範 Shihan | Black, gold | **Breadth**: dialect awareness (Kansai, Tōhoku, Kyūshū, Hokkaidō, Okinawan intro), yojijukugo (200), proverbs, rakugo/humor, classical fragments | +800 | Cultural fluency | +4 months |

### 4.3 Shinsa (審査, the grading exam)

- 40 items, mixed types (10 vocab, 8 kanji, 8 grammar transform, 6 listening dictation, 4 reading comprehension, 4 speaking or fallback typing), drawn only from the rank's block. No hints, no furigana (from 7級 up), 20 s soft timer per item (no fail on timeout, just no speed bonus).
- Pass: ≥ 80%. **Prerequisites to sit:** ≥ 90% of the block's items at mastery tier *Tempered* or higher (see §5.2), all block lessons completed.
- Cooldown on fail: 12 hours, with a generated "Weak Points" kata built from the missed items. Fail copy: "Not yet. The gate will still be here."
- First-try pass: +100 XP bonus and progress toward the *Boss Rush* wallpaper.

### 4.4 The Rank Ceremony (12 s, skippable)

1. Screen dims to sumi; UI chrome slides out. (0–1 s)
2. Three taiko hits; on each hit a vermilion ink splash blooms (radial gradient + feTurbulence displacement). (1–4 s)
3. The rank kanji (e.g., 七級) is **brush-written stroke by stroke** using `stroke-dasharray` animation on Yuji Syuku glyph outlines converted to paths at build time, with bristle texture via feDisplacementMap. (4–8 s)
4. The belt: a woven SVG band (pattern of diagonal rects) in the new color ties itself with a knot animation (two Bezier paths morphing). (8–10 s)
5. Hanko stamp: the learner's name-seal slams down at ~-6° rotation with a thump, ink bleeds. (10–11 s)
6. The new wallpaper's thumbnail rises out of the ink like a card draw, with wind chime. "Gallery に追加" (11–12 s)
7. Return to the Rank screen, where the next torii on the path is now vermilion.

### 4.5 XP economy

| Action | XP |
|---|---|
| New item first exposure completed | 8 |
| Review (any grade; effort is paid, accuracy goes to the SRS, not to XP) | 2 (Again = 1) |
| Lesson (Kata) complete | 30 (+10 if zero misses) |
| Graded reading passage | 20 + 1 per 100 characters; +5 per comprehension question |
| Listening dictation sentence | 4 (×1.25 at speed ≥ 1.0) |
| Speaking utterance ≥ 70% similarity | 3 (5 at ≥ 90%) |
| Randori free writing | 15 |
| Shinsa pass | 300 (+100 first try) |
| Daily goal reached | 25; 5-of-7 week: 100 |
| Combo multiplier (drills/reviews only) | 5+ ×1.1, 10+ ×1.25, 20+ ×1.5; combo bonus XP capped at 300/session |

**Level curve:** `xpToNext(L) = 60 + 10·L + 0.5·L²`

| Level | Cumulative XP | ≈ at 150–200 XP/day |
|---|---|---|
| 10 | 1,132 | 1 week |
| 20 | 4,275 | 3–4 weeks |
| 30 | 10,367 | 2 months |
| 50 | 35,402 | 6–7 months |
| 70 | 84,237 | 14–16 months |
| 99 | 213,664 | ~3 years (aligns with N1) |

### 4.6 The daily loop: TSUZUKU 続く

- **Daily targets** (selectable, persisted): 稽古 *Keiko* 75 XP (~8 min), 修行 *Shugyō* 150 XP (~15–20 min, default), 気合 *Kiai* 300 XP (~35 min).
- **A streak day counts if** the learner reaches 75 XP **or** clears all due reviews. So a 5-minute review day on a busy day keeps the chain.
- **Forgiveness, built in:**
  - **Freeze tokens** (氷 *kōri*): earn 1 per 7 streak days, bank up to 3. Auto-consumed on a missed day. Using one earns a badge (*Rest Is Training*), not a scolding.
  - **Ember state** (残り火): with no tokens, a missed day does *not* reset. The streak flame turns to embers for 48 hours; completing one normal session (150 XP) restores it fully.
  - Two missed days beyond Ember: streak resets, but **Longest Streak** is permanent, and the *Continue?* wallpaper rewards coming back.
- **No notifications by default.** Optional local Web Notifications, single daily reminder at a chosen time, phrased neutrally ("The dojo is open.").
- **The end card.** Every session ends on a black card with 続く in Yuji Syuku and a *next-episode preview*: three items from tomorrow's lesson shown as silhouettes (vocab blurred, kanji as component outlines). Anticipation, not fear.

---

## 5. The Shugyō Method (Pedagogy)

### 5.1 What produces fluency, and how each requirement maps to a system

| Principle | System | Specifics |
|---|---|---|
| Spaced retrieval | **Hyakuren Forge** (FSRS-4.5) | Every learnable item (kana, vocab, kanji, grammar pattern, sentence cloze, listening chunk, speaking phrase) is a card. Default weights `w[0..16]` from FSRS-4.5, desired retention 0.90 (settable 0.85–0.95), interval fuzz ±5%, max interval 365 d. Learning steps 1 m / 10 m within session; relearning step 10 m. Four grades: Again / Hard / Good / Easy. |
| Comprehensible input | **Dialogues & Makimono** | Every lesson opens with a 6–10 line dialogue with TTS, written to i+1 (writers tag required item IDs; app verifies ≥ 92% known before showing unglossed). |
| Testing effect | **力試し Chikaradameshi ("Try first")** | Each lesson begins with 3 items *before* teaching. Getting them wrong is expected and copy says so. The shonen move: fight the boss, then train. |
| Output | **Randori + typing with kana IME + speaking** | See exercise specs. |
| Interleaving | **Session Composer** | Reviews mix item types by round-robin; new lessons never introduce >1 grammar point; skill rotation guarantees reading, listening, and speaking each appear ≥ 2×/week. |
| Patterns + concise grammar | **Kata** | Grammar is taught as a pattern slot `[Aは Bが 好き]`, 3 example sentences, then an explanation capped at 120 words, then a transform drill. |
| Kanji by components | **Component Assembly** | Each kanji lists components (from a 214-radical + 300 common-component table) with a mnemonic; the drill is assembling the kanji from component tiles. Stroke order shown as stroke count + component order (no external stroke data required; optional opt-in dataset slot with attribution). |
| Pitch accent awareness | `accent` field on vocab | Rendered as a pitch line over kana (heiban/atamadaka/nakadaka/odaka). Drill: tap the correct contour. TTS cannot guarantee pitch, so the visual carries it. |
| Variable-speed listening | speechSynthesis | Rates 0.7 / 0.85 / 1.0 / 1.15 / 1.3. Voice picker filters `lang === 'ja-JP'`; if none, a clear banner explains how to install one (OS-level) and audio exercises fall back to text. |
| Steady progression | Rank gating + daily new-item caps | New items/day default: 12 vocab, 3 kanji, 1 grammar (scales with rank; user-adjustable 5–25 vocab). New items pause automatically when due backlog > 200. |

### 5.2 Mastery tiers (the Forge metaphor, derived from FSRS stability S)

| Tier | Stability | Visual |
|---|---|---|
| 荒 Raw | new | grey ingot |
| 熱 Heated | S < 1 d | orange glow |
| 鍛 Hammered | 1–7 d | dull steel |
| 焼 Tempered | 7–30 d | blue-steel sheen |
| 磨 Polished | 30–120 d | mirror |
| 名刀 Masterwork | ≥ 120 d | gold edge, hitodama flame on the shrine |

"Known" for coverage calculations = Hammered or above. "Mastered" for wallpaper personalization and badges = Tempered or above.

### 5.3 Session Composer algorithm

1. Compute due cards; if due > 200 → **Comeback Forge** mode: sort by retrievability ascending, show 50-card chunks, no new items, encouraging copy, award *Comeback Forge* badge on clearing.
2. Build session to target XP: ~60% reviews (interleaved by type), ~25% new lesson (one Kata), ~15% skill block (rotating: Mon Reading, Tue Listening, Wed Speaking, Thu Reading, Fri Listening, Sat Speaking, Sun Randori; shifted to the learner's actual active days).
3. Insert a *Gojūon Fighter* round as a 60-second warm-up for 10–9級 learners.
4. End with TSUZUKU card.

### 5.4 Romaji → kana IME (custom, ~150 lines, Vitest-covered)

- Live conversion as you type; standard Hepburn + common variants (`si/shi`, `tu/tsu`, `hu/fu`, `zi/ji`, `dzu/du`).
- `nn` or `n'` → ん; `n` followed by consonant → ん; `n` followed by vowel/y → waits.
- Doubled consonant → っ; `xtsu/ltsu` → っ; `xya/lya` → ゃ etc.; `-` → ー.
- Shift or a toggle switches hiragana/katakana output.
- Grading accepts: exact kana, the kanji surface form, or any listed `altAnswers`. Small-kana errors (っ/つ, ゃ/や) and long-vowel errors get a yellow "almost" state with the correction shown; counted as Hard, not Again.

### 5.5 Speaking scoring (Chromium only; graceful degradation)

- `webkitSpeechRecognition`, `lang='ja-JP'`, `maxAlternatives=3`, `interimResults=false`.
- Normalize recognized text and expected text (katakana→hiragana, strip punctuation/spaces); compute `1 − levenshtein / max(len)` against both the expected surface and the expected kana reading; take the best of 3 alternatives.
- ≥ 0.9 "Kiai!" (green), ≥ 0.7 pass (cyan), else "Again" with the TTS model replayed at 0.85×.
- Non-Chromium: offer **Shadow mode** (MediaRecorder records you, plays model then you back-to-back, you self-grade on a 3-point scale) or **skip** with no penalty. Speaking badges have shadow-mode equivalents so no platform is locked out.

---

## 6. Exercise Types (exact interaction specs)

| # | Name (JP) | Input | Interaction | Scoring → SRS grade | XP |
|---|---|---|---|---|---|
| 1 | **Gojūon Fighter** 五十音 | Keyboard romaji; mobile 4 buttons | Kana flies in from the right like an incoming attack; type its romaji before it reaches your side (3.5 s at start, tightens to 1.5 s). Health bars for you and the "rival". 46 kana per round. | Hit = Good; hit under 1 s = Easy; miss = Again | 1 per hit, round clear 15 |
| 2 | **Recognition** 認識 | Tap/number keys 1–4 | 4-choice; distractors chosen by shared reading, shared component, or same lesson. Prompt may be JP→EN, EN→JP, kanji→reading, audio→text. | Correct = Good (Easy if < 2 s); wrong = Again | 2 |
| 3 | **Cloze Typing** 穴埋め | Kana IME text field | Sentence with a blank; TTS plays whole sentence first. Hint button reveals first mora (grade capped at Hard). | Exact = Good/Easy (self-select after reveal); almost = Hard; wrong = Again | 2 |
| 4 | **Sentence Builder** 並べ替え | Tap/drag tiles | Scrambled word tiles (particles as separate tiles) → build the sentence to match the English/audio. Tiles snap; wrong order shakes. | Correct first try = Good; after 1 fix = Hard; else Again | 2 |
| 5 | **Dictation** 書き取り | Kana IME | Hear sentence at chosen speed (replay ≤ 3×). Type it. Diff view highlights per mora. | ≥ 95% mora match = Good; 80–95 = Hard; else Again | 4 (×1.25 at ≥ 1.0×) |
| 6 | **Shadowing** シャドーイング | Microphone | Model plays; you speak over/after it; recognition or self-grade. 5 reps per phrase. | Per §5.5 | 3–5 per rep |
| 7 | **Speak the Answer** 答えて | Microphone | Question in JP via TTS; you answer freely; app checks for required pattern/particle in transcript. | Contains target pattern = Good | 5 |
| 8 | **Component Assembly** 部首組み立て | Drag/tap | Kanji frame with silhouette slots; drag component tiles into position (left/right/top/bottom/enclosure). Mnemonic appears on completion. | Correct = Good; used hint = Hard | 2 |
| 9 | **Kanji Reading** 読み | Kana IME | Kanji in a sentence context; type the reading. Context disambiguates on/kun. | As cloze | 2 |
| 10 | **Pitch Tap** 高低 | Tap one of 2–4 contour cards | Hear word; choose pitch contour drawn as a line over kana. | Correct = Good | 2 |
| 11 | **Makimono Reading** 巻物 | Tap to gloss, scroll | i+1 passage (150–600 chars). Tap any word → gloss popover + "add to forge" (if not already a card). 3 comprehension MCQs. Gloss taps logged. | Reading itself not graded; each tapped word's card gets Hard | 20 + 1/100 chars + 5/Q |
| 12 | **Kata Transform** 型 | Kana IME | "Make it negative past / te-form / polite / causative…" of a given sentence. 8 per drill. | As cloze | 2, drill +10 if flawless |
| 13 | **Randori** 乱取り | Textarea with IME | Prompt (image-free, text): "Describe your morning using 〜てから." Write 1–3 sentences. Submit → app highlights whether target pattern appears, shows 2 model answers, learner self-rates (3 scale). Saved as a *tanzaku* for the Tanabata wallpaper. | Not SRS; pattern card gets Good if used | 15 |
| 14 | **Shinsa** 審査 | Mixed | Per §4.3 | Items feed SRS normally | 300/400 |
| 15 | **Translate** 翻訳 | Builder (EN→JP) or typing (JP→EN with fuzzy match on keywords) | Keyword-based acceptance for JP→EN (`acceptKeywords`), tile builder for EN→JP | Good/Again | 2 |

---

## 7. Badges (the 紋 *Mon* System)

**Iconography.** Every badge is a circular family-crest-style emblem rendered from a declarative spec: a ring style, a field shape, a glyph (one kanji or a primitive), and one accent token on sumi. Tiers are expressed by ring: **Bronze** (copper `#B87333`, single ring), **Silver** (`#C9CED6`, double ring), **Gold** (`--kin`, double ring + 16 short rays). Earning = hanko stamp animation (slam at −6°, ink bleed via feTurbulence + feDisplacementMap, thump sound). Unearned badges are visible as grey stone outlines with the condition shown. No hidden badges: transparency is part of the ethics.

```ts
interface BadgeIconSpec { ring: 'single'|'double'|'rays'; field: 'circle'|'hexagon'|'tomoe'|'square'|'petal'; glyph: string; accent: ColorToken; }
```

| # | ID | Name | 和名 | Glyph | Tier | Unlock condition |
|---|---|---|---|---|---|---|
| 1 | kana.first | First Breath | 初声 | あ | Bronze | Learn the あ-row |
| 2 | kana.hira | Hiragana Kaiden | 平仮名皆伝 | ひ in 5×10 dot grid | Silver | All 46 hiragana ≥ Hammered |
| 3 | kana.kata | Katakana Kaiden | 片仮名皆伝 | カ | Silver | All 46 katakana ≥ Hammered |
| 4 | kana.dakuten | Voiced | 濁点 | ゛ | Bronze | All dakuten/handakuten kana ≥ Hammered |
| 5 | kana.sokuon | Small Tsu Hunter | 促音 | っ | Bronze | 50 correct dictation items containing っ |
| 6 | kana.perfect | Perfect Round | 完全 | ☆ | Gold | Gojūon Fighter: 46/46, zero misses, < 60 s |
| 7 | forge.first | First Forge | 初鍛 | 鍛 | Bronze | Complete first review session |
| 8 | forge.100day | Hundred Forgings | 百錬 | 百 | Silver | 100 reviews in one day |
| 9 | forge.1k | Thousand Hammers | 千本 | 千 | Silver | 1,000 lifetime reviews |
| 10 | forge.10k | Ten Thousand | 万 | 万 | Gold | 10,000 lifetime reviews |
| 11 | forge.meito | Masterwork | 名刀 | 刀 | Bronze | First item reaches Masterwork tier |
| 12 | forge.meito100 | Hundred Blades | 百名刀 | 刀 w/ rays | Gold | 100 Masterwork items |
| 13 | forge.clear7 | Clean Anvil | 皆無 | ○ | Silver | Clear all due reviews 7 consecutive active days |
| 14 | forge.comeback | Comeback Forge | 再鍛 | 再 | Silver | Clear a backlog of ≥ 200 due cards |
| 15 | streak.3 | To Be Continued | 続く | 続 | Bronze | 3-day streak |
| 16 | streak.7 | One Week Arc | 一週 | 週 | Bronze | 7-day streak |
| 17 | streak.30 | Full Cour | 三十話 | 話 | Silver | 30-day streak |
| 18 | streak.100 | Hundred-Day Training | 百日修行 | 修 | Gold | 100-day streak |
| 19 | streak.365 | One Year | 一年 | 年 | Gold | 365-day streak |
| 20 | streak.rest | Rest Is Training | 休むも修行 | 休 | Bronze | Use a freeze token |
| 21 | streak.ember | Ember Keeper | 残り火 | 火 | Silver | Restore a streak from Ember state |
| 22 | kanji.first | One | 一 | 一 | Bronze | Learn 一 |
| 23 | kanji.radicals | Radical Thinker | 部首 | 部 | Bronze | 50 components learned |
| 24 | kanji.100 | Hundred Characters | 百字 | 字 | Silver | 100 kanji ≥ Hammered |
| 25 | kanji.500 | Five Hundred | 五百字 | 字 | Silver | 500 kanji |
| 26 | kanji.1000 | Thousand Characters | 千字 | 字 | Gold | 1,000 kanji |
| 27 | kanji.joyo | Jōyō Complete | 常用 | 常 | Gold | All 2,136 jōyō ≥ Tempered |
| 28 | kanji.sleuth | Component Sleuth | 偏旁 | 偏 | Silver | 100 correct component assemblies |
| 29 | gram.particles | Particle Whisperer | 助詞 | は | Silver | ≥ 95% on 200 particle cloze items |
| 30 | gram.te | Te-Form Tamer | て形 | て | Bronze | All te-form conjugation cards ≥ Tempered |
| 31 | gram.100 | Hundred Patterns | 文型百 | 型 | Silver | 100 grammar patterns ≥ Tempered |
| 32 | gram.keigo | Keigo Initiate | 敬語 | 敬 | Gold | Complete Keigo module (Sandan) |
| 33 | gram.pitch | Pitch Perfect | 高低 | ⌒ | Silver | 200 pitch-tap items at ≥ 90% |
| 34 | read.first | First Scroll | 初巻 | 巻 | Bronze | Finish first Makimono |
| 35 | read.50 | Bookworm | 本の虫 | 本 | Silver | 50 passages |
| 36 | read.100k | Hundred Thousand Characters | 十万字 | 読 | Gold | 100,000 characters read |
| 37 | read.nogloss | Dictionary-Free | 辞書要らず | 辞 | Silver | Finish a passage ≥ 300 chars with zero gloss taps |
| 38 | listen.native | Native Speed | 等速 | 速 | Silver | 100 dictations correct at 1.0× |
| 39 | listen.fast | Fast Forward | 早送り | ≫ | Gold | 50 dictations correct at ≥ 1.15× |
| 40 | listen.shadow | Shadow Walker | 影 | 影 | Silver | 500 shadowing reps |
| 41 | speak.first | First Words | 初言葉 | 言 | Bronze | First utterance recognized or shadow-graded |
| 42 | speak.kiai | Kiai! | 気合 | 気 | Silver | 100 utterances ≥ 90% |
| 43 | speak.1k | Tongue of Steel | 鋼の舌 | 舌 | Gold | 1,000 utterances |
| 44 | arcade.combo20 | Twenty Hit | 連撃 | 連 | Bronze | 20-hit combo |
| 45 | arcade.combo50 | Fifty Hit | 五十連 | 連 w/ rays | Silver | 50-hit combo |
| 46 | rank.flawless | Perfect Victory | 完全勝利 | 勝 | Gold | 100% on any Shinsa |
| 47 | rank.shodan | Shodan | 初段 | 段 | Gold | Reach 初段 |
| 48 | rank.shihan | Shihan | 師範 | 師 | Gold | Reach 五段 |
| 49 | meta.randori10 | Ten Randori | 乱取り | 乱 | Bronze | 10 free-writing submissions |
| 50 | meta.onomat | Sound Words | 擬音 | ド | Silver | 100 onomatopoeia ≥ Tempered |
| 51 | meta.dialect | Archipelago | 方言 | 方 | Gold | Complete dialect module |
| 52 | meta.collector | Collector | 蒐集家 | 蒐 | Silver | 12 wallpapers unlocked |
| 53 | meta.curator | Curator | 館長 | 館 | Gold | All wallpapers unlocked |
| 54 | meta.archivist | Archivist | 保存 | 保 | Bronze | Export a backup JSON (we reward protecting your own data) |
| 55 | meta.asageiko | Morning Practice | 朝稽古 | 朝 | Bronze | 10 sessions started before 08:00 local |

---

## 8. The Wallpaper Collection (言霊の掛け軸: 30 pieces)

### 8.1 System rules

- **Every piece is generated at runtime** as an SVG document (with optional Canvas pre-pass for pixel pieces), seeded by `hash(learnerName + unlockISODate + wallpaperId + reforgeCount)`. Two learners never receive the same image.
- **Personalization slots** are declared per wallpaper (`name`, `nameKatakana`, `rankKanji`, `level`, `streak`, `masteredWords[n]`, `knownKanji[]`, `sentence`, `tanzaku[]`, `badges[]`, `dateJP`). Missing data degrades gracefully (fewer petals, fewer signs).
- **Formats:** Desktop 16:9 at 3840×2160, Phone 9:19.5 at 1170×2535. Phone compositions respect a top 22% "clock safe zone" and keep text in the lower third.
- **Export pipeline:** build SVG string → `Blob` → `Image` → `canvas.drawImage` at target resolution → **text layer drawn with Canvas 2D** (`document.fonts.load` first; SVG `<text>` is used only for preview, because fonts don't load inside an `<img>`-rendered SVG) → `canvas.toBlob('image/png')` → download `kotodama-<id>-<aspect>.png`. No `<foreignObject>` (would taint the canvas).
- **Gallery:** unlocked pieces display live with gentle parallax (mouse / `deviceorientation`). "Reforge" regenerates the seed freely (not scarce, not gambled: the image is always the same concept, only the organic details shift). "Set as Dojo background" uses it behind the home shrine.
- **Locked pieces** show a sumi silhouette thumbnail and the exact unlock condition. Nothing hidden, nothing timed.

### 8.2 Shared generative toolkit

Seeded PRNG (mulberry32); 2-D value noise + fBm (3–5 octaves) for flow fields, terrain, clouds; curl of noise for petals/koi; Catmull-Rom → Bezier spines; variable-width brush ribbons (polygon from spine ± width(t) with noise); SVG filters: `feTurbulence` (paper grain, mist, ink bleed), `feDisplacementMap` (bristle, wobble), `feGaussianBlur` + `feColorMatrix` threshold (metaballs, neon glow), `feMorphology`; ordered Bayer dithering for pixel skies; recursive subdivision for manga panels; log-spiral curls for waves; symmetric random bit-grids for pixel "guardian" sprites; midpoint displacement for lightning; `<pattern>` for halftone, seigaiha waves, asanoha, scanlines.

### 8.3 The pieces

**W01 初日の道場 — First Light Dojo**
Unlock: all 46 hiragana ≥ Hammered. *Milestone: you can read.*
Concept: a pixel dojo at dawn on a hill, 46 paper lanterns hanging from its eaves, each bearing one hiragana.
Palette: indigo `#1F2A6B` → peach `#F7B2C4` sky, dojo in `#3A2A2A` / `--washi`, lantern glow `#FFD166`.
Technique: Canvas pre-pass on a 240×135 virtual grid (phone: 117×254), Bayer 4×4 dithered sky, procedural pixel building (roof trapezoid, pillars, noren curtain), upscaled with `imageSmoothingEnabled=false`. Lanterns drawn in DotGothic16 on the text pass.
Personalization: name in katakana on the noren; lanterns you answered fastest in Gojūon Fighter glow brightest.

**W02 五十音セレクト — Gojūon Select**
Unlock: 9級 (all kana). *Milestone: the alphabet is yours.*
Concept: an arcade character-select screen; the full 10×5 kana grid as neon tiles, a blinking cursor on your "rival" (slowest kana).
Palette: `--sumi`, `--neon-c`, `--neon-m`, tile heat from cyan (fast) to magenta (slow).
Technique: SVG rects with duplicated blurred strokes (feGaussianBlur σ=6) for glow, scanline `<pattern>` overlay, 1px chromatic aberration (three offset copies in screen blend).
Personalization: heatmap is your actual reaction-time data; header reads `PLAYER: <NAME>  RANK 9級`.

**W03 千本鳥居 — Thousand Torii**
Unlock: 8級. *Milestone: N5 halfway; vocabulary becomes a path.*
Concept: a tunnel of vermilion torii receding to a sun disc.
Palette: `--shu`, `--sumi`, `--kin`, mist `#E8DCC8`.
Technique: torii *i* scaled by `1/(1+0.18i)` toward the vanishing point, `count = clamp(vocabKnown, 50, 300)`; mist via feTurbulence composited with a depth gradient; sun as radial gradient.
Personalization: nearest crossbeam carries your name; torii count is your known vocabulary.

**W04 桜吹雪 — Sakura Blizzard**
Unlock: 7-day streak. *Milestone: a week of showing up.*
Concept: a petal storm at dusk over a distant pagoda silhouette.
Palette: `--sakura`, `#FFE3EA`, dusk `#2B1F4A` → `#E07A8C`.
Technique: 5-lobed petal path; `n = reviewsThisWeek` (cap 600) placed along a curl-noise flow field; depth → scale and blur (3 blur layers); pagoda as stacked trapezoids.
Personalization: a single tanzaku in the corner reads `7日 連続` plus date.

**W05 ネオン横丁 — Neon Alley**
Unlock: 100 vocab ≥ Tempered. *Milestone: your first hundred words.*
Concept: a rain-slick synthwave alley; every sign is one of your mastered words.
Palette: `--neon-m`, `--neon-c`, `#FFD166`, `--sumi`.
Technique: one-point perspective; 14–24 sign rects; text in Dela Gothic One with blurred twin for glow; seeded per-glyph flicker (opacity 0.4 on 1–2 glyphs); ground reflection = vertical flip, 35% opacity, feDisplacementMap with vertical turbulence.
Personalization: the signs are literally your words; the biggest sign is your most-reviewed word.

**W06 画素の塔 — Pixel Pagoda**
Unlock: 7級 (N5 complete). *Milestone: first JLPT level done.*
Concept: isometric pixel pagoda, one tier per rank earned, under pixel stars.
Palette: tiers in the belt colors you have earned, night `#0E1230`, moon `--washi`.
Technique: Canvas isometric tiles (2:1 diamonds), tier count = ranks earned (max 15), star field via seeded points, crescent moon.
Personalization: a pixel banner shows `Lv.<level>`; tier colors are your belt history.

**W07 墨龍 — Sumi Dragon**
Unlock: 30-day streak. *Milestone: a full month.*
Concept: a single ink dragon coiling across washi, one body segment per day of streak.
Palette: `--sumi` on `--washi`, one `--shu` seal.
Technique: spine = Catmull-Rom through 12 noise-perturbed anchors; width envelope `w(t)=W·sin(πt)^0.6`; bristle via feTurbulence displacement + feMorphology erode; scales as repeated crescent paths along the spine; whiskers/claws as Beziers. Segment count = streak days (30–365).
Personalization: the seal is your initials rendered in a procedural seal-script frame.

**W08 漢字星座 — Kanji Constellations**
Unlock: 100 kanji ≥ Hammered. *Milestone: the stars have names.*
Concept: your kanji as stars; lines connect kanji sharing a component, forming constellations.
Palette: `#0A0F2E`, star `#CFE7FF`, `--kin` for Masterwork kanji.
Technique: positions from seeded hash with Poisson-disc relaxation; edge list from component table (max degree 4); brightness = FSRS stability; Milky Way = wide fBm band at 20% opacity.
Personalization: constellation labels are your three most common components (e.g., 氵, 木, 口).

**W09 コンティニュー？ — Continue?**
Unlock: restore a streak from Ember, or return after ≥ 14 days away. *Milestone: coming back.*
Concept: a CRT showing `CONTINUE? 9` and a high-score table with your name on top. The game waited.
Palette: phosphor amber `#FFB000` or green `#33FF66` (seeded), bezel `#2A2A2E`.
Technique: bezel path with inner shadow; screen barrel distortion via radial feDisplacementMap; scanline pattern; chromatic offset; text in Press Start 2P.
Personalization: `1ST  <NAME>  <XP>`; the countdown digit is your freeze-token count +1 (max 9).

**W10 月下の浪人 — Rōnin Under Moon**
Unlock: 6級. *Milestone: N4 begins; you can tell a story.*
Concept: a lone figure with a sword on a grass hill under a giant moon; a mastered sentence written vertically.
Palette: `#0E1230`, moon `#F2E9D0`, hill `#1B1F3B`, grass `#2A3356`.
Technique: moon craters = thresholded feTurbulence masked to a circle; hill = fBm height curve; figure = parametric silhouette (hat ellipse, cloak polygon, blade line) with seeded pose; grass = 300 sine-swayed strokes.
Personalization: tategaki column = the sentence you most recently brought to Tempered.

**W11 浮世の山 — Floating-World Mountain**
Unlock: 1,000 vocab ≥ Hammered. *Milestone: a thousand words.*
Concept: an original woodblock-print mountain in six flat color layers with deliberate print misregistration.
Palette: `--kōn`, `--washi`, `#B8322B`, `--kin`, `#6C8EBF`.
Technique: layers (sky bands, clouds, peak + snowcap, foothills, pines, river) as noise-shaped paths; each color layer offset by a seeded 2–6 px (the *kento* slip); paper grain via low-opacity feTurbulence.
Personalization: cloud count = months active; a cartouche in the corner carries name + date in the Japanese era format.

**W12 錦鯉 — Nishikigoi**
Unlock: 5級 (N4 complete). *Milestone: second JLPT level.*
Concept: a top-down pond; koi glide along currents, one koi per 50 kanji known.
Palette: water `#0F3B3A`, koi `--washi` / `--shu` / `--kin` / `--sumi`.
Technique: koi body = tapered Bezier ribbon along a flow-field streamline; color patches via noise mask; ripple rings around each head; lily pads as notched circles.
Personalization: koi count and colors come from your kanji count and belt history.

**W13 太鼓 — Taiko Thunder**
Unlock: 4級. *Milestone: N3 begins; real conversation.*
Concept: a giant drum face, shockwave rings, lightning.
Palette: `#1A0B0B`, `--shu`, lightning `#FFF4D6`.
Technique: concentric rings with stroke width decaying by `1/r`; lightning via midpoint displacement (depth 7); rain streaks as thin diagonal lines.
Personalization: drumhead carries your rank kanji 四級 in Yuji Syuku.

**W14 障子 — Shōji Light**
Unlock: 100 grammar patterns ≥ Tempered. *Milestone: grammar is structure, not rules.*
Concept: warm light through paper screens; bamboo shadows; your grammar patterns written faintly on the panels.
Palette: `#F7EFDF`, lattice `#D9C9A8`, shadow `#2B2B2B` at 35%.
Technique: grid lattice; bamboo = noise-swayed vertical strokes with leaf polygons, rendered as a shadow layer with blur σ=4; pattern text at 8% opacity.
Personalization: the written patterns are your 100.

**W15 大波 — Rising Tide**
Unlock: 10,000 lifetime reviews. *Milestone: the forge has struck ten thousand times.*
Concept: a towering woodblock wave with foam claws; a small boat with your name on the sail.
Palette: `--kōn`, `#2F5FB8`, `--washi`, foam `#FFFFFF`.
Technique: crest from logarithmic spiral `r = a·e^(bθ)`; claws as clusters of circles along the crest; water bands as layered noise curves.
Personalization: sail text; wave count = thousands of reviews (10).

**W16 自販機の夜 — Vending Machine Night**
Unlock: 3級 (N3 complete). *Milestone: third JLPT level.*
Concept: a glowing vending machine in rain; the cans are labeled with your words.
Palette: `--sumi`, glow `#FFD166`, `--neon-c`, rain `#6C7A99`.
Technique: machine as rounded rect with inner glow; 12 can rects with product text; rain = 400 short lines; puddle reflection as in W05.
Personalization: can labels are your most recent N3 vocabulary.

**W17 修行の回 — Training Arc, Episode 100**
Unlock: 100-day streak. *Milestone: a hundred days.*
Concept: a manga page: speed lines, halftone, and onomatopoeia you actually learned.
Palette: monochrome + one `--shu` accent.
Technique: panels via recursive subdivision (4–6 panels, 3 px gutters); radial speed lines clipped per panel; halftone `<pattern>` with dot radius driven by gradient; SFX text in Rampart One/Reggae One at seeded rotations.
Personalization: title block `第100話「<NAME>」`; SFX words drawn from your learned giongo/gitaigo.

**W18 七夕 — Tanabata**
Unlock: 365 total active days (not consecutive). *Milestone: a year in the dojo.*
Concept: bamboo under the Milky Way; tanzaku strips carry sentences you wrote in Randori.
Palette: `#10172E`, bamboo `--matcha`, strips `--shu` / `--kin` / `--neon-c` / `--sakura` / `#FFFFFF`.
Technique: bamboo stalks as segmented paths with nodes; strips as rotated rects with string lines; fBm band for Amanogawa.
Personalization: up to 24 of your own sentences, truncated to 14 characters.

**W19 始発 — First Train**
Unlock: 1,000 listening items correct at ≥ 1.0×. *Milestone: native speed.*
Concept: a streamlined train streaking through dawn; a destination board with your level.
Palette: `--sakura`, `#FFD166`, `#FFFFFF`, `--ai`.
Technique: train silhouette (original, long nose ellipse + body); horizontal-only feGaussianBlur (stdDeviation "18 0") on a copy; speed lines; gradient sky.
Personalization: board text `Lv.<level>  次は → <next rank>`.

**W20 狐火 — Kitsune Fire**
Unlock: 2級. *Milestone: N2 begins.*
Concept: foxfire flames in a dark forest; a fox mask whose markings are the strokes of your name's first katakana.
Palette: `#0B1A14`, fire `--neon-c` → `--matcha`, mask `--washi`, markings `--shu`.
Technique: metaballs = circles → feGaussianBlur σ=20 → feColorMatrix alpha threshold; forest = layered noise silhouettes; mask = symmetric polygon.
Personalization: mask markings derived from your name.

**W21 湯気 — Ramen Steam**
Unlock: 500 speaking utterances ≥ 70% (or 500 shadow reps). *Milestone: you have spoken.*
Concept: a top-down bowl, steam, and a menu board listing phrases you have said aloud.
Palette: `--washi`, `--shu`, `--kin`, `#2B2B2B`.
Technique: steam = 8 Bezier curves displaced by animated-at-preview/static-on-export feTurbulence; ingredients as flat shapes; menu text in Yuji Syuku.
Personalization: the menu is your spoken phrases.

**W22 判子の庭 — Hanko Garden**
Unlock: 40 badges. *Milestone: a wall of seals.*
Concept: all your badge crests pressed in vermilion ink on washi, some partial, some bleeding.
Palette: `--washi`, `--shu`, faint `--sumi`.
Technique: each badge's mon rendered as a seal, rotation ±8°, ink bleed via feTurbulence + feDisplacementMap, partial impressions via noise alpha mask.
Personalization: it is your badge set, in unlock order.

**W23 嵐の鳥居 — Storm Gate**
Unlock: 1級 (N2 complete). *Milestone: one gate before black.*
Concept: a single enormous torii in a sea storm, backlit by lightning, crows in the wind.
Palette: `--sumi`, `--shu`, `#FFF4D6`, `#4A5568`.
Technique: torii with wet highlight, rain at 20°, lightning midpoint displacement, spray as blurred circles, crows as 3-point polygons.
Personalization: the plaque on the gate reads 一級 and your name.

**W24 円相 — Enso**
Unlock: 初段 Shodan. *Milestone: black belt.*
Concept: one brush circle. Nothing else but your name, 初段, and a seal.
Palette: `--washi`, `--sumi`, `--kin` flecks.
Technique: ribbon polygon around a circle with pressure `w(θ)` from fBm, bristle gaps via noise mask, 30–60 ink splatter dots along the exit stroke; gold-leaf flecks as tiny irregular polygons.
Personalization: name + 初段 in Yuji Syuku, bottom right, with seal.

**W25 ボスラッシュ — Boss Rush**
Unlock: pass 5 Shinsa on first attempt. *Milestone: you walked through five gates without stumbling.*
Concept: a pixel hall of 15 gates, each with a procedurally generated guardian silhouette; defeated gates lit.
Palette: arcade `--neon-c`, `--neon-m`, `--kin`, `--sumi`.
Technique: guardians = 5×8 random bit-grids mirrored horizontally (classic sprite generation) with outline; lit gates have glow; dark gates desaturated.
Personalization: lit gates = ranks passed; first-try passes get a gold crown pixel.

**W26 方言列島 — Dialect Archipelago**
Unlock: complete dialect module. *Milestone: Japan is more than Tokyo.*
Concept: a stylized pixel archipelago with speech bubbles of regional phrases over seigaiha waves.
Palette: sea `--kōn`, land `--matcha`, bubbles `--washi`.
Technique: simplified island polygons (original abstractions), seigaiha `<pattern>`, bubble tails toward regions.
Personalization: bubbles show the dialect phrases you rated Easy.

**W27 金屏風 — Golden Screen**
Unlock: 三段 Sandan (Keigo). *Milestone: you can speak upward.*
Concept: a six-panel folding screen of gold leaf, stylized cloud bands, a flock of cranes.
Palette: `--kin` with seeded tonal variation per leaf square, `--sumi`, `--washi`.
Technique: leaf grid of 120×120 squares with ±6% luminance jitter and hairline seams; *suyari-gasumi* cloud bands; cranes as 6-point polygons in formation.
Personalization: a fuda on panel six reads a formal greeting with your name (`<NAME>様におかれましては…`).

**W28 深夜のコンビニ — Midnight Konbini**
Unlock: 四段 Yondan (Street). *Milestone: you can banter.*
Concept: an isometric pixel convenience store glowing at 2 a.m.; magazine covers bear your slang words; a moth circles the light.
Palette: `--sumi`, white light `#FFFFFF`, `--neon-c`, `--neon-m`.
Technique: isometric canvas tiles, window glow gradient, 6 magazine rects, moth path as Lissajous.
Personalization: magazine headlines are your slang/casual words.

**W29 万語の巻物 — Scroll of Ten Thousand Words**
Unlock: 10,000 vocab ≥ Hammered. *Milestone: the lexicon of an adult.*
Concept: an unrolled hand-scroll filled edge to edge with your words in tiny vertical columns.
Palette: `--washi`, `--sumi`, `--shu`, `--kin` brocade.
Technique: rollers with brocade `<pattern>` (asanoha), text columns at 11 px drawn in the canvas text pass (10,000 words across 16:9 at 3840 wide is feasible at ~9 px glyphs; phone variant shows a 2,000-word excerpt).
Personalization: every word is yours, in the order you learned them.

**W30 師範 — Shihan**
Unlock: 五段 Godan. *Milestone: the end of the path, which is the beginning.*
Concept: sunrise behind a mountain dojo; every previous motif appears as a small cameo (torii, koi, dragon, lanterns, train, konbini).
Palette: full system.
Technique: layered composite of W01–W29 sub-generators at cameo scale, unified by a single sunrise gradient and paper grain.
Personalization: all slots; the dojo noren reads 師範 <NAME>.

### 8.4 Unlock map at a glance

| Trigger type | Wallpapers |
|---|---|
| Rank | W02, W03, W06, W10, W12, W13, W16, W20, W23, W24, W27, W28, W30 |
| Streak / attendance | W04 (7), W07 (30), W17 (100), W18 (365 total), W09 (comeback) |
| Volume | W05 (100 vocab), W08 (100 kanji), W11 (1k vocab), W14 (100 grammar), W15 (10k reviews), W29 (10k vocab) |
| Skill | W19 (listening), W21 (speaking), W26 (dialects) |
| Meta | W01 (kana), W22 (badges), W25 (first-try exams) |

---

## 9. Milestone → Visual → Sound Matrix

| Learning milestone | What you see | What you hear | What you keep |
|---|---|---|---|
| Correct answer | Hanko-pulse on the item, combo tick | 90 ms arpeggio | +2 XP |
| 20-hit combo | Counter shakes, screen edges glow in category color | Tier-3 chord | Badge 連撃 |
| Lesson complete | Scroll rolls shut, seal stamped on the Scroll Card | Fanfare | +30 XP, items enter the Forge |
| Item reaches Masterwork | A new hitodama flame appears on the home Shrine | Wind chime (single) | Permanent flame |
| Daily goal | Flame on the TSUZUKU card brightens; next-episode preview | Koto pluck | Streak day |
| 7 / 30 / 100 day streak | Sakura / Dragon / Manga wallpaper unlock reveal | Wind chime | Wallpaper + badge |
| Level up | Status Window flashes, number rolls over in Dela Gothic One | 8-note fanfare | Lv |
| Shinsa pass | Full rank ceremony (§4.4) | Taiko + shakuhachi | Belt, rank kanji, wallpaper |
| Return after absence | "The dojo kept your place." Comeback Forge mode | Soft koto | Continue? wallpaper |
| Backup exported | Archivist seal | Stamp thump | Peace of mind |

---

## 10. Information Architecture (hash routes)

| Route | Screen | Notes |
|---|---|---|
| `#/` | **神社 Shrine** (home) | Spirit flames, Status Window (Lv, XP bar, rank belt, streak flame), Forge HP bar, today's session CTA (Hanko Button), tategaki sentence of the day |
| `#/train` | **修行 Today's Session** | Session Composer output; ends on TSUZUKU card |
| `#/forge` | **百錬 Forge** | Reviews only; shows tier distribution as a sword rack |
| `#/path` | **道 Path** | Vertical torii ladder of ranks; each block's lessons as Scroll Cards; Shinsa gate |
| `#/kanji` | **漢字** | Component tree, kanji grid colored by tier, assembly drill |
| `#/scrolls` | **巻物** | Makimono library filtered to ≥ 92% coverage, with "stretch" tab at 85–92% |
| `#/arcade` | **アーケード** | Gojūon Fighter, Pitch Tap, Dictation sprint, Combo mode |
| `#/badges` | **紋** | All 55 crests, earned/stone |
| `#/gallery` | **掛け軸 Gallery** | Wallpapers, preview, Reforge, download 16:9 / 9:19.5 |
| `#/settings` | 設定 | Theme, sound, daily target, new-items/day, retention, furigana, voice picker, speed, reduced motion, name |
| `#/backup` | 保存 | Export JSON (`kotodama-backup-YYYYMMDD.json`), import with schema validation and merge preview |

---

## 11. Data Schemas (TypeScript)

### 11.1 Content (static JSON under `/public/content`, 100–200 items per file, validated by zod at build and at load)

```ts
// /public/content/manifest.json
interface ContentManifest {
  schemaVersion: 1;
  packs: PackRef[];                // ordered
}
interface PackRef {
  id: string;                      // "vocab.n5.001"
  kind: 'kana'|'vocab'|'kanji'|'grammar'|'sentences'|'dialogues'|'readings'|'listening'|'speaking'|'lessons'|'components';
  level: 'kana'|'n5'|'n4'|'n3'|'n2'|'n1'|'keigo'|'street'|'breadth';
  file: string;                    // "vocab/n5/001.json"
  count: number;
  sha256?: string;
}

type Level = PackRef['level'];
type ItemId = string;              // "v:n5:0001", "k:n4:0120", "g:n3:0042", "s:n5:0300"

interface KanaItem {
  id: ItemId; kana: string; romaji: string[]; script: 'hiragana'|'katakana';
  row: string; type: 'basic'|'dakuten'|'handakuten'|'yoon'; mnemonic: string;
}

interface VocabItem {
  id: ItemId; level: Level;
  surface: string;                 // 食べる
  reading: string;                 // たべる (hiragana)
  pos: 'n'|'v1'|'v5'|'vs'|'vk'|'adj-i'|'adj-na'|'adv'|'prt'|'conj'|'expr'|'ctr'|'pn'|'num'|'onom';
  meanings: string[];              // ≤ 3, short
  accent: number | null;           // 0 heiban, 1 atamadaka, n = drop after mora n
  kanjiIds: ItemId[];
  examples: ItemId[];              // ≥ 2 sentence ids
  tags?: string[];                 // "food", "keigo", "kansai", "slang"
  notes?: string;                  // ≤ 160 chars
}

interface KanjiItem {
  id: ItemId; level: Level; char: string;
  on: string[]; kun: string[]; meanings: string[];
  strokes: number;
  components: string[];            // component ids, in assembly order
  layout: 'left-right'|'top-bottom'|'enclosure'|'single'|'other';
  mnemonic: string;                // ≤ 200 chars, must reference components
  vocabIds: ItemId[];              // ≥ 3
}

interface ComponentItem { id: string; glyph: string; name: string; meaning: string; mnemonic: string; }

interface GrammarPoint {
  id: ItemId; level: Level;
  pattern: string;                 // "〜てから"
  slot: string;                    // "[V-て]から [clause]"
  meaning: string;                 // ≤ 80 chars
  explanation: string;             // ≤ 120 words, plain English
  examples: ItemId[];              // ≥ 3
  contrastWith?: ItemId[];         // similar patterns
  register: 'neutral'|'polite'|'casual'|'formal'|'keigo'|'slang'|'dialect';
  transforms?: { prompt: string; from: ItemId; answer: string }[];
}

interface Sentence {
  id: ItemId; level: Level;
  ja: string; reading: string;     // reading as kana with spaces per word
  en: string;
  tokens: { surface: string; reading: string; vocabId?: ItemId; grammarId?: ItemId }[];
  cloze?: { tokenIndex: number; altAnswers?: string[] }[];
  acceptKeywords?: string[];       // for JP→EN fuzzy grading
  audioRate?: number;              // default 1.0
}

interface Dialogue {
  id: ItemId; level: Level; title: string; scene: string;
  lines: { speaker: 'A'|'B'|'C'; sentenceId: ItemId }[];
  requiredItems: ItemId[];         // for i+1 coverage check
}

interface ReadingPassage {
  id: ItemId; level: Level; title: string;
  paragraphs: ItemId[][];          // sentence ids per paragraph
  requiredItems: ItemId[];
  questions: { q: string; choices: string[]; answer: number }[];  // 3
  genre: 'daily'|'story'|'news'|'essay'|'dialogue'|'literary'|'business';
}

interface Lesson {
  id: string; level: Level; block: string;   // "n5-a"
  order: number; title: string;
  dialogueId: ItemId;
  grammarIds: ItemId[];            // exactly 1 (0 for kana lessons)
  vocabIds: ItemId[];              // 8–14
  kanjiIds: ItemId[];              // 0–4
  tryFirst: ItemId[];              // 3 items for Chikaradameshi
  drills: ExerciseType[];          // ordered
  cultureNote?: string;            // ≤ 120 words
}

type ExerciseType = 'gojuon'|'recognition'|'cloze'|'builder'|'dictation'|'shadowing'|'speak'|'assembly'|'kanjiReading'|'pitch'|'reading'|'transform'|'randori'|'shinsa'|'translate';

interface Rank {
  id: string; order: number;       // "kyu10"… "dan5"
  kanji: string; belt: string;     // color token
  block: string; shinsaPool: ItemId[]; masteryThreshold: number;  // 0.9
  wallpaperId: string;
}
```

**Writer rules for parallel AI content generation:** one pack = one `kind` + one `level` + ≤ 200 items; IDs are assigned from a reserved range per writer; all referenced IDs must exist in earlier-ordered packs or the same pack; no franchise names, character names, brand names, or real private persons; register tags mandatory from N3 up; every vocab has `accent` (use `null` if unknown, never guess); every sentence has `reading`; a CI script validates schema, ID references, i+1 coverage of dialogues/readings against the cumulative lexicon, and flags any Latin-script tokens.

### 11.2 Learner state (localStorage key `kotodama.v1`, debounced write 500 ms, export = same object)

```ts
interface LearnerState {
  schemaVersion: 1;
  profile: { name: string; nameKatakana: string; createdAt: string; theme: 'auto'|'night'|'morning'; };
  settings: Settings;
  xp: { total: number; level: number; byDay: Record<string, number> };   // "2026-10-16": 180
  rank: { current: string; history: { rankId: string; at: string; firstTry: boolean; score: number }[] };
  streak: { current: number; longest: number; lastActiveDay: string; freezeTokens: number; ember: { since: string } | null; activeDays: number };
  cards: Record<ItemId, SRSCard>;
  progress: { lessonsDone: string[]; passagesRead: string[]; charsRead: number; reviewsTotal: number; speaking: { utterances: number; kiai: number }; listening: { dictations: Record<string, number> }; combos: { best: number }; randori: { id: string; prompt: string; text: string; at: string }[] };
  badges: Record<string, { at: string }>;
  wallpapers: Record<string, { at: string; seed: number; reforges: number; favorite: boolean }>;
  stats: { kanaReaction: Record<string, number[]> };  // last 10 ms per kana
}

interface SRSCard {
  id: ItemId; kind: PackRef['kind'];
  due: string; stability: number; difficulty: number; elapsedDays: number; scheduledDays: number;
  reps: number; lapses: number; state: 'new'|'learning'|'review'|'relearning'; lastReview?: string;
}

interface Settings {
  dailyTarget: 75|150|300; newPerDay: { vocab: number; kanji: number; grammar: number };
  retention: number; furigana: 'always'|'hover'|'off'; sound: { enabled: boolean; volume: number };
  reducedMotion: boolean; crt: boolean; voiceURI?: string; speechRate: 0.7|0.85|1.0|1.15|1.3;
  speakingMode: 'auto'|'recognition'|'shadow'|'off'; notifications: { enabled: boolean; hour?: number };
}

interface WallpaperSpec {
  id: string; title: string; titleJa: string; unlock: UnlockRule;
  slots: ('name'|'nameKatakana'|'rankKanji'|'level'|'streak'|'masteredWords'|'knownKanji'|'sentence'|'tanzaku'|'badges'|'dateJP')[];
  render(ctx: WallpaperCtx, aspect: '16:9'|'9:19.5'): { svg: string; textLayer: TextOp[] };
}
type UnlockRule =
  | { type: 'rank'; rankId: string } | { type: 'streak'; days: number } | { type: 'activeDays'; days: number }
  | { type: 'count'; metric: 'vocabMastered'|'kanjiKnown'|'grammarMastered'|'reviews'|'vocabKnown'|'badges'|'listenNative'|'speakUtterances'|'firstTryShinsa'; n: number }
  | { type: 'event'; event: 'emberRestored'|'returnAfter14d'|'dialectModule'|'hiraganaComplete' };
```

---

## 12. Ethical Gamification Charter (shipped in-app under Settings → 道場の掟)

1. No purchases, no currency, no loot boxes, no randomized rewards. Reforge changes details, never value.
2. Every unlock condition is visible from day one.
3. Streaks forgive: tokens, Ember, and a permanent Longest Streak. We never say "lost."
4. No countdown timers on rewards; nothing expires.
5. Notifications are off by default, at most one per day, neutral in tone.
6. XP rewards effort; rank rewards mastery; you cannot buy or grind your way to a belt.
7. New items auto-pause when the forge is overloaded. The app protects you from your own enthusiasm.
8. Your data is yours: export anytime, import anywhere, nothing leaves the browser.
9. Sessions end with an end card, not an upsell. 続く.

---

## 13. Technical Notes (Vite + Preact)

- **State:** one `signal<LearnerState>` with `computed` derivations (dueCards, level, tierCounts, unlockedWallpapers). Persist via `effect` with 500 ms debounce; `storage` event syncs tabs.
- **Content loading:** manifest fetched at boot; packs lazy-loaded per block and cached in IndexedDB (optional) with localStorage fallback for manifest only.
- **FSRS:** pure TS module `fsrs.ts` (~200 lines), Vitest property tests on monotonic stability growth and grade ordering.
- **IME:** `kana.ts` with table-driven conversion; 120+ Vitest cases.
- **Wallpaper engine:** `art/` folder, one module per piece exporting a `WallpaperSpec`; shared `prng.ts`, `noise.ts`, `brush.ts`, `filters.ts`, `pixel.ts`. Preview renders at 1/4 scale; export runs in a `requestIdleCallback` with a progress ring and uses `OffscreenCanvas` where available.
- **Fonts:** DotGothic16, Press Start 2P, Yuji Syuku, Dela Gothic One, Noto Sans JP subset (JIS level 1 + kana + Latin) via @fontsource; loaded with `font-display: swap`; `document.fonts.load` awaited before any text pass in exports.
- **Routing:** hash router (`#/path`), `base: './'` in Vite config for GitHub Pages; `404.html` = `index.html` copy as belt-and-braces.
- **Audio:** single lazily-created `AudioContext` unlocked on first user gesture; all SFX are functions `(ctx, t) => void`.
- **Speech:** feature detection for `speechSynthesis` and `webkitSpeechRecognition`; voice list refreshed on `voiceschanged`; speaking mode auto-selects `recognition` → `shadow` → `off`.
- **Tests:** Vitest for FSRS, IME, Session Composer, XP/level math, unlock rules (table-driven: given state → expected unlocks), schema validation of all content packs, and snapshot tests of wallpaper SVG output for fixed seeds.
- **Accessibility:** full keyboard operation (1–4 for choices, Enter to submit, Space to replay audio), ARIA live region for feedback text, color-blind-safe pairs (every category color is paired with an icon), minimum 16 px body, furigana toggle, reduced motion.

---

## 14. One-Screen Summary for the Team

**KOTODAMA** is a dojo, an arcade, and a shrine. You train in short daily sessions (TSUZUKU), every word you learn is forged into memory by FSRS (HYAKUREN), you climb a 15-rank belt ladder by passing graded exams (SHUGYŌ), kana is a fighting game (GOJŪON FIGHTER), and the rewards are 55 crests and 30 original, procedurally generated wallpapers that are built from *your* words, *your* kanji, *your* sentences and *your* streak, so no two learners ever hold the same art, and no piece of art exists that wasn't paid for in Japanese.