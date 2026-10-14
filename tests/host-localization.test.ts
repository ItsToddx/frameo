import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesktopApplication } from '../apps/desktop/src/adapters/application/desktop';
import type { CredentialVault } from '../apps/desktop/src/adapters/storage/credentials';
import type { ProjectSnapshot } from '../apps/desktop/src/adapters/contracts/api';
import { localizeHostText } from '../apps/desktop/src/localization/host-text';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { GenerationGatewayError } from '../packages/application/src/generation-ports';

test('host errors translate known system messages and preserve dynamic user names and unknown content', () => {
  assert.equal(localizeHostText('请先创建或打开工程。', 'en'), 'Create or open a project first.');
  assert.equal(localizeHostText('素材缺失：用户的素材', 'en'), 'Media is missing: 用户的素材');
  assert.equal(localizeHostText('Media is missing: 用户的素材', 'zh-CN'), '素材缺失：用户的素材');
  assert.equal(
    localizeHostText('My user-authored text 保持原样', 'en'),
    'My user-authored text 保持原样',
  );
});

test('legacy pending generation approvals survive a language switch without changing canonical tasks or user content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'framo-approval-language-'));
  const projectPath = join(root, 'project');
  const database = ProjectDatabase.create(projectPath, 'User project', 640, 360, 30);
  database.transaction((state) => {
    state.reviews.push({
      id: 'legacy-review',
      kind: 'generation',
      title: '用户创作标题',
      description: 'My authored description',
      status: 'pending',
      generation: {
        requestId: 'approved-task',
        prompt: '保持原样 user content',
        duration: 4,
        ratio: '16:9',
        estimatedCost: 0.5,
      },
      configHash: '0dadec826e646474b6988c1ed7df2e44a4174ecb5ec5db604ac984f280ab0b89',
      createdAt: '2026-10-14T00:00:00Z',
    });
    state.sessions[0].messages.push(
      { id: 'user', role: 'user', text: '用户已停止此请求。', createdAt: '2026-10-14T00:00:00Z' },
      {
        id: 'assistant',
        role: 'assistant',
        text: '用户已停止此请求。',
        createdAt: '2026-10-14T00:00:00Z',
      },
      { id: 'system', role: 'tool', text: '用户已停止此请求。', createdAt: '2026-10-14T00:00:00Z' },
    );
  });
  database.close();
  const vault = {
    hasKey: () => true,
    currentId: () => 'fixture-account',
    save: () => {},
    get: () => {
      throw Error('No account access expected');
    },
  } as unknown as CredentialVault;
  let submissionAttempts = 0;
  const app = await createDesktopApplication({
    userData: join(root, 'profile'),
    documents: root,
    version: '0.3.0',
    vault,
    workerPaths: { agent: 'unused', kit: 'unused' },
    emit: () => {},
    revealFile: () => {},
    dialog: {
      save: async () => ({ canceled: true }),
      open: async () => ({ canceled: true, filePaths: [] }),
      confirm: async () => ({ response: 1 }),
    },
    jobPorts: {
      provider: () => ({
        submit: async () => {
          submissionAttempts++;
          throw new GenerationGatewayError('Fixture rejected submission', 'rejected');
        },
        status: async () => ({ status: 'failed' }),
        cancel: async () => ({ acknowledged: false }),
      }),
    },
  });
  try {
    app.methods.saveSettings({
      arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      agentModel: 'fixture',
      seedanceModel: 'doubao-seedance-2-5-260628',
      generationCostLimit: 1,
      maxModelCalls: 12,
    });
    const opened = await app.methods.openRecent(projectPath);
    assert.deepEqual(
      opened.sessions[0].messages.map((message) => message.text),
      ['用户已停止此请求。', '用户已停止此请求。', 'The user stopped this request.'],
    );
    app.methods.setLanguage('zh-CN');
    const accepted = app.methods.decideReview({
      reviewId: 'legacy-review',
      decision: 'accept',
    }) as ProjectSnapshot;
    assert.equal(accepted.reviews[0].status, 'accepted');
    assert.equal(
      accepted.reviews[0].configHash,
      '0dadec826e646474b6988c1ed7df2e44a4174ecb5ec5db604ac984f280ab0b89',
    );
    assert.equal(accepted.jobs.length, 1);
    assert.equal(accepted.jobs[0].input.prompt, '保持原样 user content');
    assert.equal(accepted.jobs[0].input.accountRef, 'fixture-account');
    assert.equal('language' in accepted.jobs[0].input, false);
    app.methods.setLanguage('en');
    assert.equal(app.methods.snapshot().reviews[0].title, '用户创作标题');
    assert.equal(app.methods.snapshot().reviews[0].description, 'My authored description');
    assert.equal(submissionAttempts <= 1, true);
  } finally {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('host default names follow the explicit language while existing content survives a switch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'framo-host-language-'));
  const dialogs: { title?: string }[] = [];
  const vault = {
    hasKey: () => true,
    currentId: () => 'fixture-account',
    save: () => {},
  } as unknown as CredentialVault;
  const app = await createDesktopApplication({
    userData: join(root, 'profile'),
    documents: root,
    version: '0.3.0',
    vault,
    workerPaths: { agent: 'unused', kit: 'unused' },
    emit: () => {},
    revealFile: () => {},
    dialog: {
      save: async (options) => {
        dialogs.push(options);
        return { canceled: false, filePath: join(root, 'project') };
      },
      open: async (options) => {
        dialogs.push(options);
        return { canceled: true, filePaths: [] };
      },
      confirm: async () => ({ response: 1 }),
    },
  });
  try {
    assert.throws(() => app.methods.setLanguage('fr' as 'en'));
    assert.equal(app.methods.bootstrap().settings.language, 'en');
    app.methods.saveSettings({
      arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      agentModel: 'fixture',
      seedanceModel: 'doubao-seedance-2-5-260628',
      generationCostLimit: 1,
      maxModelCalls: 12,
    });
    const project = (await app.methods.createProject({
      name: 'User 工程',
      width: 640,
      height: 360,
      fps: 30,
    })) as ProjectSnapshot;
    assert.equal(dialogs[0].title, 'Create Framo project');
    assert.equal(project.project.name, 'User 工程');
    assert.equal(project.sequences[0].name, 'Sequence 01');
    assert.deepEqual(
      project.sequences[0].tracks.map((track) => track.name),
      ['Video', 'Audio'],
    );
    assert.equal(project.sessions[0].title, 'Creative chat');
    assert.throws(
      () => app.methods.preview({ sequenceId: 'missing', expectedRevision: 0 }),
      /Sequence does not exist/,
    );
    app.methods.setLanguage('zh-CN');
    const next = app.methods.createSequence({
      name: '新的作品',
      width: 640,
      height: 360,
      fps: 30,
    }) as ProjectSnapshot;
    assert.deepEqual(
      next.sequences[1].tracks.map((track) => track.name),
      ['画面', '声音'],
    );
    assert.equal(next.sequences[0].name, 'Sequence 01');
    assert.equal(next.project.name, 'User 工程');
    await app.methods.openProject();
    assert.equal(dialogs[1].title, '打开 Framo 工程');
    assert.throws(
      () => app.methods.preview({ sequenceId: 'missing', expectedRevision: 0 }),
      /作品不存在/,
    );
  } finally {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
