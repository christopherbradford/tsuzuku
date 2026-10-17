/**
 * TSUZUKU — art barrel for A (module-plan `src/art/index.ts`).
 *
 * Only what boot and the Dojo mount: the Dojo scene, the ceremony overlay
 * host, Mon crests and goshuin stamps. `main.tsx` and `app/pages.ts` load
 * this file lazily through `import.meta.glob`, so nothing heavy may be
 * re-exported here: the kakejiku registry/renderer and the PNG export
 * pipeline live in the studio-only barrel `./studio` (review round 1 #12),
 * which the Collections/Studio pages reach on their own route. Primitives
 * (svg, noise, geom, brush, pixel, color, jtext) are imported directly by
 * art modules, never through here.
 */
export { DojoScene } from './dojo/DojoScene';
export { CeremonyHost } from './ceremony/CeremonyHost';
export { MonCrest } from './MonCrest';
export { GoshuinStamp } from './GoshuinStamp';
