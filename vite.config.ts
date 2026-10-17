/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';

// base './' makes the build relocatable: works at https://<user>.github.io/<repo>/
// and at a custom domain root, because routing is hash-based.
export default defineConfig({
  base: './',
  // `import.meta.env.VITE_APP_VERSION` = package.json's version (About page).
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  plugins: [preact()],
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
