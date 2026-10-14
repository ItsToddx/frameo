import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesktopApplication } from '../apps/desktop/src/adapters/application/desktop';
import type { CredentialVault } from '../apps/desktop/src/adapters/storage/credentials';
import type {
  PiRuntimeOptions,
  WorkerRun,
  WorkerResult,
} from '../apps/desktop/src/adapters/runtime/pi';
import type { ProjectSnapshot } from '../apps/desktop/src/adapters/contracts/api';
const budget = {
  modelCalls: 1,
  toolCalls: 1,
  elapsedMs: 1,
  maxModelCalls: 12,
  maxToolCalls: 24,
  maxDurationMs: 120000,
};
async function fixture(
  run: (
    app: Awaited<ReturnType<typeof createDesktopApplication>>,
    root: string,
    snapshot: ProjectSnapshot,
  ) => Promise<void>,
  options: {
    loadHistory?: () => Promise<unknown[]>;
    runtime?: (options: PiRuntimeOptions, run: WorkerRun) => Promise<WorkerResult>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'framo-host-'));
  const vault = {
    hasKey: () => true,
    get: () => 'test-fixture-key',
    currentId: () => 'fixture-account',
    save: () => {},
  } as unknown as CredentialVault;
  const app = await createDesktopApplication({
    userData: join(root, 'profile'),
    documents: root,
    version: '0.1.0',
    vault,
    workerPaths: { agent: 'unused', kit: 'unused' },
    emit: () => {},
    revealFile: () => {},
    dialog: {
      save: async () => ({ canceled: false, filePath: join(root, 'project') }),
      open: async () => ({ canceled: true, filePaths: [] }),
      confirm: async () => ({ response: 1 }),
    },
    loadHistory: options.loadHistory,
    runtimeFactory: (runtimeOptions) => ({
      isRunning: false,
      run: async (input) =>
        options.runtime
          ? options.runtime(runtimeOptions, input)
          : { status: 'completed', text: 'Fixture', budget, history: [] },
      stop: async () => {},
      dispose: async () => {},
    }),
  });
  try {
    app.methods.setLanguage('zh-CN');
    app.methods.saveSettings({
      arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      agentModel: 'fixture',
      seedanceModel: 'doubao-seedance-2-5-260628',
      generationCostLimit: 1,
      maxModelCalls: 12,
    });
    const snapshot = (await app.methods.createProject({
      name: 'Host fixture',
      width: 640,
      height: 360,
      fps: 30,
    })) as ProjectSnapshot;
    await run(app, root, snapshot);
  } finally {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  }
}
async function wait(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Did not settle');
    await new Promise((r) => setTimeout(r, 5));
  }
}
test('stop during delayed history preparation never starts inference afterward', async () => {
  let release!: () => void,
    started = 0;
  const history = new Promise<unknown[]>((resolve) => {
    release = () => resolve([]);
  });
  await fixture(
    async (app, _root, snapshot) => {
      await app.methods.prompt({
        requestId: 'stop-before-start',
        sessionId: snapshot.sessions[0].id,
        text: 'Prepare',
        sequenceId: snapshot.sequences[0].id,
      });
      await app.methods.stopAgent();
      release();
      await wait(() =>
        (app.methods.snapshot() as ProjectSnapshot).sessions[0].messages.some((message) =>
          message.text.includes('停止'),
        ),
      );
      assert.equal(started, 0);
    },
    {
      loadHistory: () => history,
      runtime: async () => {
        started++;
        return { status: 'completed', text: 'should never happen', budget, history: [] };
      },
    },
  );
});
test('the media protocol only authorizes registered files, and drafts exclude other host writers', async () =>
  fixture(async (app, root, snapshot) => {
    const path = join(root, 'project', 'cache', 'orphan.txt');
    await writeFile(path, 'private staging');
    assert.equal(app.mediaAllowed(path), false);
    const sequence = snapshot.sequences[0];
    app.methods.beginEdit({ sequenceId: sequence.id, interactionId: 'manual' });
    assert.throws(
      () =>
        app.methods.undo({
          sequenceId: sequence.id,
          expectedRevision: sequence.revision,
          commandId: 'undo',
        }),
      /草稿/,
    );
    await assert.rejects(
      app.methods.prompt({
        requestId: 'blocked',
        sessionId: snapshot.sessions[0].id,
        text: 'Edit',
        sequenceId: sequence.id,
      }) as Promise<unknown>,
      /草稿/,
    );
    app.methods.endEdit({ sequenceId: sequence.id, interactionId: 'old-token' });
    assert.throws(
      () =>
        app.methods.apply({
          sequenceId: sequence.id,
          expectedRevision: 0,
          commandId: 'other',
          commands: [{ type: 'sequenceSettings', patch: { name: 'Other' } }],
        }),
      /草稿/,
    );
    app.methods.apply({
      sequenceId: sequence.id,
      expectedRevision: 0,
      commandId: 'manual-save',
      interactionId: 'manual',
      commands: [{ type: 'sequenceSettings', patch: { name: 'Manual' } }],
    });
    app.methods.endEdit({ sequenceId: sequence.id, interactionId: 'manual' });
    const request = { sequenceId: sequence.id, expectedRevision: 1, commandId: 'undo-once' };
    app.methods.undo(request);
    app.methods.undo(request);
    assert.equal((app.methods.snapshot() as ProjectSnapshot).sequences[0].revision, 2);
  }));
test('negated memory instructions cannot create long-term memory', async () =>
  fixture(
    async (app, _root, snapshot) => {
      await app.methods.prompt({
        requestId: 'no-memory',
        sessionId: snapshot.sessions[0].id,
        text: '不要记住这个偏好。',
      });
      await wait(() =>
        (app.methods.snapshot() as ProjectSnapshot).sessions[0].messages.some(
          (m) => m.role === 'assistant',
        ),
      );
      assert.equal((app.methods.snapshot() as ProjectSnapshot).memories.length, 0);
    },
    {
      runtime: async (options, input) => {
        await options.onTool(
          {
            runId: input.runId,
            sessionId: input.sessionId,
            rootRequestId: input.rootRequestId,
            role: 'coordinator',
            toolCallId: 'memory',
            name: 'save_memory',
            args: { scope: 'project', content: 'Should not be remembered' },
          },
          new AbortController().signal,
        );
        return { status: 'completed', text: 'No memory stored', budget, history: [] };
      },
    },
  ));
test('unsafe session identifiers cannot escape the history directory', async () =>
  fixture(
    async (app, root, snapshot) => {
      // The application always creates UUID sessions; a tool worker cannot choose filesystem paths.
      await app.methods.prompt({
        requestId: 'history',
        sessionId: snapshot.sessions[0].id,
        text: 'Say hello',
      });
      await wait(() =>
        (app.methods.snapshot() as ProjectSnapshot).sessions[0].messages.some(
          (m) => m.role === 'assistant',
        ),
      );
      const files = await readdir(join(root, 'project', 'sessions'));
      assert.equal(files.length, 1);
      assert.match(files[0], /^[a-f0-9]{64}\.jsonl$/);
    },
    {
      runtime: async (options, input) => {
        await options.onHistory?.({
          runId: input.runId,
          sessionId: '../escape',
          role: 'coordinator',
          messages: [{ role: 'user', content: 'Fixture', timestamp: 1 }],
          append: true,
        });
        return { status: 'completed', text: 'Saved safely', budget, history: [] };
      },
    },
  ));
