/**
 * TSUZUKU — collections barrel (group G) for `src/app/pages.ts`:
 * CollectionsPage (`#/collections/:tab`), StudioPage (`#/studio/:wallpaperId`)
 * and LibraryPage (`#/library`), default exports of their page modules,
 * re-exported by name here.
 */
export { default as CollectionsPage } from './pages/CollectionsPage';
export { default as StudioPage } from './pages/StudioPage';
export { default as LibraryPage } from './pages/LibraryPage';
export type { CollectionsPageProps } from './pages/CollectionsPage';
export type { StudioPageProps } from './pages/StudioPage';
export type { LibraryPageProps } from './pages/LibraryPage';
export { MonGrid } from './MonGrid';
export { KakejikuGallery } from './KakejikuGallery';
export { GoshuinBook } from './GoshuinBook';
