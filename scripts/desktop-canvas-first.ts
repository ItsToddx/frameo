import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';

const directory = resolve('test-results/desktop-canvas-first');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const image = join(directory, 'Coast reference.png');
const canvas = createCanvas(1280, 720),
  ctx = canvas.getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 720);
gradient.addColorStop(0, '#c7d6dc');
gradient.addColorStop(0.53, '#91aab7');
gradient.addColorStop(0.54, '#668494');
gradient.addColorStop(1, '#cad0c7');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 1280, 720);
ctx.fillStyle = '#aeb8af';
ctx.beginPath();
ctx.moveTo(0, 720);
ctx.bezierCurveTo(400, 460, 670, 670, 1280, 420);
ctx.lineTo(1280, 720);
ctx.fill();
ctx.fillStyle = '#e8ede8';
ctx.font = '14px sans-serif';
ctx.fillText('LOCAL REFERENCE / ACCEPTANCE FIXTURE', 32, 680);
await writeFile(image, canvas.toBuffer('image/png'));
const project = join(directory, 'Quiet Coast.framo');
const database = ProjectDatabase.create(project, 'Quiet Coast', 1280, 720, 24);
database.transaction((state) => {
  state.sessions[0].messages = [
    {
      id: 'fixture-user',
      role: 'user',
      text: 'A quiet coastal film. Natural light, soft cuts.',
      createdAt: '2026-10-14T00:00:00Z',
    },
    {
      id: 'fixture-assistant',
      role: 'assistant',
      text: 'Let’s start with a reference. Drop it onto the canvas, then onto your film to add the first shot.',
      createdAt: '2026-10-14T00:00:02Z',
    },
  ];
  state.reviews.push({
    id: 'canvas-review',
    kind: 'edit',
    title: 'A closing line',
    description: 'Add a short closing caption to the film.',
    status: 'pending',
    sequenceId: state.sequences[0].id,
    expectedRevision: 0,
    commands: [
      {
        type: 'upsertCaption',
        caption: {
          id: 'fixture-caption',
          text: 'Follow the light',
          start: 0,
          duration: 24,
          fontSize: 36,
          color: '#ffffff',
          position: 'bottom',
        },
      },
    ],
    createdAt: '2026-10-14T00:00:03Z',
  });
});
database.close();
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  FRAMO_USER_DATA: join(directory, 'profile'),
};
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.FRAMO_TEST_EXECUTABLE ?? (electronBinary as unknown as string),
  args: process.env.FRAMO_TEST_EXECUTABLE ? [] : [process.cwd()],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(environment).filter((x): x is [string, string] => x[1] !== undefined),
  ),
  timeout: 60000,
});
try {
  await app.evaluate(() => {
    (globalThis as unknown as { calls: number }).calls = 0;
    globalThis.fetch = async () => {
      (globalThis as unknown as { calls: number }).calls++;
      throw Error('No model calls during canvas acceptance');
    };
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByTestId('welcome-create').waitFor();
  assert.equal(await page.locator('.activity-rail,.app-status,.library-panel').count(), 0);
  await page.screenshot({ path: join(directory, 'welcome.png') });
  await page.evaluate(() =>
    window.framo.saveSettings({
      arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      agentModel: 'canvas-no-inference',
      seedanceModel: 'doubao-seedance-2-5-260628',
      apiKey: 'canvas-fixture-key',
      generationCostLimit: 1,
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
  await page.getByRole('main').getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByTestId('sequence-card').waitFor();
  assert.equal(await page.getByTestId('timeline').count(), 0);
  assert.equal(await page.locator('.agent-tabs,.session-bar').count(), 0);
  await page.getByRole('button', { name: 'Accept proposal', exact: true }).click();
  assert.equal((await page.evaluate(() => window.framo.snapshot())).reviews[0].status, 'accepted');
  const board = page.getByTestId('canvas');
  const bounds = (await board.boundingBox())!;
  assert.ok(bounds.width >= (await page.evaluate(() => innerWidth)) * 0.67);
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [image], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
    await cdp.send('Input.dispatchDragEvent', { type, x: bounds.x + 60, y: bounds.y + 170, data });
  await page.getByTestId('asset-card').waitFor();
  assert.equal((await page.evaluate(() => window.framo.snapshot())).assets.length, 1);
  const forged = await page.evaluate(async () => {
    try {
      const file = new File(['not on disk'], 'fake.png');
      Object.assign(file, { path: '/etc/passwd' });
      await window.framo.importFiles([file]);
      return 'accepted';
    } catch {
      return 'rejected';
    }
  });
  assert.equal(forged, 'rejected');
  assert.equal((await page.evaluate(() => window.framo.snapshot())).assets.length, 1);
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.waitForTimeout(220);
  const source = (await page.getByTestId('asset-card').boundingBox())!,
    target = (await page.getByTestId('sequence-card').boundingBox())!;
  await page.mouse.move(source.x + 60, source.y + 85);
  await page.mouse.down();
  await page.mouse.move(target.x + 60, target.y + 85, { steps: 25 });
  await page.mouse.up();
  await page.waitForFunction(
    async () => (await window.framo.snapshot()).sequences[0].clips.length === 1,
  );
  assert.equal(await page.getByTestId('timeline').count(), 0, 'Adoption stays on the board');
  await page.getByTestId('sequence-card').getByText('1 clip', { exact: true }).waitFor();
  const composer = page.getByTestId('agent-prompt');
  await composer.fill('Keep this idea in the conversation');
  await page.screenshot({ path: join(directory, 'pre-reference.png') });
  await page.getByTestId('asset-card').hover();
  await page
    .getByRole('button', { name: 'Drag Coast reference.png to the conversation', exact: true })
    .dragTo(page.getByTestId('agent-panel'));
  await page.locator('.chat-context').filter({ hasText: 'Coast reference.png' }).waitFor();
  assert.equal(await composer.inputValue(), 'Keep this idea in the conversation');
  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.screenshot({ path: join(directory, 'canvas-en.png') });
  await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
  await page.waitForTimeout(220);
  await page
    .getByTestId('sequence-card')
    .getByRole('button', { name: /^Edit sequence/ })
    .click();
  await page.getByTestId('timeline').waitFor();
  assert.equal(await page.locator('.inspector').isVisible(), false);
  await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
  assert.equal((await page.evaluate(() => window.framo.snapshot())).sequences[0].clips.length, 0);
  await page.getByRole('button', { name: 'Collapse timeline', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1120, 760);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(directory, 'canvas-compact.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByTestId('project-menu').click();
  await page.getByTestId('language-select').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.getByTestId('project-menu').click();
  assert.equal(await composer.inputValue(), 'Keep this idea in the conversation');
  await page.screenshot({ path: join(directory, 'canvas-zh.png') });
  assert.equal(await app.evaluate(() => (globalThis as unknown as { calls: number }).calls), 0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        canvasAndConversation: true,
        auxiliaryUIHiddenByDefault: true,
        nativeFileDrop: true,
        forgedFileRejected: true,
        dragAdoption: true,
        referenceDropPreservesDraft: true,
        inlineExactApproval: true,
        adoptionUndo: true,
        optionalInspector: true,
        bilingual: true,
        minimumWindow: true,
        cloudCalls: 0,
      },
      null,
      2,
    ),
  );
  console.log('Canvas-first desktop acceptance passed.');
} finally {
  await app.close();
}
