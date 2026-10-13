import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { GenerationOrder, GenerationTask } from '../packages/core/src/generation.js';
import { GenerationJobs } from '../packages/application/src/generation-jobs.js';
import {
  AgentExecution,
  type AgentExecutionPorts,
} from '../packages/application/src/agent-execution.js';
import { ReviewDecisions } from '../packages/application/src/review-decisions.js';
import { ProjectWorkspace } from '../packages/application/src/project-workspace.js';
import {
  GenerationGatewayError,
  type GenerationPorts,
} from '../packages/application/src/generation-ports.js';
import type { ProjectStore, ProjectState } from '../packages/application/src/project-store.js';
import type { ChatMessage, Job, Memory, Settings } from '../packages/application/src/model.js';
/** A transactional in-memory adapter exercises the same application seam as SQLite. */
class MemoryProjectStore implements ProjectStore {
  readonly directory = '/virtual/project';
  private receipts = new Map<
    string,
    {
      payload: string;
      result: unknown;
    }
  >();
  private state: ProjectState = {
    formatVersion: 1,
    project: {
      id: 'project',
      name: 'Fixture',
      path: this.directory,
      createdAt: 'time',
      updatedAt: 'time',
    },
    sequences: [
      {
        id: 'sequence',
        name: 'Film',
        revision: 0,
        width: 640,
        height: 360,
        fps: 30,
        tracks: [],
        clips: [],
        captions: [],
      },
    ],
    assets: [],
    canvas: { revision: 0, items: [] },
    jobs: [],
    sessions: [{ id: 'session', title: 'Creative', messages: [] }],
    memories: [],
    reviews: [],
    recipes: [],
    canUndo: {},
    canRedo: {},
    eventSeq: 0,
    undo: {},
    redo: {},
    canvasUndo: [],
    canvasRedo: [],
  };
  read(): ProjectState {
    return structuredClone(this.state);
  }
  transaction<T>(work: (state: ProjectState) => T): T {
    const state = this.read(),
      receipts = structuredClone(this.receipts);
    try {
      const result = work(state);
      state.eventSeq++;
      this.state = state;
      return result;
    } catch (error) {
      this.receipts = receipts;
      throw error;
    }
  }
  receipt<T>(requestId: string, payload: unknown): T | undefined {
    const saved = this.receipts.get(requestId);
    if (!saved) return undefined;
    if (saved.payload !== JSON.stringify(payload)) throw new Error('同一操作 ID 的输入发生变化。');
    return structuredClone(saved.result) as T;
  }
  storedReceipt<T>(requestId: string): T | undefined {
    return structuredClone(this.receipts.get(requestId)?.result) as T | undefined;
  }
  saveReceipt(requestId: string, payload: unknown, result: unknown): void {
    this.receipts.set(requestId, {
      payload: JSON.stringify(payload),
      result: structuredClone(result),
    });
  }
  snapshot(userMemories: Memory[] = []) {
    const { formatVersion, undo, redo, canvasUndo, canvasRedo, budgets, agentRuns, ...snapshot } =
      this.read();
    return { ...snapshot, memories: [...snapshot.memories, ...userMemories] };
  }
  updateJob(jobId: string, patch: Partial<Job>): void {
    this.transaction((state) =>
      Object.assign(
        state.jobs.find((job) => job.id === jobId)!,
        patch,
      ),
    );
  }
  appendMessage(sessionId: string, message: ChatMessage): void {
    this.transaction((state) =>
      state.sessions.find((session) => session.id === sessionId)!.messages.push(message),
    );
  }
}
const configuration: Settings = {
  hasApiKey: true,
  agentModel: 'fixture-agent',
  seedanceModel: 'fixture-seedance',
  arkBaseUrl: 'https://fixture',
  generationCostLimit: 2,
  maxModelCalls: 12,
};
const request = {
  requestId: 'request',
  prompt: 'Create',
  duration: 5,
  ratio: '16:9' as const,
  estimatedCost: 1,
};
function identity() {
  let next = 0;
  return { id: () => `fixture-${++next}`, now: () => 'time' };
}
async function settle(check: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Application did not settle');
    await new Promise((resolve) => setImmediate(resolve));
  }
}
function generationPorts(database: MemoryProjectStore): GenerationPorts {
  return {
    ...identity(),
    accountRef: () => 'account',
    changed: () => {},
    canStart: () => true,
    provider: () => ({
      submit: async () => {
        assert.equal(database.read().jobs[0].status, 'submitting');
        return { remoteId: 'original' };
      },
      status: async () => ({ status: 'succeeded', outputUrl: 'https://fixture/video' }),
      cancel: async () => ({ acknowledged: false }),
    }),
    media: {
      reference: async () => 'data:image/png;base64,eA==',
      prepareDownload: async () => '/virtual/download',
      download: async () => {},
      validateDownload: async () => 'a'.repeat(64),
      verifyStage: async () => '/virtual/download',
      remove: async () => {},
      render: async () => {
        throw new Error('This generation must not render a timeline');
      },
      archive: async (_directory, _path, name, jobId) => ({
        id: 'candidate',
        name,
        kind: 'video',
        path: 'media/candidate.mp4',
        url: '',
        hash: 'a'.repeat(64),
        duration: 5,
        createdAt: 'time',
        originJobId: jobId,
      }),
    },
  };
}
test('the portable generation application commits one candidate without storage, provider or timeline coupling', async () => {
  const database = new MemoryProjectStore(),
    jobs = new GenerationJobs(generationPorts(database));
  const created = jobs.createGeneration(database, request, configuration);
  await settle(() => database.snapshot().jobs[0].status === 'succeeded');
  assert.equal(jobs.createGeneration(database, request, configuration).id, created.id);
  assert.equal(database.snapshot().assets.length, 1);
  assert.equal(database.snapshot().canvas.items[0].refId, 'candidate');
  assert.equal(database.snapshot().sequences[0].clips.length, 0);
  await jobs.stop();
});
test('portable recovery never replays a lost paid submission even after repeated recover and drain', async () => {
  const database = new MemoryProjectStore(),
    ports = generationPorts(database);
  let submits = 0;
  ports.provider = () => ({
    submit: async () => {
      submits++;
      throw new GenerationGatewayError('Lost response', 'unknown');
    },
    status: async () => {
      throw new Error('An unknown receipt has no remote ID to poll');
    },
    cancel: async () => ({ acknowledged: false }),
  });
  const jobs = new GenerationJobs(ports),
    created = jobs.createGeneration(database, request, configuration);
  await settle(() => database.snapshot().jobs[0].status === 'unknown');
  jobs.recover(database);
  jobs.drain();
  assert.equal(jobs.createGeneration(database, request, configuration).id, created.id);
  assert.equal(submits, 1);
  assert.equal(database.snapshot().assets.length, 0);
  await jobs.stop();
});
test('exact approval fails closed for changed configuration, keeps pending state and submits once after valid acceptance', async () => {
  const database = new MemoryProjectStore(),
    ports = generationPorts(database);
  ports.canStart = () => false;
  const jobs = new GenerationJobs(ports),
    workspace = new ProjectWorkspace(database, { read: () => [], save: () => {} }, identity());
  database.transaction((state) =>
    state.reviews.push({
      id: 'review',
      kind: 'generation',
      status: 'pending',
      title: 'Paid candidate',
      description: '',
      createdAt: 'time',
      generation: request,
      configHash: 'original',
    }),
  );
  let digest = 'changed';
  const approvals = new ReviewDecisions({
    workspace: () => workspace,
    assertRecipeCurrent: () => {},
    kitEnabled: () => true,
    kitDigest: () => undefined,
    configuration: () => configuration,
    configurationDigest: () => digest,
    assertEditAvailable: () => {},
    generate: (project, input, settings) => jobs.createGeneration(project, input, settings),
    changed: () => {},
  });
  assert.throws(
    () => approvals.decide(database, { reviewId: 'review', decision: 'accept' }),
    /配置已变化/,
  );
  assert.equal(database.snapshot().reviews[0].status, 'pending');
  assert.equal(database.snapshot().jobs.length, 0);
  digest = 'original';
  approvals.decide(database, { reviewId: 'review', decision: 'accept' });
  approvals.decide(database, { reviewId: 'review', decision: 'accept' });
  assert.equal(database.snapshot().jobs.length, 1);
  assert.equal(database.snapshot().reviews[0].jobId, database.snapshot().jobs[0].id);
  assert.equal(database.snapshot().jobs[0].status, 'queued');
  await jobs.stop();
});
test('portable agent execution stops during preparation and exhausts interrupted budgets without inference', async () => {
  const database = new MemoryProjectStore();
  let calls = 0,
    release!: (history: unknown[]) => void;
  const history = new Promise<unknown[]>((resolve) => {
    release = resolve;
  });
  const ports: AgentExecutionPorts = {
    ...identity(),
    configuration: () => configuration,
    executionSettings: () => ({
      arkBaseUrl: 'https://fixture',
      agentModel: 'fixture',
      apiKey: 'fixture',
    }),
    runtime: () => ({
      run: async () => {
        calls++;
        throw new Error('No inference after stopping preparation');
      },
      stop: async () => {},
    }),
    snapshot: (project) => project.snapshot(),
    loadHistory: () => history,
    assertEditAvailable: () => {},
    agents: () => [],
    capabilities: () => [],
    capabilityKind: () => undefined,
    hostTool: async () => {
      throw new Error('No host tool should execute');
    },
    settleRecipe: () => {},
    changed: () => {},
    emit: () => {},
  };
  const agents = new AgentExecution(ports);
  await agents.prompt(database, { requestId: 'agent', sessionId: 'session', text: 'Create' });
  await agents.stop();
  release([]);
  await agents.drain();
  assert.equal(calls, 0);
  assert.equal(Object.values(database.read().agentRuns!)[0].status, 'stopped');
  database.transaction((state) => {
    state.agentRuns = {
      interrupted: {
        rootRequestId: 'interrupted-request',
        sessionId: 'session',
        status: 'running',
      },
    };
  });
  agents.recover(database);
  assert.deepEqual(database.read().budgets!['interrupted-request'], {
    modelCalls: 12,
    toolCalls: 24,
    elapsedMs: 120000,
    maxModelCalls: 12,
    maxToolCalls: 24,
    maxDurationMs: 120000,
  });
  assert.equal(database.read().agentRuns!.interrupted.status, 'interrupted');
  assert.equal(calls, 0);
});
test('a paid task loses submission permission permanently before the external request', () => {
  const task = GenerationTask.restore({
    id: 'task',
    requestId: 'request',
    kind: 'seedance',
    status: 'queued',
    title: 'Candidate',
    progress: 0,
    createdAt: 'time',
    updatedAt: 'time',
    cancelRequested: false,
    input: {},
  });
  task.beginSubmission();
  const interrupted = GenerationTask.restore(task.snapshot());
  interrupted.recoverInterrupted();
  assert.equal(interrupted.snapshot().status, 'unknown');
  assert.throws(() => interrupted.beginSubmission(), /提交/);
  assert.equal(interrupted.snapshot().remoteId, undefined);
});
test('an unfinished task cannot manufacture candidate success or replace a committed stage', () => {
  const queued = GenerationTask.restore({
    id: 'task',
    requestId: 'request',
    kind: 'seedance',
    status: 'queued',
    title: 'Candidate',
    progress: 0,
    createdAt: 'time',
    updatedAt: 'time',
    cancelRequested: false,
    input: {},
  });
  assert.throws(() => queued.completeCandidate('invented'), /暂存/);
  const finalizing = GenerationTask.restore({
    ...queued.snapshot(),
    status: 'finalizing',
    remoteId: 'original',
  });
  finalizing.stage({ path: 'cache/task-download.mp4', hash: 'a'.repeat(64) });
  assert.throws(
    () => finalizing.stage({ path: 'cache/task-download.mp4', hash: 'b'.repeat(64) }),
    /暂存/,
  );
  finalizing.completeCandidate('verified');
  assert.equal(finalizing.snapshot().outputAssetId, 'verified');
});
test('a generation order rejects non-finite estimates and pins the reference version', () => {
  const input = {
    requestId: 'request',
    prompt: 'Create',
    duration: 5,
    ratio: '16:9' as const,
    estimatedCost: 1,
    referenceAssetId: 'image',
  };
  const configuration = {
    hasApiKey: true,
    agentModel: 'agent',
    seedanceModel: 'seedance',
    arkBaseUrl: 'https://provider',
    generationCostLimit: 2,
  };
  assert.throws(
    () => GenerationOrder.authorize({ ...input, estimatedCost: NaN }, configuration, 'account', []),
    /费用/,
  );
  assert.throws(() => GenerationOrder.authorize(input, configuration, 'account', []), /图片/);
  const order = GenerationOrder.authorize(input, configuration, 'account', [
    { id: 'image', kind: 'image', hash: 'original' },
  ]);
  const pinned = order.parameters();
  assert.equal(pinned.accountRef, 'account');
  assert.equal(pinned.referenceHash, 'original');
  pinned.accountRef = 'changed';
  assert.equal(order.parameters().accountRef, 'account');
});
test('cancellation becomes terminal only with provider acknowledgement and staged output keeps its identity', () => {
  const task = GenerationTask.restore({
    id: 'task',
    requestId: 'request',
    kind: 'seedance',
    status: 'running',
    remoteId: 'original',
    title: 'Candidate',
    progress: 0.1,
    createdAt: 'time',
    updatedAt: 'time',
    cancelRequested: false,
    input: {},
  });
  task.requestCancellation();
  assert.equal(task.snapshot().status, 'running');
  assert.equal(task.snapshot().cancelRequested, true);
  assert.throws(() => task.pinRemote('different'), /远端/);
  assert.throws(() => task.stage({ path: 'cache/../private.mp4', hash: 'a'.repeat(64) }), /暂存/);
  task.acknowledgeCancellation();
  assert.equal(task.snapshot().status, 'cancelled');
  assert.throws(() => task.pinRemote('original'), /已结束/);
  assert.throws(() => task.completeCandidate('asset'), /取消/);
});
test('domain and application source dependencies point inward and avoid desktop/framework contracts', async () => {
  async function sources(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) =>
          entry.isDirectory()
            ? sources(join(directory, entry.name))
            : entry.name.endsWith('.ts')
              ? [join(directory, entry.name)]
              : [],
        ),
      )
    ).flat();
  }
  for (const packageName of ['core', 'application']) {
    for (const path of await sources(join(process.cwd(), 'packages', packageName, 'src'))) {
      const source = await readFile(path, 'utf8');
      const dependencies: string[] = [];
      const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      function inspect(node: ts.Node): void {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          dependencies.push(node.moduleSpecifier.text);
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          dependencies.push(node.arguments[0].text);
        }
        ts.forEachChild(node, inspect);
      }
      inspect(syntax);
      for (const dependency of dependencies) {
        assert.ok(dependency.startsWith('.'), `${path} imports external package ${dependency}`);
        assert.ok(
          !/apps\/|adapters\/|react|electron|sqlite|pi-agent|pi-ai|node:/.test(dependency),
          `${path} depends on outer detail ${dependency}`,
        );
        if (packageName === 'core')
          assert.ok(!/application\//.test(dependency), `${path} depends on application`);
      }
    }
  }
});
