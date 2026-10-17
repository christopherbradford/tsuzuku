# TSUZUKU（つづく）— To be continued. Every day.

A static, offline-friendly web app that takes an English speaker from zero to fluent Japanese
along the 53 stations of the old Tōkaidō road — kana at Shinagawa, N1 at Kyoto, and an
open-ended Dan road beyond. It is a game on the outside (belts, combos, Gatekeeper bosses,
Mon badges, collectible procedurally-drawn wallpapers) and a spaced-repetition engine on the
inside (FSRS-5 with separate schedules for receptive and productive knowledge).

Hosted on GitHub Pages. No backend, no accounts. All progress lives in your browser's
localStorage with one-click JSON export/import.

## The road

| Belt | Stations | Level | What you train |
|---|---|---|---|
| White | 1–3 | kana | hiragana, katakana, Gojūon Fighter arcade |
| Yellow / Orange | 4–15 | N5 | first 800 words, 100 kanji, 90 grammar points, Tabi Nikki travel diary |
| Green | 16–24 | N4 | reading becomes the main XP source ("Second Wind") |
| Blue / Purple | 25–38 | N3 | the Plateau Arc: native-bridge texts, register switching, aizuchi |
| Brown | 39–46 | N2 | Beyond the Wall |
| Black (初段) | 47–53 | N1 core | Shodan Shinsa at Sanjō Ōhashi |
| Dan road | — | beyond | keigo, natural speech, dialect awareness, monologue marathons |

Every station ends with a **Gatekeeper** (関守): a four-phase mastery check, never a time gate.
Belts are awarded by **Shinsa** (審査) exams. Fail one and you get Sensei's Notes and a retake.

## How it teaches

- **Hyakuren (百錬)** — FSRS-5 scheduling per facet (`rec`, `listen`, `prod`, `read`, `comp`, `cloze`, `pitch`).
  An item cannot reach Black until you can *produce* it.
- **Speed trained apart from accuracy** — timers and combo bonuses touch only mature items (stability ≥ 14 days).
- **Comprehensible input** — 137 graded stories and dialogues written against each station's known-word allowlist,
  with furigana fog, tap-to-gloss, comprehension checks, and a serialized travel diary (旅日記).
- **Output every day** — romaji→kana typing (IME built on wanakana), conjugation drills (Form Forge), scramble,
  shadowing and role-play with speech recognition where the browser supports it.
- **Honest numbers** — the Perapera Index (ぺらぺら指数) radar, an Input Ledger for the real listening hours
  no app can supply, and a Projected Arrival date computed from your actual pace.

## How it rewards

- **XP and levels** for effort; **belts** for skill. One never gates the other.
- **Kiai (気合)**: ki meter, combos that forgive misses on new items, Ippon for fast clean hits.
- **66 Mon (紋) badges**, each an original SVG crest with a machine-checked condition.
- **28 Kakejiku wallpapers** — procedural SVG art (torii at dawn, neon alley of *your* words, kanji constellations,
  the Great Wave built from your glyphs) personalized with your data and exportable as PNG for desktop and phone.
- **Goshuin-chō** stamp book, a procedural Dojo home screen that grows with you, and a つづく end card after
  every session. No loot boxes, no streak shaming, forgiveness built in.

## Develop

```bash
npm install
npm run dev            # Vite dev server
npm test               # Vitest
npm run typecheck
npm run content:validate   # validate public/content/**/*.json against the writer rules
npm run build          # dist/ for GitHub Pages
```

Node 24+ (content pipeline scripts are TypeScript run directly by Node).

## Deploy to GitHub Pages

1. Push to GitHub. In the repo settings choose **Pages → Source: GitHub Actions**.
2. `.github/workflows/deploy.yml` validates content, runs tests, builds, and deploys on every push to `main`.
3. The build uses relative asset paths and hash routing, so it works at `https://<user>.github.io/<repo>/`
   and at a custom domain without changes.

## Repository map

| Path | What |
|---|---|
| `docs/design/01–07` | the design: identity, progression, sessions, exercises, SRS policy, rewards, architecture |
| `docs/ARCHITECTURE.md` | binding shared contracts (store, event bus, loader, exercise registry, routes, CSS tokens) |
| `docs/CONTENT_GUIDE.md` | writer handbook and validation rules V01–V36 |
| `docs/content-plan.json`, `docs/module-plan.json` | every content file and source module, by owner |
| `src/content/types.ts` | all content schemas, belts, the 53 stations |
| `public/content/` | kana, vocab (N5–N1), kanji (N5–N2), grammar (N5–N1), stories, michikusa, conjugation table |
| `scripts/` | content validator, station assigner, manifest builder |
| `docs/design-panel/` | the four original design proposals and judge scores this spec was synthesized from |

## License

Code: MIT. Content and generated art: CC BY-SA 4.0. All art is original and procedural; no franchise material.
