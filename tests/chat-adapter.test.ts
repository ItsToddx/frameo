import assert from 'node:assert/strict';
import test from 'node:test';
import { isMessageNotSentError, type AppendMessage } from '@assistant-ui/react';
import type { Session } from '../apps/desktop/src/adapters/contracts/api.js';
import {
  ChatDrafts,
  createChatAdapter,
  isChatSubmitKey,
  projectSessionMessages,
} from '../apps/desktop/src/renderer/chat-adapter.js';

const session: Session = {
  id: 'session-a',
  title: '镜头计划',
  messages: [
    { id: 'user-1', role: 'user', text: '请规划镜头', createdAt: '2026-10-13T01:00:00Z' },
    {
      id: 'tool-1',
      role: 'tool',
      text: '找到 3 个素材',
      agent: '素材检索',
      createdAt: '2026-10-13T01:00:01Z',
    },
  ],
};

test('persisted history and a session-owned stream are projected without changing the host session', () => {
  const messages = projectSessionMessages({
    session,
    delta: '镜头一：',
    running: true,
    streamSessionId: 'session-a',
  });
  assert.deepEqual(
    messages.map((message) => [message.id, message.role, message.content]),
    [
      ['user-1', 'user', [{ type: 'text', text: '请规划镜头' }]],
      ['tool-1', 'assistant', [{ type: 'text', text: '找到 3 个素材' }]],
      ['stream:session-a', 'assistant', [{ type: 'text', text: '镜头一：' }]],
    ],
  );
  assert.equal(messages[1].metadata?.custom?.hostRole, 'tool');
  assert.equal(messages[2].status?.type, 'running');
  assert.equal(session.messages.length, 2);
});

test('another session never displays the active stream and terminal streams disappear', () => {
  assert.equal(
    projectSessionMessages({
      session,
      delta: '另一段对话',
      running: true,
      streamSessionId: 'session-b',
    }).length,
    2,
  );
  assert.equal(
    projectSessionMessages({
      session,
      delta: '已结束的输出',
      running: false,
      streamSessionId: 'session-a',
    }).length,
    2,
  );
});

test('a persisted assistant response replaces its matching stream instead of appearing twice', () => {
  const completed: Session = {
    ...session,
    messages: [
      ...session.messages,
      {
        id: 'answer-1',
        role: 'assistant',
        text: '镜头一：晨光',
        createdAt: '2026-10-13T01:00:02Z',
      },
    ],
  };
  const messages = projectSessionMessages({
    session: completed,
    delta: '镜头一：晨光',
    running: true,
    streamSessionId: completed.id,
  });
  assert.equal(messages.length, 3);
  assert.equal(messages.at(-1)?.id, 'answer-1');
});

test('failed host submissions retain the exact draft while each conversation keeps its own text', async () => {
  const drafts = new ChatDrafts();
  drafts.set('project-a/session-a', '  需要保留的草稿\n第二行  ');
  drafts.set('project-a/session-b', '另一段对话');
  assert.equal(await drafts.submit('project-a/session-a', async () => false), false);
  assert.equal(drafts.get('project-a/session-a'), '  需要保留的草稿\n第二行  ');
  assert.equal(drafts.get('project-a/session-b'), '另一段对话');
  assert.equal(
    await drafts.submit('project-a/session-a', async (text) => text === '需要保留的草稿\n第二行'),
    true,
  );
  assert.equal(drafts.get('project-a/session-a'), '');
  assert.equal(drafts.get('project-a/session-b'), '另一段对话');
});

test('an in-flight send cannot erase newer text or submit the same conversation twice', async () => {
  const drafts = new ChatDrafts();
  drafts.set('a', '镜头计划');
  let complete!: (sent: boolean) => void;
  const pending = drafts.submit(
    'a',
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  assert.equal(
    await drafts.submit('a', async () => {
      throw new Error('A second send must not reach the host');
    }),
    false,
  );
  drafts.set('a', '接下来添加字幕');
  complete(true);
  assert.equal(await pending, true);
  assert.equal(drafts.get('a'), '接下来添加字幕');
});

test('runtime sends go through the host and return failed submissions to its composer', async () => {
  const drafts = new ChatDrafts();
  drafts.set('a', '  帮我整理素材  ');
  const submitted: string[] = [];
  let failure: string | undefined;
  const adapter = createChatAdapter({
    session,
    delta: '',
    running: false,
    drafts,
    draftKey: 'a',
    disabled: false,
    sendDisabled: false,
    onPrompt: async (text) => {
      submitted.push(text);
      return false;
    },
    onStop: () => {},
    onSubmission: (state) => {
      failure = state.error;
    },
  });
  const message: AppendMessage = {
    role: 'user',
    content: [{ type: 'text', text: '  帮我整理素材  ' }],
    attachments: [],
    parentId: 'tool-1',
    sourceId: null,
    runConfig: {},
    metadata: { custom: {} },
    createdAt: new Date('2026-10-13T01:00:03Z'),
  };
  await assert.rejects(adapter.onNew(message), isMessageNotSentError);
  assert.deepEqual(submitted, ['帮我整理素材']);
  assert.equal(
    failure,
    'Message was not sent. Your draft is kept. Check model settings and project state, then retry.',
  );
  assert.equal(drafts.get('a'), '  帮我整理素材  ');
  assert.equal(adapter.messages?.length, 2);
});

test('Enter sends only outside composition and Shift+Enter remains a newline', () => {
  assert.equal(
    isChatSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }, false),
    true,
  );
  assert.equal(
    isChatSubmitKey({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }, false),
    false,
  );
  assert.equal(
    isChatSubmitKey({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 }, false),
    false,
  );
  assert.equal(
    isChatSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 }, false),
    false,
  );
  assert.equal(
    isChatSubmitKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }, true),
    false,
  );
});

test('a host-created session retains its initial draft through a failed submission', async () => {
  const drafts = new ChatDrafts();
  drafts.set('project/new', '第一个镜头');
  let complete!: (sent: boolean) => void;
  const pending = drafts.submit(
    'project/new',
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  drafts.adopt('project/new', 'project/session-a');
  assert.equal(drafts.get('project/session-a'), '第一个镜头');
  complete(false);
  await pending;
  assert.equal(drafts.get('project/session-a'), '第一个镜头');
  assert.equal(await drafts.submit('project/session-a', async () => true), true);
  assert.equal(drafts.get('project/session-a'), '');
});
