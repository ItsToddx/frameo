import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import { NativeKitManager } from '../apps/desktop/src/adapters/runtime/kit-manager.js';
import type { KitManifest, ToolContext } from '../packages/kit-sdk/src/index.js';

function manifest(
  id = 'fixture.manager',
  version = '1.0.0',
  dependencies: Record<string, string> = {},
): KitManifest {
  return {
    schemaVersion: 1,
    id,
    name: 'Manager fixture',
    version,
    description: 'Native manager contract fixture',
    author: 'Framo tests',
    license: 'Apache-2.0',
    hostApi: '1',
    source: 'fixture',
    permissions: ['project.read'],
    dependencies,
    entry: 'entry.mjs',
    capabilities: [{ id: `${id}.read`, kind: 'read' }],
  };
}
async function setup(t: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'framo-manager-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workerPath = join(root, 'worker.mjs');
  await build({
    entryPoints: [resolve('apps/desktop/src/kit-worker/worker.ts')],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
  });
  const directory = join(root, 'installed'),
    manager = new NativeKitManager({ directory, workerPath });
  t.after(() => manager.dispose());
  return { root, workerPath, directory, manager };
}
async function source(root: string, m: KitManifest, bad = false, marker?: string): Promise<string> {
  const dir = join(root, `source-${m.id}-${m.version}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'kit.manifest.json'), JSON.stringify(m));
  const descriptor = {
    id: m.capabilities[0].id,
    name: 'Fixture read',
    description: 'Reads the passed project snapshot',
    kind: 'read',
    permissions: ['project.read'],
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  };
  await writeFile(
    join(dir, 'entry.mjs'),
    `${marker ? `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'loaded');` : ''}
export function register(api){${bad ? 'throw new Error("candidate failed");' : `api.registerReadTool({descriptor:${JSON.stringify(descriptor)},async execute(input,ctx){return {value:{text:input.text,projectId:ctx.projectId,version:${JSON.stringify(m.version)}},artifacts:[]};}});`}}\n`,
  );
  return dir;
}
function context(): ToolContext {
  return { projectId: 'p1', snapshot: { sequences: [] }, signal: new AbortController().signal };
}
test('prepare performs no code execution; trusted installation activates, persists and reloads the exact package', async (t) => {
  const { root, manager, workerPath, directory } = await setup(t),
    marker = join(root, 'evaluated.txt');
  const m = manifest();
  const dir = await source(root, m, false, marker);
  const plan = await manager.prepareImport(dir);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
  assert.equal(manager.list().length, 0);
  assert.equal(manager.capabilities().length, 0);
  const info = await manager.install(plan);
  assert.equal(info.enabled, true);
  assert.equal(await readFile(marker, 'utf8'), 'loaded');
  assert.equal(manager.capabilities()[0].kitId, m.id);
  const result = await manager.invoke(m.capabilities[0].id, { text: 'Product' }, context());
  assert.ok('value' in result);
  assert.deepEqual(result.value, { text: 'Product', projectId: 'p1', version: '1.0.0' });
  manager.dispose();
  const restarted = new NativeKitManager({ directory, workerPath });
  t.after(() => restarted.dispose());
  await restarted.loadInstalled();
  assert.equal(restarted.list()[0].enabled, true);
  await restarted.setEnabled(m.id, false);
  assert.equal(restarted.capabilities().length, 0);
  await assert.rejects(
    restarted.invoke(m.capabilities[0].id, { text: 'Product' }, context()),
    /unavailable/,
  );
  await restarted.setEnabled(m.id, true);
  assert.equal(restarted.capabilities().length, 1);
  await restarted.uninstall(m.id);
  assert.equal(restarted.list().length, 0);
  assert.ok((await lstat(join(directory, 'versions', m.id, m.version, plan.digest))).isDirectory());
});
test('trust-review changes and failed upgrades preserve the previous active version', async (t) => {
  const { root, manager } = await setup(t),
    m = manifest();
  await manager.install(await manager.prepareImport(await source(root, m)));
  const modified = await manager.prepareImport(await source(root, manifest(m.id, '2.0.0')));
  await writeFile(join(modified.stagingDirectory, 'entry.mjs'), 'throw new Error("changed");');
  await assert.rejects(manager.install(modified), /trust review/);
  assert.equal(manager.list()[0].version, '1.0.0');
  const failing = await manager.prepareImport(await source(root, manifest(m.id, '3.0.0'), true));
  await assert.rejects(manager.install(failing), /candidate failed/);
  assert.equal(manager.list()[0].version, '1.0.0');
  assert.equal(manager.list()[0].enabled, true);
  assert.ok(
    'value' in (await manager.invoke(m.capabilities[0].id, { text: 'Still available' }, context())),
  );
});
test('restart refuses tampered package hashes and keeps the saved installation visible', async (t) => {
  const { root, manager, workerPath, directory } = await setup(t),
    m = manifest(),
    plan = await manager.prepareImport(await source(root, m));
  await manager.install(plan);
  manager.dispose();
  await writeFile(
    join(directory, 'versions', m.id, m.version, plan.digest, 'entry.mjs'),
    'throw new Error("tampered code");',
  );
  const restarted = new NativeKitManager({ directory, workerPath });
  t.after(() => restarted.dispose());
  await assert.rejects(restarted.loadInstalled(), /new trust review/);
  assert.equal(restarted.list()[0].installed, true);
  assert.equal(restarted.list()[0].enabled, false);
  assert.equal(restarted.capabilities().length, 0);
});
test('native dependencies are enabled in order and disable cascades to dependents', async (t) => {
  const { root, manager, workerPath, directory } = await setup(t),
    base = manifest('fixture.base'),
    dependent = manifest('fixture.dependent', '1.0.0', { 'fixture.base': '1.0.0' });
  const dependentPlan = await manager.prepareImport(await source(root, dependent));
  await assert.rejects(manager.install(dependentPlan), /Enabled Kit dependency/);
  await manager.install(await manager.prepareImport(await source(root, base)));
  await manager.install(dependentPlan);
  await assert.rejects(manager.uninstall(base.id), /dependent/);
  manager.dispose();
  const restarted = new NativeKitManager({ directory, workerPath });
  t.after(() => restarted.dispose());
  await restarted.loadInstalled();
  assert.equal(restarted.capabilities().length, 2);
  await restarted.setEnabled(base.id, false);
  assert.equal(restarted.capabilities().length, 0);
  assert.equal(restarted.list().filter((i) => i.enabled).length, 0);
});
test('folder and ZIP preparation rejects traversal, symlinks and excess files; valid ZIP is portable', async (t) => {
  const { root, manager } = await setup(t),
    m = manifest(),
    dir = await source(root, m);
  const zip = new AdmZip();
  zip.addLocalFolder(dir, 'portable-kit');
  const zipPath = join(root, 'valid.zip');
  zip.writeZip(zipPath);
  const plan = await manager.prepareImport(zipPath);
  assert.equal(plan.manifest.id, m.id);
  assert.match(plan.digest, /^[0-9a-f]{64}$/);
  const unsafe = new AdmZip();
  unsafe.addFile('aa/escape.mjs', Buffer.from('unsafe'));
  const unsafePath = join(root, 'unsafe.zip'),
    unsafeBytes = unsafe.toBuffer();
  for (
    let offset = 0;
    (offset = unsafeBytes.indexOf(Buffer.from('aa/escape.mjs'), offset)) !== -1;
    offset += 13
  )
    Buffer.from('../escape.mjs').copy(unsafeBytes, offset);
  await writeFile(unsafePath, unsafeBytes);
  await assert.rejects(manager.prepareImport(unsafePath), /unsafe path/);
  const symlinkZip = new AdmZip();
  symlinkZip.addFile('link.mjs', Buffer.from('entry.mjs'));
  symlinkZip.getEntry('link.mjs')!.attr = 0xa1ff0000;
  const symlinkPath = join(root, 'symlink.zip');
  symlinkZip.writeZip(symlinkPath);
  await assert.rejects(manager.prepareImport(symlinkPath), /symlinks/);
  await symlink(join(dir, 'entry.mjs'), join(dir, 'link.mjs'));
  await assert.rejects(manager.prepareImport(dir), /symlinks/);
  const tooMany = new AdmZip();
  for (let n = 0; n < 501; n++) tooMany.addFile(`file-${n}.txt`, Buffer.from('x'));
  const manyPath = join(root, 'many.zip');
  tooMany.writeZip(manyPath);
  await assert.rejects(manager.prepareImport(manyPath), /file count/);
});
