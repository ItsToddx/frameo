import assert from 'node:assert/strict';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import electronBinary from 'electron';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';

// Synthetic profile only. Language selection, errors and editing must never call a model.
const directory = resolve('test-results/desktop-languages');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const project = join(directory, 'Languages.frameo');
const database = ProjectDatabase.create(project, '用户创作名称', 1280, 720, 24);
database.transaction((state) => {
  const sequence = state.sequences[0];
  sequence.name = '用户作品名称';
  sequence.captions.push({
    id: 'locale-caption',
    text: 'Original authored 内容',
    start: 0,
    duration: 120,
    fontSize: 40,
    color: '#ffffff',
    position: 'bottom',
  });
  state.sessions[0].messages.push({
    id: 'locale-message',
    role: 'assistant',
    text: 'Original model 内容',
    createdAt: '2026-10-14T00:00:00Z',
  });
});
database.close();
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  FRAMEO_USER_DATA: join(directory, 'profile'),
};
delete environment.ELECTRON_RUN_AS_NODE;
let app!: ElectronApplication;
let page!: Page;
let fetches = 0;
const errors: string[] = [];
async function launch() {
  app = await electron.launch({
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
  await app.evaluate(() => {
    (globalThis as unknown as { localeFetches: number }).localeFetches = 0;
    globalThis.fetch = async () => {
      (globalThis as unknown as { localeFetches: number }).localeFetches++;
      throw Error('Model calls are forbidden during language acceptance');
    };
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByTestId('welcome-create').waitFor();
}
async function change(locale: 'en' | 'zh-CN') {
  const selector = page.getByRole('dialog').locator('[data-testid="language-select"]');
  await (
    (await page.getByRole('dialog').count()) ? selector : page.getByTestId('language-select')
  ).selectOption(locale);
  await page.waitForFunction((locale) => document.documentElement.lang === locale, locale);
}
async function menuLabels() {
  return app.evaluate(
    ({ Menu }) =>
      Menu.getApplicationMenu()?.items.flatMap((item) => [
        item.label,
        ...(item.submenu?.items.map((child) => child.label) ?? []),
      ]) ?? [],
  );
}
await launch();
try {
  assert.equal(await page.getByTestId('language-select').inputValue(), 'en');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('heading', { name: 'Start with an idea', exact: true }).waitFor();
  assert.ok((await menuLabels()).includes('File'));
  assert.equal(
    await page
      .locator('.welcome-screen')
      .innerText()
      .then((text) => /\p{Script=Han}/u.test(text)),
    false,
  );
  await page.screenshot({ path: join(directory, 'welcome-en.png') });
  // Configuration errors appear in English and no credentials are needed to change language.
  const blocked = await page.evaluate(async () => {
    try {
      await window.frameo.createSequence({ name: 'Forbidden', width: 1280, height: 720, fps: 24 });
      return '';
    } catch (reason) {
      return String(reason);
    }
  });
  assert.equal(/\p{Script=Han}/u.test(blocked), false, blocked);
  await page.getByRole('button', { name: 'Models and app settings', exact: true }).click();
  await page.getByTestId('agent-model-input').fill('unsubmitted model draft');
  await page.getByTestId('api-key-input').fill('unsubmitted fake key');
  await change('zh-CN');
  assert.equal(await page.getByTestId('agent-model-input').inputValue(), 'unsubmitted model draft');
  assert.equal(await page.getByTestId('api-key-input').inputValue(), 'unsubmitted fake key');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  assert.ok((await menuLabels()).includes('文件'));
  await page.getByRole('heading', { name: '从一个想法开始创作', exact: true }).waitFor();
  await page.screenshot({ path: join(directory, 'welcome-zh.png') });
  await page.evaluate(() =>
    window.frameo.saveSettings({
      arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      agentModel: 'locale-no-inference',
      seedanceModel: 'doubao-seedance-2-5-260628',
      apiKey: 'locale-fixture-key',
      generationCostLimit: 1,
      maxModelCalls: 1,
    }),
  );
  await page.reload();
  await page.getByTestId('welcome-create').waitFor();
  assert.equal(await page.getByTestId('language-select').inputValue(), 'zh-CN');
  await change('en');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async (options: unknown) => {
      (globalThis as unknown as { localeDialog: unknown }).localeDialog = options;
      return { canceled: false, filePaths: [path] };
    }) as typeof dialog.showOpenDialog;
  }, project);
  await page.getByRole('main').getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByTestId('sequence-card').waitFor();
  const nativeDialog = await app.evaluate(
    () => (globalThis as unknown as { localeDialog: { title: string } }).localeDialog,
  );
  assert.equal(/\p{Script=Han}/u.test(nativeDialog.title), false, nativeDialog.title);
  const composer = page.getByTestId('agent-prompt');
  await composer.fill('Retain bilingual draft 中英文');
  await page.locator('.sequence-list-row').first().click();
  await page.getByTestId('timeline').waitFor();
  await page.locator('.timeline-caption').first().click();
  const caption = page.locator('textarea[name="text"]');
  await caption.fill('Unsaved caption 草稿');
  await page.getByTestId('save-timeline-draft').waitFor();
  await change('zh-CN');
  assert.equal(await composer.inputValue(), 'Retain bilingual draft 中英文');
  assert.equal(await caption.inputValue(), 'Unsaved caption 草稿');
  await change('en');
  assert.equal(await caption.inputValue(), 'Unsaved caption 草稿');
  await page.getByTestId('save-timeline-draft').click();
  assert.equal(
    (await page.evaluate(() => window.frameo.snapshot())).sequences[0].captions[0].text,
    'Unsaved caption 草稿',
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1120, 760);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(directory, 'editor-en-compact.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.getByTestId('export-button').isVisible(), true);
  const preserved = await page.evaluate(() => window.frameo.snapshot());
  assert.equal(preserved.project.name, '用户创作名称');
  assert.equal(preserved.sessions[0].messages[0].text, 'Original model 内容');
  assert.equal(preserved.jobs.length, 0);
  await change('zh-CN');
  fetches += await app.evaluate(
    () => (globalThis as unknown as { localeFetches: number }).localeFetches,
  );
  await app.close();
  await launch();
  assert.equal(await page.getByTestId('language-select').inputValue(), 'zh-CN');
  await change('en');
  fetches += await app.evaluate(
    () => (globalThis as unknown as { localeFetches: number }).localeFetches,
  );
  assert.equal(fetches, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        englishDefault: true,
        chineseAndEnglish: true,
        menuAndDialogLocalized: true,
        errorsEnglish: true,
        persistedAfterRelaunch: true,
        formDraftRetained: true,
        composerDraftRetained: true,
        timelineDraftRetainedAndSaved: true,
        userAndModelContentPreserved: true,
        compactEnglish: true,
        cloudCalls: fetches,
      },
      null,
      2,
    ),
  );
  console.log('Desktop bilingual acceptance passed; no model calls.');
} finally {
  await app!.close();
}
