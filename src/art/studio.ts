/**
 * TSUZUKU — studio-only art barrel (group G).
 *
 * The kakejiku registry/renderer and the PNG export pipeline, split out of
 * `./index` (review round 1 #12) so the boot-time barrel that `main.tsx`
 * and `app/pages.ts` load for the Dojo scene and the ceremony host no longer
 * drags the 28 wallpaper generators and the raster pipeline into the first
 * paint. Only the Collections / Print Studio route needs these; the ceremony
 * overlay loads the wallpaper module lazily through `ceremony/support.ts`.
 */
export { renderWallpaper, WALLPAPERS } from './wallpapers/index';
export type { RenderedWallpaper, RenderOptions } from './wallpapers/index';
export type { WallpaperData, WallpaperSpec, WallpaperSize, Revealed } from './wallpapers/spec';
export { exportPng, download, canRender4k, exportSizes, filenameFor } from './png';
export type { TextLayer, PostPass, ExportOptions, DownloadOutcome } from './png';
