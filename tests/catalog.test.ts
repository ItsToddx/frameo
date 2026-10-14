import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KitCatalog } from '../apps/desktop/src/adapters/runtime/catalog.js';
import { AppDatabase } from '../apps/desktop/src/adapters/storage/database.js';
import { agentDefinitions } from '../kits/builtin.js';
import type {
  DeclarativeKit,
  KitManifest,
  CapabilityDescriptor,
  AgentDefinition,
  RecipeDefinition,
} from '../packages/kit-sdk/src/index.js';
import type { KitInfo } from '../apps/desktop/src/adapters/contracts/api.js';

function declaration(
  id: string,
  dependencies: Record<string, string> = {},
  capabilityId = `${id}.agent`,
): DeclarativeKit {
  const descriptor: CapabilityDescriptor = {
    id: capabilityId,
    name: id,
    description: 'Fixture creative agent',
    kind: 'agent',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: ['project.read', 'model.infer'],
  };
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      description: 'Fixture Kit',
      author: 'Framo tests',
      license: 'Apache-2.0',
      hostApi: '1',
      source: 'fixture',
      permissions: ['project.read', 'model.infer'],
      dependencies,
      capabilities: [{ id: capabilityId, kind: 'agent' }],
    },
    agents: [
      {
        descriptor,
        role: 'creative',
        systemPrompt: 'Plan a product film.',
        tools: ['read_project'],
      },
    ],
    recipes: [],
  };
}
class NativeFixture {
  installed: KitManifest[] = [];
  active = new Set<string>();
  calls: KitManifest[][] = [];
  failNext = false;
  manifests() {
    return structuredClone(this.installed);
  }
  list(): KitInfo[] {
    return this.installed.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      author: m.author,
      license: m.license,
      source: m.source,
      permissions: m.permissions,
      installed: true,
      enabled: this.active.has(m.id),
      category: 'tool',
    }));
  }
  capabilities(): Array<CapabilityDescriptor & { kitId: string }> {
    return this.installed
      .filter((m) => this.active.has(m.id))
      .flatMap((m) =>
        m.capabilities.map((c) => ({
          id: c.id,
          kind: c.kind,
          name: m.name,
          description: m.description,
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          permissions: m.permissions,
          kitId: m.id,
        })),
      );
  }
  agents(): AgentDefinition[] {
    return [];
  }
  recipes(): RecipeDefinition[] {
    return [];
  }
  fingerprint(id: string) {
    const manifest = this.installed.find((m) => m.id === id);
    return manifest ? { manifest: structuredClone(manifest), digest: 'a'.repeat(64) } : undefined;
  }
  async loadInstalled(dependencies: KitManifest[]) {
    this.calls.push(structuredClone(dependencies));
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Native load fixture failed');
    }
  }
  async setEnabled(id: string, enabled: boolean) {
    if (enabled) this.active.add(id);
    else this.active.delete(id);
  }
  async uninstall(id: string) {
    this.installed = this.installed.filter((m) => m.id !== id);
    this.active.delete(id);
  }
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'framo-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = new AppDatabase(directory);
  t.after(() => app.close());
  const native = new NativeFixture(),
    catalog = new KitCatalog(app, native);
  return { app, native, catalog };
}
function save(app: AppDatabase, kits: DeclarativeKit[], disabled: string[] = []) {
  app.set('declarations', kits);
  app.set(
    'kit-state',
    Object.fromEntries(
      kits.map((k) => [
        k.manifest.id,
        { installed: true, enabled: !disabled.includes(k.manifest.id) },
      ]),
    ),
  );
}
function config(app: AppDatabase) {
  return app.db.prepare('SELECT key,json FROM config ORDER BY key').all();
}

