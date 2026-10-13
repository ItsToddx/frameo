import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'apps/desktop/src/renderer', base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: resolve('dist/renderer'), emptyOutDir: true }
});
