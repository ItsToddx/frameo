import assert from 'node:assert/strict';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';
import {
  probe,
  runProcess,
  ffmpegPath,
  ffprobePath,
} from '../apps/desktop/src/adapters/runtime/media';

// Uses an existing generated project copy. The dummy key satisfies the local
// configuration gate; main-process network access is rejected throughout.
const source = process.argv[process.argv.indexOf('--project') + 1];
assert.ok(
  process.argv.includes('--project') && source,
  'Pass --project <completed generation project>',
);
const directory = resolve('test-results/desktop-generated');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const project = join(directory, 'Generated.frameo');
await cp(resolve(source), project, { recursive: true });
const output = join(directory, 'Generated.mp4'),
  environment: NodeJS.ProcessEnv = { ...process.env, FRAMEO_USER_DATA: join(directory, 'profile') };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.FRAMEO_TEST_EXECUTABLE ?? (electronBinary as unknown as string),
  args: process.env.FRAMEO_TEST_EXECUTABLE ? [] : [process.cwd()],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  timeout: 60000,
});
try {
  await app.evaluate(() => {
    (globalThis as unknown as { generatedCheckFetches: number }).generatedCheckFetches = 0;
    globalThis.fetch = async () => {
      (globalThis as unknown as { generatedCheckFetches: number }).generatedCheckFetches++;
      throw new Error('No cloud calls allowed during generated-output editing acceptance');
    };
  });
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [paths.project],
      })) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: paths.output,
      })) as typeof dialog.showSaveDialog;
    },
    { project, output },
  );
  const page = await app.firstWindow(),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByTestId('welcome-create').waitFor();
  await page.getByTestId('language-select').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.getByRole('button', { name: '模型与应用设置', exact: true }).click();
  await page.getByTestId('agent-model-input').fill('fixture-no-inference');
  await page.getByTestId('seedance-model-input').fill('doubao-seedance-2-5-260628');
  await page.getByTestId('api-key-input').fill('fixture-local-edit-no-cloud-key');
  await page.getByTestId('save-settings').click();
  await page.getByRole('main').getByRole('button', { name: '打开工程', exact: true }).click();
  await page.getByTestId('jobs-button').waitFor();
  const initial = await page.evaluate(() => window.frameo.snapshot());
  const job = initial.jobs.find(
    (j) => j.kind === 'seedance' && j.status === 'succeeded' && j.outputAssetId,
  )!;
  assert.ok(job, 'Project has no completed generation');
  const asset = initial.assets.find((a) => a.id === job.outputAssetId)!;
  assert.ok(asset?.kind === 'video');
  assert.equal(initial.sequences[0].clips.length, 0);
  await page.getByRole('button', { name: `将 ${asset.name} 添加至作品`, exact: true }).click();
  await page.getByTestId('timeline-clip').click();
  await page.locator('.inspector-form input[name="duration"]').fill('5');
  await page.getByTestId('save-clip').click();
  await page.getByRole('button', { name: '字幕', exact: true }).first().click();
  await page.locator('.inspector-form textarea[name="text"]').fill('让想法成为下一个镜头');
  await page.locator('.inspector-form input[name="duration"]').fill('5');
  await page.getByRole('button', { name: '添加字幕', exact: true }).click();
  async function waitForJob(kind: 'preview' | 'export') {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const state = await page.evaluate(() => window.frameo.snapshot());
      const result = state.jobs.filter((j) => j.kind === kind).at(-1);
      if (result?.status === 'succeeded') return result;
      if (result && ['failed', 'cancelled'].includes(result.status))
        throw new Error(result.error ?? 'Render failed');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Render timed out');
  }
  await page.getByTestId('preview-button').click();
  await waitForJob('preview');
  await page.getByTestId('preview-video').waitFor();
  await page.waitForFunction(
    () => {
      const video = document.querySelector(
        '[data-testid="preview-video"]',
      ) as HTMLVideoElement | null;
      return video && video.readyState >= 2;
    },
    undefined,
    { timeout: 30000 },
  );
  assert.equal(
    Math.round(
      await page.getByTestId('preview-video').evaluate((video: HTMLVideoElement) => video.duration),
    ),
    5,
  );
  await page.getByTestId('export-button').click();
  await waitForJob('export');
  const metadata = await probe(output),
    video = metadata.streams.find((s) => s.codec_type === 'video')!;
  const frames = Number(
    JSON.parse(
      (
        await runProcess(ffprobePath(), [
          '-v',
          'error',
          '-count_frames',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=nb_read_frames',
          '-of',
          'json',
          output,
        ])
      ).stdout,
    ).streams[0].nb_read_frames,
  );
  assert.equal(video.width, 1280);
  assert.equal(video.height, 720);
  assert.equal(video.r_frame_rate, '24/1');
  assert.equal(frames, 120);
  assert.ok(metadata.streams.some((s) => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(metadata.format.duration) - 5) < 0.05);
  await runProcess(ffmpegPath(), ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
  await page.evaluate(async () => {
    const state = await window.frameo.snapshot();
    await window.frameo.closeProject();
    await window.frameo.openRecent(state.project.path);
  });
  const reopened = await page.evaluate(() => window.frameo.snapshot());
  assert.equal(reopened.sequences[0].clips[0].duration, 120);
  assert.equal(reopened.sequences[0].captions[0].text, '让想法成为下一个镜头');
  assert.equal(reopened.assets.length, initial.assets.length);
  assert.equal(reopened.jobs.find((j) => j.id === job.id)?.remoteId, job.remoteId);
  assert.equal(
    await app.evaluate(
      () => (globalThis as unknown as { generatedCheckFetches: number }).generatedCheckFetches,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  const evidence = {
    desktop: true,
    realGeneratedAsset: true,
    candidateRequiredExplicitAdoption: true,
    trimSeconds: 5,
    captions: true,
    nativePreview: true,
    export: {
      width: video.width,
      height: video.height,
      fps: 24,
      frames,
      audio: true,
      fullDecode: true,
    },
    reopen: true,
    originalGenerationTaskRetained: true,
    additionalCloudCalls: 0,
  };
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await app.close();
}