test('enabled resolution follows transitive dependencies independently of declaration order', async (t) => {
  const { app, catalog } = await fixture(t),
    a = declaration('fixture.a', { 'fixture.b': '1.0.0' }),
    b = declaration('fixture.b', { 'fixture.c': '1.0.0' }),
    c = declaration('fixture.c');
  for (const order of [
    [a, b, c],
    [c, a, b],
    [b, c, a],
  ]) {
    save(app, order, ['fixture.c']);
    for (const kit of [a, b, c]) assert.equal(catalog.enabled(kit.manifest.id), false);
  }
  save(app, [a, b, c]);
  assert.equal(catalog.enabled('fixture.a'), true);
  assert.equal(catalog.capabilities().filter((c) => c.id.startsWith('fixture.')).length, 3);
  await catalog.setEnabled('fixture.c', false);
  assert.equal(catalog.enabled('fixture.a'), false);
  assert.equal(catalog.enabled('fixture.b'), false);
  assert.equal(catalog.agents().filter((a) => a.descriptor.id.startsWith('fixture.')).length, 0);
});
test('cycles and wrong dependency versions disable cycle members and all dependents', async (t) => {
  const { app, catalog } = await fixture(t),
    a = declaration('fixture.a', { 'fixture.b': '1.0.0' }),
    b = declaration('fixture.b', { 'fixture.a': '1.0.0' }),
    c = declaration('fixture.c', { 'fixture.a': '1.0.0' });
  for (const order of [
    [a, b, c],
    [c, b, a],
  ]) {
    save(app, order);
    assert.equal(catalog.list().filter((k) => k.id.startsWith('fixture.') && k.enabled).length, 0);
  }
  b.manifest.dependencies = {};
  a.manifest.dependencies = { 'fixture.b': '2.0.0' };
  save(app, [c, a, b]);
  assert.equal(catalog.enabled('fixture.b'), true);
  assert.equal(catalog.enabled('fixture.a'), false);
  assert.equal(catalog.enabled('fixture.c'), false);
});
test('declaration import validation fails without changing installed definitions or states', async (t) => {
  const { app, catalog } = await fixture(t),
    good = declaration('fixture.good');
  await catalog.importDeclaration(JSON.stringify(good));
  const before = config(app);
  const badSchema = declaration('fixture.schema');
  badSchema.agents[0].descriptor.inputSchema = { type: 'not-a-json-schema-type' };
  const missing = declaration('fixture.missing', { 'missing.kit': '1.0.0' }),
    wrongVersion = declaration('fixture.version', { 'reelbeam.creative-kit': '9.0.0' }),
    self = declaration('fixture.self', { 'fixture.self': '1.0.0' });
  const collided = declaration('fixture.collided', {}, good.agents[0].descriptor.id),
    builtinCapability = declaration('fixture.builtin', {}, 'reelbeam.creative'),
    builtinId = declaration('reelbeam.creative-kit');
  const excessive = declaration('fixture.permissions');
  excessive.agents[0].tools = ['propose_edit'];
  for (const kit of [
    badSchema,
    missing,
    wrongVersion,
    self,
    collided,
    builtinCapability,
    builtinId,
    excessive,
  ]) {
    await assert.rejects(catalog.importDeclaration(JSON.stringify(kit)));
    assert.deepEqual(config(app), before);
  }
  const changed = structuredClone(good);
  changed.agents[0].systemPrompt = 'Changed without a version bump';
  await assert.rejects(catalog.importDeclaration(JSON.stringify(changed)), /版本/);
  assert.deepEqual(config(app), before);
});
test('native load failure and SQLite commit failure roll back declaration import atomically', async (t) => {
  const { app, native, catalog } = await fixture(t);
  await catalog.importDeclaration(JSON.stringify(declaration('fixture.old')));
  const before = config(app);
  native.failNext = true;
  await assert.rejects(
    catalog.importDeclaration(JSON.stringify(declaration('fixture.new'))),
    /load fixture/,
  );
  assert.deepEqual(config(app), before);
  assert.ok(native.calls.at(-1)!.some((m) => m.id === 'fixture.old'));
  assert.ok(!native.calls.at(-1)!.some((m) => m.id === 'fixture.new'));
  app.db.exec(
    "CREATE TRIGGER reject_kit_state BEFORE INSERT ON config WHEN NEW.key='kit-state' BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END;",
  );
  await assert.rejects(
    catalog.importDeclaration(JSON.stringify(declaration('fixture.persist'))),
    /commit failure/,
  );
  assert.deepEqual(config(app), before);
  assert.ok(!catalog.enabled('fixture.persist'));
});
test('disabled native IDs and capabilities stay reserved, and native dependencies resolve through declarations', async (t) => {
  const { app, native, catalog } = await fixture(t),
    nativeManifest: KitManifest = {
      ...declaration('fixture.native').manifest,
      entry: 'entry.mjs',
      capabilities: [{ id: 'fixture.native.read', kind: 'read' }],
    };
  native.installed.push(nativeManifest);
  const before = config(app);
  await assert.rejects(
    catalog.importDeclaration(JSON.stringify(declaration('fixture.native'))),
    /代码 Kit/,
  );
  await assert.rejects(
    catalog.importDeclaration(
      JSON.stringify(declaration('fixture.collision', {}, 'fixture.native.read')),
    ),
    /能力 ID/,
  );
  assert.deepEqual(config(app), before);
  const declarationKit = declaration('fixture.declaration', { 'fixture.native': '1.0.0' });
  save(app, [declarationKit]);
  assert.equal(catalog.enabled(declarationKit.manifest.id), false);
  native.active.add(nativeManifest.id);
  assert.equal(catalog.enabled(declarationKit.manifest.id), true);
  nativeManifest.dependencies = { 'fixture.declaration': '1.0.0' };
  assert.equal(catalog.enabled(nativeManifest.id), false);
  assert.equal(catalog.enabled(declarationKit.manifest.id), false);
});
test('native installation collision check prevents replacing declaration IDs or capabilities', async (t) => {
  const { app, catalog } = await fixture(t),
    kit = declaration('fixture.declared');
  save(app, [kit]);
  assert.throws(
    () => catalog.validateNativeImport({ ...kit.manifest, entry: 'entry.mjs' }),
    /声明 Kit/,
  );
  const native = {
    ...declaration('fixture.native').manifest,
    entry: 'entry.mjs',
    capabilities: [{ id: kit.manifest.capabilities[0].id, kind: 'read' as const }],
  };
  assert.throws(() => catalog.validateNativeImport(native), /能力 ID/);
});
test('permission expansion requires reviewed full permissions, and fingerprints track every declared behavior', async (t) => {
  const { app, catalog, native } = await fixture(t),
    kit = declaration('fixture.versioned');
  await catalog.importDeclaration(JSON.stringify(kit));
  const before = config(app),
    first = catalog.fingerprint(kit.manifest.id)!;
  const update = structuredClone(kit);
  update.manifest.version = '2.0.0';
  update.manifest.permissions.push('project.propose');
  update.agents[0].descriptor.permissions.push('project.propose');
  update.agents[0].tools.push('propose_edit');
  await assert.rejects(catalog.importDeclaration(JSON.stringify(update)), /权限发生变化/);
  assert.deepEqual(config(app), before);
  await catalog.importDeclaration(JSON.stringify(update), {
    reviewedPermissions: update.manifest.permissions,
  });
  const second = catalog.fingerprint(kit.manifest.id)!;
  assert.notEqual(second.digest, first.digest);
  assert.equal(second.manifest.version, '2.0.0');
  second.manifest.permissions.length = 0;
  assert.ok(catalog.fingerprint(kit.manifest.id)!.manifest.permissions.length > 0);
  const builtin = catalog.fingerprint('reelbeam.creative-kit')!.digest,
    prompt = agentDefinitions[0].systemPrompt;
  try {
    agentDefinitions[0].systemPrompt = 'Changed builtin behavior';
    assert.notEqual(catalog.fingerprint('reelbeam.creative-kit')!.digest, builtin);
  } finally {
    agentDefinitions[0].systemPrompt = prompt;
  }
  native.installed.push({ ...declaration('fixture.native').manifest, entry: 'entry.mjs' });
  assert.equal(catalog.fingerprint('fixture.native')!.digest, 'a'.repeat(64));
});
