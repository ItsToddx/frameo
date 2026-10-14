import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chat } from '../apps/desktop/src/renderer/Chat';
import { Timeline } from '../apps/desktop/src/renderer/Timeline';
import { TooltipProvider } from '../apps/desktop/src/renderer/components/ui/tooltip';
import { I18nProvider } from '../apps/desktop/src/renderer/i18n';
import type { Locale } from '../apps/desktop/src/localization';
import { translate } from '../apps/desktop/src/localization';
import type { Asset, Sequence } from '../apps/desktop/src/adapters/contracts/api';

const render = (element: ReactNode, initialLocale?: Locale) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale,
      children: createElement(TooltipProvider, null, element),
    }),
  );
const noop = () => {};

test('unconfigured assistant renders English onboarding and accessible composer chrome by default', () => {
  const html = render(
    createElement(Chat, {
      snapshot: null,
      settings: {
        arkBaseUrl: 'https://example.test',
        agentModel: '',
        seedanceModel: '',
        hasApiKey: false,
        generationCostLimit: 20,
        maxModelCalls: 10,
      },
      sessionId: null,
      onSession: noop,
      onNewSession: noop,
      onPrompt: async () => false,
      onStop: noop,
      running: false,
      status: '',
      delta: '',
      dirty: false,
      busy: false,
      onSetup: noop,
      onReview: noop,
      onResume: noop,
      onRedo: noop,
      onExportRecipe: noop,
      onRecipeResult: noop,
      onRecipeInput: noop,
    }),
  );
  assert.match(html, /aria-label="Creative Agent"/);
  assert.match(html, /Connect a model to start creating/);
  assert.match(html, /aria-label="Creative request for the Agent"/);
  assert.match(html, /Create or open a project first…/);
  assert.match(html, /Enter to send · Shift \+ Enter for a new line/);
  assert.doesNotMatch(html, /创作 Agent|先创建或打开|Enter 发送/);
});

test('timeline chrome is English while work, track and source names remain authored content', () => {
  const asset: Asset = {
    id: 'source',
    name: '晨光素材',
    kind: 'video',
    path: '/source.mp4',
    url: '',
    hash: 'source',
    duration: 12,
    hasAudio: true,
    createdAt: '',
  };
  const sequence: Sequence = {
    id: 'work',
    name: '我的作品',
    revision: 4,
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [{ id: 'video', name: '主画面', kind: 'video', locked: false, muted: false }],
    clips: [
      {
        id: 'clip',
        trackId: 'video',
        assetVersionId: 'source',
        start: 90,
        duration: 90,
        sourceStart: 1,
        audioGain: 0.5,
        muted: true,
      },
    ],
    captions: [],
  };
  const original = structuredClone(sequence);
  const editor = createElement(Timeline, {
    sequence,
    assets: [asset],
    jobs: [],
    selectedClipId: 'clip',
    onSelectClip: noop,
    onApply: async () => true,
    onDraftChange: async () => true,
    onUndo: noop,
    onRedo: noop,
    canUndo: false,
    canRedo: false,
    onPreview: noop,
    onExport: noop,
    onClose: noop,
    busy: false,
  });
  const html = render(editor);
  assert.match(html, /aria-label="Work timeline"/);
  assert.match(html, /Render preview/);
  assert.match(html, /aria-label="晨光素材, start 90 frames, duration 90 frames"/);
  assert.match(html, /aria-label="Trim start 晨光素材"/);
  assert.match(html, /value="主画面"/);
  assert.match(html, /我的作品/);
  assert.match(html, /Save clip/);
  assert.doesNotMatch(html, /作品时间线|合成预览|保存片段|起点 \/ 秒/);
  const chinese = render(editor, 'zh-CN');
  assert.match(chinese, /aria-label="作品时间线"/);
  assert.match(chinese, /aria-label="晨光素材，起点 90 帧，时长 90 帧"/);
  assert.match(chinese, /保存片段/);
  assert.match(chinese, /value="主画面"/);
  assert.deepEqual(sequence, original);
});

test('Chinese presentation supplies bounded labels, count plurals and prompts without rewriting inputs', () => {
  assert.equal(translate('en', 'chat.reviewCount', { count: 1 }), '1 proposal needs your review');
  assert.equal(translate('en', 'chat.reviewCount', { count: 2 }), '2 proposals need your review');
  assert.equal(translate('zh-CN', 'chat.reviewCount', { count: 2 }), '2 个方案待你审阅');
  assert.equal(
    translate('zh-CN', 'timeline.clipLabel', { name: 'My source', start: 30, duration: 90 }),
    'My source，起点 30 帧，时长 90 帧',
  );
  assert.equal(
    translate('en', 'chat.planPrompt'),
    'Help me plan a 15-second video. Start with a shot script and wait for my approval before generating.',
  );
  assert.equal(
    translate('zh-CN', 'chat.planPrompt'),
    '请帮我设计一个 15 秒的视频创作方案，先给出镜头脚本，等待我确认后再生成。',
  );
});
