import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { archiveMedia } from '../apps/desktop/src/adapters/runtime/media';

// UI acceptance data is deliberately synthetic; no model requests or private media.
const directory = resolve('test-results/desktop-ui');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const project = join(directory, 'Interface.frameo');
const image = join(directory, 'reference.png');
const canvas = createCanvas(640, 360);
const ctx = canvas.getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 640, 360);
gradient.addColorStop(0, '#26435b');
gradient.addColorStop(1, '#95b6be');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 640, 360);
ctx.fillStyle = 'white';
ctx.font = '36px sans-serif';
ctx.fillText('REFERENCE / UI FIXTURE', 40, 190);
await writeFile(image, canvas.toBuffer('image/png'));
const db = ProjectDatabase.create(project, '海岸故事 · 界面验收', 1280, 720, 24);
const asset = await archiveMedia(project, image, '海岸参考.png');
db.transaction((state) => {
  const sequence = state.sequences[0];
  sequence.clips.push({
    id: 'fixture-clip',
    trackId: sequence.tracks[0].id,
    assetVersionId: asset.id,
    start: 0,
    duration: 120,
    sourceStart: 0,
    audioGain: 1,
    muted: false,
  });
  state.assets.push(asset);
  state.canvas.items.push({
    id: 'fixture-card',
    kind: 'asset',
    refId: asset.id,
    x: 470,
    y: 120,
    width: 260,
    height: 210,
  });
  state.sessions[0].messages = Array.from({ length: 30 }, (_, i) => ({
    id: 'fixture-message-' + i,
    role: i % 2 ? 'assistant' : 'user',
    text:
      i % 2
        ? '### 镜头计划\n\n1. 海岸环境建立镜头\n2. 近景呈现产品细节\n3. 留白收尾\n\n确认方案后再生成。'
        : '这是界面验收记录，请规划一段海岸影片。',
    createdAt: new Date(1791850000000 + i * 60000).toISOString(),
  }));
  state.sessions.push({ id: 'fixture-second-session', title: '另一份创作对话', messages: [] });
  state.reviews.push({
    id: 'fixture-review',
    kind: 'edit',
    title: '添加片尾字幕',
    description: '在当前作品结尾显示字幕，保留原始素材。',
    status: 'pending',
    sequenceId: sequence.id,
    expectedRevision: 0,
    commands: [
      {
        type: 'upsertCaption',
        caption: {
          id: 'fixture-caption',
          text: '沿着海岸，继续前行',
          start: 72,
          duration: 48,
          fontSize: 40,
          color: '#ffffff',
          position: 'bottom',
        },
      },
    ],
    createdAt: new Date().toISOString(),
  });
});
db.close();
const env: NodeJS.ProcessEnv = { ...process.env, FRAMEO_USER_DATA: join(directory, 'profile') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.FRAMEO_TEST_EXECUTABLE ?? (electronBinary as unknown as string),
  args: process.env.FRAMEO_TEST_EXECUTABLE ? [] : [process.cwd()],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
  timeout: 60000,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByTestId('welcome-create').waitFor();
  await page.screenshot({ path: join(directory, 'welcome.png') });
  const settingsButton = page.getByRole('button', { name: '模型与应用设置', exact: true });
  await settingsButton.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await page.locator(':focus').getAttribute('data-testid'), 'agent-model-input');
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.locator(':focus').evaluate((element) => !!element.closest('[role="dialog"]')),
      true,
      'Modal must contain focus',
    );
  }
  await page.screenshot({ path: join(directory, 'settings.png') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await settingsButton.evaluate((element) => element === document.activeElement),
    true,
    'Close restores trigger focus',
  );
  await page.evaluate(() =>
    window.frameo.saveSettings({
      arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      agentModel: 'ui-no-inference',
      seedanceModel: 'doubao-seedance-2-5-260628',
      apiKey: 'ui-fixture-key',
      generationCostLimit: 2,
      maxModelCalls: 1,
    }),
  );
  await page.reload();
  await page.getByTestId('welcome-create').waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, project);
  await page.getByRole('main').getByRole('button', { name: '打开工程', exact: true }).click();
  await page.getByTestId('asset-card').waitFor();
  await page.screenshot({ path: join(directory, 'canvas.png') });
  const compose = page.getByRole('textbox', { name: '给 Agent 的创作指令' });
  await compose.fill('保留这份草稿');
  await compose.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        isComposing: true,
      }),
    ),
  );
  assert.equal(await compose.inputValue(), '保留这份草稿');
  await page.getByRole('tab', { name: /审阅/ }).click();
  await page.locator('.review-card').waitFor();
  await page.screenshot({ path: join(directory, 'review.png') });
  await page.getByRole('tab', { name: /对话/ }).click();
  assert.equal(await compose.inputValue(), '保留这份草稿', 'Tabs preserve composer draft');
  const feed = page.locator('.chat-feed');
  await feed.evaluate((element) => {
    element.scrollTop = 80;
  });
  await page.waitForTimeout(200);
  const initialScroll = await feed.evaluate((element) => element.scrollTop);
  await page.evaluate(() =>
    window.frameo.saveMemory({ scope: 'project', content: '界面测试偏好' }),
  );
  await page.waitForTimeout(300);
  assert.ok(
    Math.abs((await feed.evaluate((element) => element.scrollTop)) - initialScroll) < 5,
    'Snapshot updates must not jump conversation history',
  );
  await page.getByRole('tab', { name: /审阅/ }).click();
  await page.getByRole('button', { name: '采纳方案', exact: true }).click();
  const accepted = await page.evaluate(() => window.frameo.snapshot());
  assert.equal(accepted.reviews[0].status, 'accepted');
  assert.equal(accepted.sequences[0].captions[0].text, '沿着海岸，继续前行');
  await page.locator('.sequence-list-row').first().click();
  await page.getByTestId('timeline-clip').click();
  await page.screenshot({ path: join(directory, 'editor.png') });
  await page.getByTestId('timeline-clip').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('save-timeline-draft').click();
  assert.equal(
    (await page.evaluate(() => window.frameo.snapshot())).sequences[0].clips[0].start,
    1,
  );
  await page.getByRole('button', { name: '撤销剪辑', exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.frameo.snapshot())).sequences[0].clips[0].start,
    0,
  );

  await page.locator('.inspector-form input[name="duration"]').fill('4');
  assert.equal(await page.getByTestId('discard-timeline-draft').isVisible(), true);
  await page.getByTestId('discard-timeline-draft').click();
  assert.equal(
    (await page.evaluate(() => window.frameo.snapshot())).sequences[0].clips[0].duration,
    120,
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1120, 760);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(directory, 'editor-compact.png') });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'No window overflow',
  );
  assert.equal(await page.getByTestId('export-button').isVisible(), true);
  assert.ok(
    (await compose.boundingBox())!.height > 30,
    'Composer remains reachable at minimum size',
  );
  const fieldBounds = await page.locator('.inspector-form input[name="duration"]').boundingBox();
  const stageBounds = await page.locator('.editor-stage').boundingBox();
  assert.ok(
    fieldBounds &&
      stageBounds &&
      fieldBounds.y + fieldBounds.height <= stageBounds.y + stageBounds.height,
    'Compact inspector keeps timing fields visible',
  );
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = (() =>
      new Promise((resolve) => {
        (
          globalThis as unknown as {
            uiSaveResolve: (value: { canceled: boolean; filePath: string }) => void;
          }
        ).uiSaveResolve = resolve;
      })) as typeof dialog.showSaveDialog;
  });
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByTestId('project-name-input').fill('保留待保存的工程名称');
  await page.getByTestId('confirm-create-project').click();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLButtonElement>('[data-testid="confirm-create-project"]')?.disabled,
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('dialog').isVisible(),
    true,
    'Busy Escape cannot unmount the form',
  );
  assert.equal(await page.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  assert.equal(
    await page.getByRole('button', { name: '关闭窗口', exact: true }).isDisabled(),
    true,
  );
  await page.mouse.click(30, 100);
  assert.equal(
    await page.getByRole('dialog').isVisible(),
    true,
    'Busy outside interaction cannot close the form',
  );
  await app.evaluate(() => {
    (
      globalThis as unknown as {
        uiSaveResolve: (value: { canceled: boolean; filePath: string }) => void;
      }
    ).uiSaveResolve({ canceled: true, filePath: '' });
  });
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>('[data-testid="confirm-create-project"]')
        ?.disabled,
  );
  assert.equal(await page.getByTestId('project-name-input').inputValue(), '保留待保存的工程名称');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        modalFocus: true,
        focusRestored: true,
        imeDraftPreserved: true,
        tabDraftPreserved: true,
        historyScrollPreserved: true,
        exactReviewApplied: true,
        draftDiscard: true,
        frameKeyboardMoveAndUndo: true,
        busyDismissalAndRetainedInputs: true,
        compactTimingFieldsVisible: true,
        desktopSizes: [
          [1520, 1000],
          [1120, 760],
        ],
        reducedMotion: true,
        cloudCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log('Desktop UI acceptance passed. All data is local synthetic fixtures; no inference.');
} finally {
  await app.close();
}
