/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';

/* ── service-worker build stamp ──────────────────────────────────────────
 * public/sw.js is copied verbatim, and a browser installs a new worker only
 * when the script bytes differ. `CACHE_VERSION` there is the placeholder
 * below; after the bundle is written we replace it with
 * `<pkg.version>-<sha256 of index.html + the hashed asset names>`, so every
 * release that changes the shell ships a new worker (update toast, old caches
 * dropped) while a byte-identical rebuild stays quiet.
 */
export const SW_STAMP_PLACEHOLDER = '__TSUZUKU_BUILD__';

/** `<version>-<8 hex>` over the given build inputs (deterministic). */
export function buildStamp(version: string, inputs: readonly string[]): string {
  const h = createHash('sha256');
  for (const s of inputs) h.update(s).update('\0');
  return `${version}-${h.digest('hex').slice(0, 8)}`;
}

/** Replaces every placeholder in the worker source; throws when the placeholder is gone. */
export function stampSw(code: string, stamp: string): string {
  if (!code.includes(SW_STAMP_PLACEHOLDER)) throw new Error(`sw.js: missing ${SW_STAMP_PLACEHOLDER} placeholder`);
  return code.split(SW_STAMP_PLACEHOLDER).join(stamp);
}

function swStampPlugin(): Plugin {
  let outDir = resolve('dist');
  return {
    name: 'tsuzuku:sw-stamp',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const swPath = resolve(outDir, 'sw.js');
      const indexPath = resolve(outDir, 'index.html');
      if (!existsSync(swPath) || !existsSync(indexPath)) return;
      const assetsDir = resolve(outDir, 'assets');
      const assets = existsSync(assetsDir) ? readdirSync(assetsDir).sort() : [];
      const stamp = buildStamp(pkg.version, [readFileSync(indexPath, 'utf8'), ...assets]);
      writeFileSync(swPath, stampSw(readFileSync(swPath, 'utf8'), stamp));
    },
  };
}

// base './' makes the build relocatable: works at https://<user>.github.io/<repo>/
// and at a custom domain root, because routing is hash-based.
export default defineConfig({
  base: './',
  // `import.meta.env.VITE_APP_VERSION` = package.json's version (About page).
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  plugins: [preact(), swStampPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
});
