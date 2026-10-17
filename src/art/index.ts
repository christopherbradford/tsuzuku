/**
 * TSUZUKU — art barrel for A (module-plan `src/art/index.ts`).
 *
 * Components and renderers other groups mount: the Dojo scene, the ceremony
 * overlay host, Mon crests, goshuin stamps, the kakejiku registry/renderer
 * and the PNG export pipeline. Primitives (svg, noise, geom, brush, pixel,
 * color, jtext) are imported directly by art modules, never through here.
 */
export { DojoScene } from './dojo/DojoScene';
export { CeremonyHost } from './ceremony/CeremonyHost';
export { MonCrest } from './MonCrest';
export { GoshuinStamp } from './GoshuinStamp';
export { renderWallpaper, WALLPAPERS } from './wallpapers/index';
export type { RenderedWallpaper, RenderOptions } from './wallpapers/index';
export type { WallpaperData, WallpaperSpec, WallpaperSize, Revealed } from './wallpapers/spec';
export { exportPng, download, canRender4k, exportSizes, filenameFor } from './png';
export type { TextLayer, PostPass, ExportOptions, DownloadOutcome } from './png';
