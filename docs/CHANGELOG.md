# TSUZUKU — contract CHANGELOG

Contract-tier changes (ARCHITECTURE §0) after day 0. One line each; the module header carries the detail.

- 2026-10-17 · `shared/store-types.ts` `CardFlag.recheck = 16` added (arcade-miss "re-test untimed next session" bit, design 04 §9); `learn/queue.ts RECHECK_FLAG` is now an alias of it. ARCHITECTURE §1 flag list updated.
- 2026-10-17 · `learn/apply.ts` (§5): `recordAttempt` accepts optional `kiai: KiaiState` (+ `repIndex`, `rng`) and then runs `kiaiStep()` internally, because `attempt:graded` (§2) must carry `ippon/kiai/combo/recovery` and only the writer emits that event; the rep loop is now `recordAttempt -> feedback -> next`. Without `kiai` those fields are `0/false`. The return is a `StepResult` (`promotion: ItemBelt`, `xpDelta` captured from B's synchronous `xp:gained`) extended with the module-plan facts (`card`, `firstProd`, `mature`, `promoted{from,to}` …). Also added `retireItem` (退) and `defeatNemesis` (writes `leech.defeat`, emits `nemesis:defeated`); `markKnown` appends kana ids to `profile.kanaKnown`; `recordImplicit` never emits `attempt:graded`.
- 2026-10-17 · `content/types.ts` holds the `ContentItem` union (Stage 1 note; §3 pseudo-TS placed it in `loader.ts`); `loader.ts` now re-exports it type-only so both import paths work.
