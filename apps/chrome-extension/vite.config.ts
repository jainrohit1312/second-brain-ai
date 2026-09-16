import { fileURLToPath } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import manifest from './manifest.json';

// `manifest.json` is the source of truth for entry points and permissions: at build
// time @crxjs/vite-plugin parses it, compiles the TypeScript entries it references
// (service worker, content script), and rewrites the copy emitted into dist/ with
// hashed asset paths. It is never loaded from the repository root.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // Environment variables live in the repo-root .env next to the ones the services use,
  // so a single file configures the whole system during development.
  envDir: '../../',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./src/popup/index.html', import.meta.url)),
        sidepanel: fileURLToPath(new URL('./src/sidepanel/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: {
      port: 5174,
    },
  },
});
