import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAssistantMessageEventStream, type AssistantMessage } from '@mariozechner/pi-ai';
import { AppDatabase, ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { ProjectService } from '../apps/desktop/src/adapters/storage/project-service';
import {
  RecipeService,
  type RecipeCatalog,
} from '../apps/desktop/src/adapters/application/recipe-service';
import { KitCatalog } from '../apps/desktop/src/adapters/runtime/catalog';
import { JobRunner } from '../apps/desktop/src/adapters/runtime/jobs';
import { WorkerEngine } from '../apps/desktop/src/agent-worker/engine';
import { ReviewDecisions } from '../packages/application/src/review-decisions';
import type { CredentialVault } from '../apps/desktop/src/adapters/storage/credentials';
import type {
  AgentDefinition,
  CapabilityDescriptor,
  KitManifest,
  RecipeDefinition,
} from '../packages/kit-sdk/src/types';
import { seedanceDescriptor } from '../kits/builtin';
import baseline from './fixtures/builtin-v0.1.1.json';

const nativeCatalog = {
  list: () => [],
  setEnabled: async () => {},
  uninstall: async () => {},
  loadInstalled: async () => {},
  agents: () => [],
  recipes: () => [],
  capabilities: () => [],
};
const manifests = baseline.manifests as KitManifest[];
const agents = baseline.agents as AgentDefinition[];
const recipe = baseline.recipe as unknown as RecipeDefinition;
const descriptors = baseline.descriptors as CapabilityDescriptor[];
const fingerprints: Record<string, string> = baseline.fingerprints;

function legacyCatalog(current: KitCatalog): RecipeCatalog {
  return {
    list: () => current.list(),
    manifests: () => structuredClone(manifests),
    agents: () => structuredClone(agents),
    recipe: () => structuredClone(recipe),
    capabilities: () =>
      manifests.flatMap((manifest) =>
        manifest.capabilities.map((capability) => ({
          ...descriptors.find((descriptor) => descriptor.id === capability.id)!,
          kitId: manifest.id,
        })),
      ),
    fingerprint: (id) => {
      const manifest = manifests.find((item) => item.id === id);
      return manifest
        ? { manifest: structuredClone(manifest), digest: fingerprints[id] }
        : undefined;
    },
  };
}

test('Frameo preserves every version 1.0.0 builtin fingerprint while displaying its current author', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frameo-builtin-fingerprints-'));
  const application = new AppDatabase(root);
  try {
    const catalog = new KitCatalog(application, nativeCatalog);
    for (const [id, expected] of Object.entries(fingerprints)) {
      assert.equal(
        catalog.fingerprint(id)?.digest,
        expected,
        `${id} changed without a version bump`,
      );
      assert.equal(
        catalog.fingerprint(id)?.manifest.author,
        'Reelbeam',
        'Canonical historical attribution remains frozen',
      );
      assert.equal(catalog.list().find((kit) => kit.id === id)?.author, 'Frameo');
    }
  } finally {
    application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a frozen v0.1.1 recipe resumes after reopening under Frameo without rewriting its definitions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frameo-frozen-recipe-'));
  const application = new AppDatabase(join(root, 'profile'));
  let database = ProjectDatabase.create(join(root, 'Legacy.reelbeam'), 'Legacy', 640, 360, 30);
  try {
    const catalog = new KitCatalog(application, nativeCatalog);
    const frozen = new RecipeService(database, legacyCatalog(catalog)).create({
      kitId: 'reelbeam.product-ad-kit',
      title: 'Frozen original request',
    });
    database.close();
    database = new ProjectDatabase(database.directory);
    const execution = new RecipeService(database, catalog).resume(frozen.id);
    assert.equal(execution?.step.id, 'script');
    assert.equal(execution?.agentDefinition?.systemPrompt, agents[0].systemPrompt);
    assert.deepEqual(execution?.recipe.frozenDependencies, frozen.frozenDependencies);
    assert.deepEqual(execution?.recipe.target, frozen.target);
    assert.equal(database.read().jobs.length, 0, 'Resume does not imply a paid generation');
  } finally {
    database.close();
    application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy pending builtin proposals stay approvable while actual capability changes still invalidate them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frameo-pending-builtin-'));
  const application = new AppDatabase(join(root, 'profile'));
  const database = ProjectDatabase.create(join(root, 'Legacy.reelbeam'), 'Legacy', 640, 360, 30);
  const catalog = new KitCatalog(application, nativeCatalog);
  const vault = { currentId: () => 'fixture-account' } as unknown as CredentialVault;
  const jobs = new JobRunner(
    vault,
    () => {},
    () => false,
  );
  const description = seedanceDescriptor.description;
  try {
    database.transaction((state) => {
      for (const id of ['legacy-review', 'changed-review'])
        state.reviews.push({
          id,
          kind: 'generation',
          title: 'Frozen paid proposal',
          description: '',
          status: 'pending',
          createdAt: 'legacy-time',
          kitId: 'reelbeam.seedance-kit',
          kitDigest: fingerprints['reelbeam.seedance-kit'],
          configHash: 'fixture-config',
          generation: {
            requestId: id,
            prompt: 'Original proposal',
            duration: 5,
            ratio: '16:9',
            estimatedCost: 1,
          },
        });
    });
    const approvals = new ReviewDecisions({
      workspace: () => new ProjectService(database, application),
      assertRecipeCurrent: () => {},
      kitEnabled: (id) => catalog.enabled(id),
      kitDigest: (id) => catalog.fingerprint(id)?.digest,
      configuration: () => ({
        hasApiKey: true,
        arkBaseUrl: 'https://fixture',
        agentModel: 'fixture-agent',
        seedanceModel: 'fixture-seedance',
        generationCostLimit: 2,
        maxModelCalls: 12,
      }),
      configurationDigest: () => 'fixture-config',
      assertEditAvailable: () => {},
      generate: (project, input, settings) => jobs.createGeneration(project, input, settings),
      changed: () => {},
    });
    approvals.decide(database, { reviewId: 'legacy-review', decision: 'accept' });
    assert.equal(database.read().reviews[0].status, 'accepted');
    assert.equal(database.read().jobs.length, 1);
    assert.equal(
      database.read().jobs[0].status,
      'queued',
      'The test never opens a provider or reads an API key',
    );
    seedanceDescriptor.description = 'Actually changed capability definition';
    assert.notEqual(
      catalog.fingerprint('reelbeam.seedance-kit')?.digest,
      fingerprints['reelbeam.seedance-kit'],
    );
    assert.throws(
      () => approvals.decide(database, { reviewId: 'changed-review', decision: 'accept' }),
      /停用或升级/,
    );
    assert.equal(database.read().reviews[1].status, 'pending');
    assert.equal(database.read().jobs.length, 1);
  } finally {
    seedanceDescriptor.description = description;
    await jobs.stop();
    database.close();
    application.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('the current runtime composes Frameo identity after a frozen historical role prompt', async () => {
  let prompt = '';
  const engine = new WorkerEngine(
    () => {},
    async () => {
      throw new Error('No tools or provider calls');
    },
    (model, context) => {
      prompt = context.systemPrompt ?? '';
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Offline fixture' }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: 'stop',
        timestamp: 1,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    },
  );
  const result = await engine.run({
    runId: 'offline',
    rootRequestId: 'offline-root',
    sessionId: 'session',
    text: 'Introduce yourself',
    role: 'creative',
    agentDefinition: agents[0],
    settings: { arkBaseUrl: 'https://fixture', agentModel: 'fixture-model', apiKey: 'fixture-key' },
    context: {
      snapshot: {
        project: { id: 'project', name: 'Fixture', path: '', createdAt: '', updatedAt: '' },
        sequences: [],
        assets: [],
        canvas: { revision: 0, items: [] },
        jobs: [],
        sessions: [],
        memories: [],
        reviews: [],
        recipes: [],
        canUndo: {},
        canRedo: {},
        eventSeq: 0,
      },
    },
  });
  assert.equal(result.status, 'completed', result.error);
  assert.ok(prompt.includes(agents[0].systemPrompt));
  assert.ok(
    prompt.indexOf('Current application identity: Frameo') > prompt.indexOf(agents[0].systemPrompt),
  );
});
