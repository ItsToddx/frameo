import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins:[tailwindcss()],
  root: 'apps/desktop/src/renderer', base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: resolve('dist/renderer'), emptyOutDir: true }
});
