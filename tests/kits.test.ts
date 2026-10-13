import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KitRegistry,
  validateDeclarativeKit,
  exportDeclaration,
  importDeclaration,
  readPointer,
} from '../packages/kit-sdk/src/index.js';
import {
  builtinManifests,
  agentDefinitions,
  captionStyleTool,
  productAdRecipe,
} from '../kits/builtin.js';

test('declarative Kit import/export preserves portable agents and manifest capabilities', () => {
  const kit = {
    manifest: builtinManifests.find((m) => m.id === 'reelbeam.creative-kit')!,
    agents: [agentDefinitions[0]],
    recipes: [],
  };
  assert.deepEqual(importDeclaration(exportDeclaration(kit)), kit);
  assert.throws(() => validateDeclarativeKit({ ...kit, entry: 'malicious.js' }));
  assert.throws(() =>
    validateDeclarativeKit({ ...kit, manifest: { ...kit.manifest, hostApi: '99' } }),
  );
  assert.throws(() =>
    validateDeclarativeKit({
      ...kit,
      agents: [{ ...kit.agents[0], systemPrompt: 'Load file:///Users/private.json' }],
    }),
  );
});
test('failed Kit setup has no partial registration and successful cleanup is idempotent', async () => {
  const registry = new KitRegistry(),
    manifest = builtinManifests.find((m) => m.id === 'reelbeam.creative-kit')!;
  await assert.rejects(
    registry.register(manifest, (api) => {
      api.registerAgent(agentDefinitions[0]);
      throw new Error('init failed');
    }),
  );
  assert.equal(registry.list().length, 0);
  const dispose = await registry.register(manifest, (api) => {
    api.registerAgent(agentDefinitions[0]);
  });
  assert.equal(registry.get('reelbeam.creative'), agentDefinitions[0]);
  await assert.rejects(
    registry.register(manifest, () => {}),
    /already registered/,
  );
  dispose();
  dispose();
  assert.equal(registry.list().length, 0);
});
test('Kit registry rejects manifest mismatch, undeclared permissions and absent dependencies atomically', async () => {
  const registry = new KitRegistry(),
    manifest = builtinManifests.find((m) => m.id === 'reelbeam.creative-kit')!;
  await assert.rejects(
    registry.register(manifest, () => {}),
    /does not match/,
  );
  await assert.rejects(
    registry.register({ ...manifest, permissions: [] }, (api) => {
      api.registerAgent(agentDefinitions[0]);
    }),
    /permissions/,
  );
  await assert.rejects(
    registry.register({ ...manifest, dependencies: { 'missing.kit': '1.0.0' } }, () => {}),
    /dependency/,
  );
  assert.equal(registry.list().length, 0);
});
test('recipe dependency cycles and undeclared cross-step bindings fail validation', () => {
  const manifest = { ...builtinManifests.at(-1)!, dependencies: {} };
  assert.equal(
    validateDeclarativeKit({ manifest, agents: [], recipes: [productAdRecipe] }).recipes.length,
    1,
  );
  const cycle = structuredClone(productAdRecipe);
  cycle.steps[0].dependsOn = ['assembly'];
  assert.throws(() => validateDeclarativeKit({ manifest, agents: [], recipes: [cycle] }), /cycle/);
  const invalid = structuredClone(productAdRecipe);
  invalid.steps[1].dependsOn = [];
  assert.throws(
    () => validateDeclarativeKit({ manifest, agents: [], recipes: [invalid] }),
    /declared dependency/,
  );
  assert.deepEqual(readPointer({ value: { 'a/b': [1, 2] } }, '/value/a~1b/1'), 2);
  assert.throws(() => readPointer({}, '/__proto__'), /missing/);
});
test('caption tool returns revision-aware proposals and never mutates snapshot', async () => {
  const snapshot = {
    sequences: [
      {
        id: 's1',
        revision: 4,
        captions: [
          {
            id: 'c1',
            start: 1,
            duration: 2,
            text: 'Product film',
            fontSize: 32,
            color: '#ffffff',
            position: 'bottom' as const,
          },
        ],
      },
    ],
  };
  const before = structuredClone(snapshot);
  const result = await captionStyleTool.propose(
    { captionIds: ['c1'], fontSize: 48, color: '#ff0000', position: 'center' },
    {
      projectId: 'p1',
      sequenceId: 's1',
      revision: 4,
      snapshot,
      signal: new AbortController().signal,
    },
  );
  assert.equal(result.expectedRevision, 4);
  assert.equal(result.commands.length, 1);
  assert.deepEqual(snapshot, before);
  await assert.rejects(
    captionStyleTool.propose(
      { captionIds: ['missing'], fontSize: 48, color: '#ff0000', position: 'center' },
      {
        projectId: 'p1',
        sequenceId: 's1',
        revision: 4,
        snapshot,
        signal: new AbortController().signal,
      },
    ),
    /no longer exists/,
  );
});
