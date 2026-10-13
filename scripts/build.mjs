import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/main', {recursive: true});
await build({entryPoints: ['apps/desktop/src/main/main.ts'], outfile: 'dist/main/main.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true});
await build({entryPoints: ['apps/desktop/src/preload/preload.ts'], outfile: 'dist/main/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24'});
await build({entryPoints: ['apps/desktop/src/agent-worker/worker.ts'], outfile: 'dist/main/agent-worker.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external'});
