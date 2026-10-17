/**
 * TSUZUKU — store barrel (group B, ARCHITECTURE §0/§1).
 *
 * Everything other groups may touch of B EXCEPT the derived read-model
 * (`src/store/derived.ts`, which imports `@/learn`). This barrel must never
 * (transitively) import `src/learn`.
 */
export { store, storeCards, initStore, resetStoreForTests, registerReducer, currentSlot, shardOfKey, shardSizes } from './store';
export type { InitOptions, ReducerStarter, DueOptions, SetHint, StoreCardsApi } from './store';
export {
  freshSave,
  INTENSITY_PRESETS,
  STANDARD_NEW_PER_DAY,
  INTENSITY_SCALE,
  KANA_PER_DAY,
  newPerDayFor,
  newPerDayTotal,
  beltForStation,
} from './defaults';
export { CURRENT, MigrationError, migrateMeta, migrateShard, migrateLog, applyRedirects } from './migrations';
export {
  META_KEY,
  CARDS_KEY,
  LOG_KEY,
  SESSION_KEY,
  SHARD_SPECS,
  WARN_BYTES,
  CEILING_BYTES,
  LOG_RING,
  utf16Bytes,
  shardKey,
  shardIdFor,
} from './persist';
export type { ShardId, ShardSpec } from './persist';
export { STAT_KEYS } from '../shared/store-types';
export type * from '../shared/store-types';

// INTEGRATOR — add as the modules land (module-plan src/store/index.ts):
// export { exportSave, previewImport, applyImport } from './backup';
// export { XP_TABLE, levelFor, xpToNext } from './xp';
// export { QUESTS, questProgress } from './quests';
// export { BADGE_DEFS } from './badge-defs';
// export { WALLPAPER_DEFS } from './wallpaper-defs';
// export { addLedgerEntry, logMission, ledgerHours, weeklyTargetHours } from './ledger';
