import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecipeList } from '../apps/desktop/src/renderer/Panels';
import { I18nProvider, type Locale } from '../apps/desktop/src/renderer/i18n';
import { TooltipProvider } from '../apps/desktop/src/renderer/components/ui/tooltip';
import { startRun } from '../packages/core/src/recipe';
import type { RecipeRun } from '../apps/desktop/src/adapters/contracts/api';
import { presentJobTitle, presentKit } from '../apps/desktop/src/localization/panels';
import { LanguagePicker } from '../apps/desktop/src/renderer/ui';

function renderRecipes(locale: Locale, recipes: RecipeRun[]) {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(TooltipProvider, {
        children: createElement(RecipeList, {
          recipes,
          jobs: [],
          busy: false,
          dirty: false,
          onResume: () => {},
          onRedo: () => {},
          onExport: () => {},
          onResult: () => {},
          onInput: () => {},
        }),
      }),
    }),
  );
}

test('workflow review translates controls and states while keeping authored names and exact bound content', () => {
  const run: RecipeRun = {
    ...structuredClone(
      startRun(
        {
          descriptor: { id: 'custom.recipe', name: '我的自定义 Workflow' },
          steps: [
            {
              id: 'prepare',
              title: '用户写的步骤',
              capabilityId: 'custom.tool',
              role: 'creative',
              dependsOn: [],
              input: {},
              reviewAfter: true,
            },
          ],
          outputs: {},
        },
        {},
        {},
        { projectId: 'project' },
        { id: 'run' },
      ),
    ),
    kitId: 'custom.kit',
    status: 'paused',
  };
  run.steps[0] = {
    ...run.steps[0],
    status: 'review',
    reviewPhase: 'input',
    attempt: 2,
    input: { prompt: '保存原文 English 中文', model: 'model-123', budget: 12.5 },
    inputHash: 'exact-input-hash',
    result: '模型返回的原文',
  };
  const before = structuredClone(run);
  const en = renderRecipes('en', [run]);
  const zh = renderRecipes('zh-CN', [run]);
  assert.match(en, /Awaiting continuation/);
  assert.match(en, /Creative · Attempt 2 · Awaiting review/);
  assert.match(en, /Complete input for this step/);
  assert.match(en, /Confirm input/);
  assert.match(en, /aria-label="Redo step 用户写的步骤"/);
  assert.match(zh, /待继续/);
  assert.match(zh, /创意 · 第 2 次 · 待审阅/);
  assert.match(zh, /确认输入/);
  for (const html of [en, zh]) {
    assert.match(html, /我的自定义 Workflow/);
    assert.match(html, /模型返回的原文/);
    assert.match(html, /保存原文 English 中文/);
    assert.match(html, /&quot;model&quot;: &quot;model-123&quot;/);
    assert.match(html, /&quot;budget&quot;: 12\.5/);
  }
  assert.deepEqual(run, before);
});

test('language choices have a visible associated label in either locale', () => {
  for (const [locale, label] of [
    ['en', 'Language'],
    ['zh-CN', '语言'],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: locale,
        children: createElement(LanguagePicker),
      }),
    );
    assert.match(
      html,
      new RegExp(`<label[^>]*><span>${label}</span><select[^>]*data-testid="language-select"`),
    );
  }
});

test('prompt-derived task titles stay exact in both languages while system preview and export titles translate', () => {
  for (const kind of ['seedance', 'motion']) {
    for (const locale of ['en', 'zh-CN'] as const) {
      assert.equal(presentJobTitle(locale, { kind, title: '导出 城市' }), '导出 城市');
    }
  }
  assert.equal(presentJobTitle('en', { kind: 'export', title: '导出 城市' }), 'Export 城市');
  assert.equal(presentJobTitle('en', { kind: 'preview', title: '合成预览' }), 'Composite preview');
  assert.equal(presentJobTitle('zh-CN', { kind: 'export', title: 'Export 城市' }), '导出 城市');
});

test('built-in Kit presentation translates only known built-in IDs and leaves canonical and custom content intact', () => {
  const builtin = {
    id: 'reelbeam.creative-kit',
    source: 'builtin',
    name: 'Creative director',
    description: 'Plans scripts, structure and shot intent.',
  };
  const before = structuredClone(builtin);
  assert.deepEqual(presentKit('en', builtin), {
    name: 'Creative director',
    description: 'Plans scripts, structure and shot intent.',
  });
  assert.deepEqual(presentKit('zh-CN', builtin), {
    name: '创意导演',
    description: '规划脚本、结构和镜头意图。',
  });
  for (const custom of [
    { ...builtin, id: 'custom.creative-kit', name: '我的 Creative director' },
    { ...builtin, source: '/Users/me/custom-kit', description: '用户创作说明' },
  ]) {
    assert.deepEqual(presentKit('zh-CN', custom), {
      name: custom.name,
      description: custom.description,
    });
  }
  assert.deepEqual(builtin, before);
});
