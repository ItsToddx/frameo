import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import electronBinary from 'electron';
import type { DesktopApi } from '../apps/desktop/src/adapters/contracts/api';
import { probe } from '../apps/desktop/src/adapters/runtime/media';

const directory = resolve('test-results/desktop-smoke');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const image = join(directory, 'reference.png');
const canvas = createCanvas(640, 360);
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 640, 360);
gradient.addColorStop(0, '#183c43');
gradient.addColorStop(1, '#be925c');
context.fillStyle = gradient;
context.fillRect(0, 0, 640, 360);
context.fillStyle = '#e7d9bd';
context.font = 'bold 40px sans-serif';
context.fillText('FRAMEO', 56, 185);
await writeFile(image, canvas.toBuffer('image/png'));
const project = join(directory, 'Smoke.frameo');
const output = join(directory, 'Smoke.mp4');
const env: NodeJS.ProcessEnv = { ...process.env, FRAMEO_USER_DATA: join(directory, 'user-data') };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath: process.env.FRAMEO_TEST_EXECUTABLE ?? (electronBinary as unknown as string),
  args: process.env.FRAMEO_TEST_EXECUTABLE ? [] : [process.cwd()],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ),
  timeout: 60000,
});
const errors: string[] = [];
let page: import('@playwright/test').Page | undefined;
async function waitForJob(kind: 'preview' | 'export') {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const snapshot = await page!.evaluate(() => window.frameo.snapshot());
    const job = snapshot.jobs.filter((j) => j.kind === kind).at(-1);
    if (job?.status === 'succeeded') return job;
    if (job && ['failed', 'cancelled'].includes(job.status))
      throw new Error(job.error ?? 'Job failed');
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Render job timed out');
}
try {
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByTestId('welcome-create').waitFor({ timeout: 30000 });
  assert.equal(
    await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
    'undefined',
  );
  await writeFile(join(directory, 'unregistered-private.txt'), 'private-test-fixture');
  const escaped = await page.evaluate(
    async (url) => {
      try {
        await fetch(url).then((response) => response.text());
        return true;
      } catch {
        return false;
      }
    },
    'file://' + join(directory, 'unregistered-private.txt'),
  );
  assert.equal(escaped, false, 'Renderer must not fetch arbitrary file URLs');
  const blocked = await page.evaluate(async () => {
    try {
      await window.frameo.createProject({ name: 'No key', width: 1920, height: 1080, fps: 30 });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(blocked, true, 'Host must enforce model setup');
  await application.evaluate(
    ({ dialog }, paths) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: paths.project,
      })) as typeof dialog.showSaveDialog;
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [paths.image],
      })) as typeof dialog.showOpenDialog;
    },
    { project, image },
  );
  await page.getByTestId('welcome-create').click();
  await page.getByTestId('agent-model-input').fill('integration-only-agent');
  await page.getByTestId('seedance-model-input').fill('doubao-seedance-2-5-260628');
  await page.getByTestId('api-key-input').fill('integration-test-key-never-send');
  await page.getByTestId('save-settings').click();
  await page.getByTestId('welcome-create').click();
  await page.getByTestId('project-name-input').fill('镜头之间');
  await page.getByTestId('confirm-create-project').click();
  await page.getByTestId('import-media').waitFor();
  await page.getByTestId('import-media').click();
  await page.getByRole('button', { name: '将 reference.png 添加至作品', exact: true }).click();
  await page.getByTestId('timeline-clip').waitFor();
  await page.getByTestId('timeline-clip').click();
  await page.locator('.inspector-form input[name="duration"]').fill('3');
  await page.getByTestId('save-clip').click();
  await page.getByRole('button', { name: '字幕', exact: true }).first().click();
  await page.locator('.inspector-form textarea[name="text"]').fill('让想法成为下一个镜头');
  await page.locator('.inspector-form input[name="duration"]').fill('3');
  await page.getByRole('button', { name: '添加字幕', exact: true }).click();
  const edited = await page.evaluate(() => window.frameo.snapshot());
  assert.equal(edited.sequences[0].clips[0].duration, 90);
  assert.equal(edited.sequences[0].captions[0].text, '让想法成为下一个镜头');
  await page.getByRole('button', { name: '撤销剪辑', exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.frameo.snapshot())).sequences[0].captions.length,
    0,
  );
  await page.getByRole('button', { name: '重做剪辑', exact: true }).click();
  await page.getByTestId('preview-button').click();
  await waitForJob('preview');
  const video = page.getByTestId('preview-video');
  await video.waitFor();
  await page.waitForFunction(
    () => {
      const v = document.querySelector('[data-testid="preview-video"]') as HTMLVideoElement | null;
      return v && v.readyState >= 2;
    },
    undefined,
    { timeout: 30000 },
  );
  assert.equal(await video.evaluate((v: HTMLVideoElement) => Math.round(v.duration)), 3);
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, output);
  await page.getByTestId('export-button').click();
  await waitForJob('export');
  const metadata = await probe(output);
  assert.equal(metadata.streams.find((s) => s.codec_type === 'video')?.nb_frames, '90');
  await page
    .getByRole('button', { name: '关闭窗口', exact: true })
    .last()
    .click()
    .catch(() => {});
  await page.evaluate(async () => {
    const s = await window.frameo.snapshot();
    await window.frameo.saveMemory({ scope: 'project', content: '优先使用简洁的中文字幕。' });
    await window.frameo.closeProject();
    await window.frameo.openRecent(s.project.path);
  });
  const reopened = await page.evaluate(() => window.frameo.snapshot());
  assert.equal(reopened.sequences[0].clips[0].duration, 90);
  assert.equal(reopened.sequences[0].captions.length, 1);
  assert.equal(reopened.memories.length, 1);
  await page.locator('.sequence-list-row').first().click();
  await page.getByTestId('preview-video').waitFor();
  await page.locator('.toast').waitFor({ state: 'hidden', timeout: 10000 });
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/workbench.png', fullPage: true });
  // Install actual code in its isolated worker and execute an authored recipe without model fixtures.
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({
      response: 0,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox;
  }, resolve('kits/examples/caption-case'));
  const installed = await page.evaluate(() => window.frameo.importKit());
  assert.ok(installed.some((kit) => kit.id === 'example.caption-case' && kit.enabled));
  const latest = await page.evaluate(() => window.frameo.snapshot()),
    selected = latest.sequences[0],
    caption = selected.captions[0];
  await page.evaluate(async (input) => window.frameo.apply(input), {
    sequenceId: selected.id,
    expectedRevision: selected.revision,
    commandId: 'native-fixture-caption',
    commands: [{ type: 'upsertCaption' as const, caption: { ...caption, text: 'Frameo' } }],
  });
  const declaredRecipe = join(directory, 'native-recipe.frameokit');
  await writeFile(
    declaredRecipe,
    JSON.stringify({
      manifest: {
        schemaVersion: 1,
        id: 'fixture.native-recipe',
        name: 'Native caption recipe',
        version: '1.0.0',
        description: 'Test actual native worker and reviews',
        author: 'Frameo test',
        license: 'Apache-2.0',
        hostApi: '1',
        source: 'fixture',
        permissions: ['project.read', 'project.propose'],
        dependencies: { 'example.caption-case': '1.0.0' },
        capabilities: [{ id: 'fixture.caption-recipe', kind: 'recipe' }],
      },
      agents: [],
      recipes: [
        {
          descriptor: {
            id: 'fixture.caption-recipe',
            name: 'Native caption recipe',
            kind: 'recipe',
            description: 'Fixture',
            permissions: ['project.read', 'project.propose'],
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
          },
          steps: [
            {
              id: 'case',
              title: 'Capitalize caption',
              role: 'editor',
              capabilityId: 'example.caption-case.apply',
              dependsOn: [],
              input: { captionIds: { from: 'input', pointer: '/captionIds' }, textCase: 'upper' },
              reviewBefore: false,
              reviewAfter: true,
            },
          ],
          outputs: { film: { from: 'step', stepId: 'case', pointer: '/artifacts' } },
        },
      ],
    }),
  );
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, declaredRecipe);
  await page.evaluate(() => window.frameo.importKit());
  const started = await page.evaluate(async (input) => window.frameo.startRecipe(input), {
    kitId: 'fixture.native-recipe',
    title: 'Native fixture',
    sequenceId: selected.id,
    input: { captionIds: [caption.id] },
  });
  const recipeId = started.recipes.at(-1)!.id;
  await page.evaluate(async (recipeId) => window.frameo.resumeRecipe({ recipeId }), recipeId);
  const stop = Date.now() + 10000;
  let produced: Awaited<ReturnType<DesktopApi['snapshot']>>;
  while (true) {
    produced = await page.evaluate(() => window.frameo.snapshot());
    if (
      produced.reviews.some((review) => review.recipeId === recipeId && review.status === 'pending')
    )
      break;
    if (Date.now() > stop) throw new Error(JSON.stringify(produced.recipes.at(-1)));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const review = produced!.reviews.find((review) => review.recipeId === recipeId)!;
  assert.equal(review.commands?.[0].type, 'upsertCaption');
  assert.equal(produced!.sequences[0].captions[0].text, 'Frameo');
  await page.evaluate((input) => window.frameo.decideReview(input), {
    reviewId: review.id,
    decision: 'accept' as const,
  });
  await page.evaluate((recipeId) => window.frameo.resumeRecipe({ recipeId }), recipeId);
  const materialized = await page.evaluate(() => window.frameo.snapshot()),
    run = materialized.recipes.find((recipe) => recipe.id === recipeId)!,
    step = run.steps[0];
  assert.equal(step.reviewPhase, 'result');
  assert.equal(materialized.sequences[0].captions[0].text, 'FRAMEO');
  await page.evaluate((input) => window.frameo.decideRecipeResult(input), {
    recipeId,
    expectedRevision: run.revision,
    stepId: step.id,
    attempt: step.attempt,
    resultHash: step.resultHash!,
    decision: 'accept' as const,
  });
  await page.evaluate((recipeId) => window.frameo.resumeRecipe({ recipeId }), recipeId);
  assert.equal(
    (await page.evaluate(() => window.frameo.snapshot())).recipes.find(
      (recipe) => recipe.id === recipeId,
    )!.status,
    'completed',
  );
  await page.evaluate(() =>
    window.frameo.setKitEnabled({ id: 'example.caption-case', enabled: false }),
  );
  assert.ok(
    (await page.evaluate(() => window.frameo.listKits())).find(
      (kit) => kit.id === 'example.caption-case',
    )?.enabled === false,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        desktop: true,
        modelGate: true,
        isolatedPreload: true,
        ipc: true,
        import: true,
        edit: true,
        undoRedo: true,
        preview: true,
        exportFrames: 90,
        persistence: true,
        memories: true,
        nativeKitWorker: true,
        authoredRecipe: true,
        exactReviews: true,
        cloudGeneration: 'not invoked; requires real user credentials',
      },
      null,
      2,
    ),
  );
  console.log(
    'Desktop smoke passed: model gate → real IPC → import → trim/caption → undo/redo → native preview → 90-frame MP4 → reopen → native Kit worker → authored recipe and exact reviews. No cloud calls.',
  );
} finally {
  await application.close();
}
