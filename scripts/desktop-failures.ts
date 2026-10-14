import assert from 'node:assert/strict';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';
import electronBinary from 'electron';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { JobRunner } from '../apps/desktop/src/adapters/runtime/jobs';
import { SeedanceProvider } from '../apps/desktop/src/adapters/runtime/seedance';
import type { CredentialVault } from '../apps/desktop/src/adapters/storage/credentials';
import type { Job, Settings } from '../apps/desktop/src/adapters/contracts/api';
import { localizeHostText, translate, type Locale } from '../apps/desktop/src/localization';

// No real credentials or model requests. Optional --source arguments copy existing
// terminal-failure projects for a read-only UI check; originals are never opened.
const directory = resolve('test-results/desktop-failures');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const project = join(directory, 'Failures.framo');
const database = ProjectDatabase.create(project, '模型异常验收', 1280, 720, 24);
const fixtureKey = 'failure-fixture-secret';
const vault = {
  currentId: () => 'failure-fixture-account',
  get: () => fixtureKey,
} as unknown as CredentialVault;
const settings: Settings = {
  hasApiKey: true,
  arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  agentModel: 'fixture-no-inference',
  seedanceModel: 'doubao-seedance-2-5-260628',
  generationCostLimit: 2,
  maxModelCalls: 1,
};
const traces: { title: string; methods: string[]; status: string }[] = [];
for (const scenario of [
  {
    title: '密钥被拒绝',
    http: 401,
    code: 'Unauthorized',
    message: 'Invalid API key ' + fixtureKey,
    status: 'failed',
  },
  {
    title: '模型尚未开通',
    http: 404,
    code: 'ModelNotOpen',
    message:
      'The selected model has not been activated. Please activate the model service in the Ark Console.',
    status: 'failed',
  },
  {
    title: '任务被用量上限暂停',
    http: 200,
    code: 'SetLimitExceeded',
    message:
      'The model has reached its usage limit and the service has been paused. Check Safe Experience Mode.',
    status: 'failed',
  },
  {
    title: '提交响应丢失',
    http: 0,
    code: 'NetworkFailure',
    message: 'Controlled network failure',
    status: 'unknown',
  },
]) {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const method = init?.method ?? 'GET';
    methods.push(method);
    if (scenario.http === 0) throw new Error(scenario.message);
    if (scenario.http !== 200)
      return Response.json(
        { error: { code: scenario.code, message: scenario.message } },
        { status: scenario.http },
      );
    if (method === 'POST') return Response.json({ id: 'fixture-usage-task' });
    return Response.json({
      id: 'fixture-usage-task',
      status: 'failed',
      error: { code: scenario.code, message: scenario.message },
    });
  };
  const provider = new SeedanceProvider({
    baseUrl: settings.arkBaseUrl,
    apiKey: fixtureKey,
    fetch: fetcher,
  });
  const runner = new JobRunner(
    vault,
    () => {},
    () => true,
    {
      provider: () => provider,
      download: async () => {
        throw new Error('Failure must not download output');
      },
      archive: async () => {
        throw new Error('Failure must not archive output');
      },
    },
  );
  const input = {
    requestId: 'failure-' + scenario.code,
    prompt: scenario.title,
    duration: 5,
    ratio: '16:9' as const,
    estimatedCost: 1,
  };
  try {
    const created = runner.createGeneration(database, input, settings);
    const end = Date.now() + 5000;
    while (database.read().jobs.find((j) => j.id === created.id)?.status !== scenario.status) {
      assert.ok(Date.now() < end, 'Failure state did not settle');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const job = database.read().jobs.find((j) => j.id === created.id)!;
    assert.equal(job.remoteId, scenario.http === 200 ? 'fixture-usage-task' : undefined);
    assert.ok(job.error);
    assert.ok(!job.error.includes(fixtureKey));
    assert.equal(runner.createGeneration(database, input, settings).id, job.id);
    const before = methods.length;
    runner.recover(database);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(methods.length, before, 'Recovery must not replay failed or unknown submissions');
    assert.equal(methods.filter((m) => m === 'POST').length, 1);
    traces.push({ title: scenario.title, methods, status: job.status });
  } finally {
    await runner.stop();
  }
}
let copiedRealFailures = 0;
for (let index = 2; index < process.argv.length; index++)
  if (process.argv[index] === '--source') {
    const source = process.argv[++index];
    assert.ok(source, '--source needs a project directory');
    const copy = join(directory, 'copied-source-' + copiedRealFailures);
    await cp(resolve(source), copy, { recursive: true });
    const sourceDatabase = new ProjectDatabase(copy);
    try {
      const failures = sourceDatabase
        .read()
        .jobs.filter((job) => job.kind === 'seedance' && job.status === 'failed')
        .map((job) => ({
          ...job,
          error: job.error
            ?.replace(/Your account \[?\d+\]?/gi, 'Your account [redacted]')
            .replace(/Request id:\s*\S+/gi, 'Request id: [redacted]'),
        }));
      assert.ok(failures.length, 'Source has no terminal Seedance failure');
      database.transaction((state) => state.jobs.push(...failures));
      copiedRealFailures += failures.length;
    } finally {
      sourceDatabase.close();
    }
  }
const expected = database.read().jobs;
assert.equal(database.read().assets.length, 0);
assert.equal(database.read().sequences[0].clips.length, 0);
database.close();
function taskIdentity(job: Job) {
  return {
    id: job.id,
    requestId: job.requestId,
    status: job.status,
    remoteId: job.remoteId,
    title: job.title,
    error: job.error,
    cancelRequested: job.cancelRequested,
    input: job.input,
  };
}
function assertPersistedCanonicalFailures() {
  const persisted = new ProjectDatabase(project);
  try {
    const state = persisted.read();
    assert.deepEqual(state.jobs.map(taskIdentity), expected.map(taskIdentity));
    assert.equal(state.assets.length, 0);
    assert.equal(state.sequences[0].clips.length, 0);
    assert.ok(!JSON.stringify(state.jobs).includes(fixtureKey));
  } finally {
    persisted.close();
  }
}
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
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  timeout: 60000,
});
try {
  // Count and reject any production-host fetch: reopening these projects must be local.
  await app.evaluate(() => {
    (globalThis as unknown as { failureCheckFetches: number }).failureCheckFetches = 0;
    globalThis.fetch = async () => {
      (globalThis as unknown as { failureCheckFetches: number }).failureCheckFetches++;
      throw new Error('Unexpected network call during failure UI acceptance');
    };
  });
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog;
  }, project);
  let page = await app.firstWindow();
  await page.getByTestId('welcome-create').waitFor();
  await page.getByTestId('language-select').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function changeLanguage(locale: Locale) {
    await page.getByRole('dialog').getByTestId('language-select').selectOption(locale);
    await page.waitForFunction((locale) => document.documentElement.lang === locale, locale);
  }
  async function inspect(locale: Locale) {
    if (!(await page.getByRole('dialog').count())) await page.getByTestId('jobs-button').click();
    const rows = page.locator('.job-row');
    await rows.first().waitFor();
    assert.equal(await rows.count(), expected.length);
    for (const [index, job] of [...expected].reverse().entries()) {
      const row = rows.nth(index);
      assert.equal(await row.locator('strong').innerText(), job.title);
      assert.equal(
        await row.locator('.badge').innerText(),
        job.status === 'unknown'
          ? locale === 'en'
            ? 'Awaiting confirmation'
            : '状态待确认'
          : locale === 'en'
            ? 'Failed'
            : '失败',
      );
      assert.equal(
        await row.locator('.error-message').innerText(),
        localizeHostText(job.error!, locale),
      );
      assert.equal(await row.locator('.progress').count(), 0);
      assert.equal(
        await row
          .getByRole('button', {
            name: translate(locale, 'jobs.reconcile', { title: job.title }),
            exact: true,
          })
          .count(),
        job.remoteId ? 1 : 0,
      );
      assert.equal(
        await row
          .getByRole('button', {
            name: translate(locale, 'jobs.reveal', { title: job.title }),
            exact: true,
          })
          .count(),
        0,
      );
      if (job.cancelRequested && !job.remoteId)
        assert.equal(
          await row.locator('.field-hint').innerText(),
          translate(locale, 'jobs.cancelUnknown'),
        );
    }
    const state = await page.evaluate(() => window.framo.snapshot());
    assert.equal(state.assets.length, 0);
    assert.equal(state.sequences[0].clips.length, 0);
    assert.deepEqual(
      state.jobs.map(taskIdentity),
      expected.map((job) =>
        taskIdentity({
          ...job,
          error: job.error ? localizeHostText(job.error, locale) : undefined,
        }),
      ),
    );
    assert.ok(!(await page.locator('body').innerText()).includes(fixtureKey));
  }
  await page.getByTestId('welcome-create').waitFor();
  await page.getByRole('main').getByRole('button', { name: '打开工程', exact: true }).click();
  await page.getByTestId('jobs-button').waitFor();
  await inspect('zh-CN');
  await changeLanguage('en');
  await inspect('en');
  const unknown = expected.find((job) => job.status === 'unknown')!,
    unknownRow = page
      .locator('.job-row')
      .filter({ has: page.locator('strong', { hasText: unknown.title }) });
  await unknownRow
    .getByRole('button', {
      name: translate('en', 'jobs.cancel', { title: unknown.title }),
      exact: true,
    })
    .click();
  await unknownRow.locator('.field-hint').waitFor();
  assert.equal(
    await unknownRow.locator('.field-hint').innerText(),
    translate('en', 'jobs.cancelUnknown'),
  );
  unknown.cancelRequested = true;
  await inspect('en');
  await page.screenshot({ path: join(directory, 'failures-en.png'), fullPage: true });
  await changeLanguage('zh-CN');
  await inspect('zh-CN');
  await page.screenshot({ path: join(directory, 'failures.png'), fullPage: true });
  await page.evaluate(() => window.framo.closeProject());
  assertPersistedCanonicalFailures();
  await page.reload();
  await page.getByTestId('welcome-create').waitFor();
  await page.getByRole('main').getByRole('button', { name: '打开工程', exact: true }).click();
  await inspect('zh-CN');
  await changeLanguage('en');
  await inspect('en');
  await page.evaluate(() => window.framo.closeProject());
  assertPersistedCanonicalFailures();
  assert.equal(
    await app.evaluate(
      () => (globalThis as unknown as { failureCheckFetches: number }).failureCheckFetches,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  const evidence = {
    desktop: true,
    cases: traces,
    copiedRealFailures,
    statusAndErrorVisible: true,
    queryOnlyWhenRemoteIdExists: true,
    noFailedProgressOrOutput: true,
    noFabricatedAssetsOrEdits: true,
    keyRedacted: true,
    unknownCancellationRequiresConsoleReconciliation: true,
    exactFailuresAndTaskIdsSurviveReopen: true,
    failurePresentationInBothLanguages: true,
    persistedCanonicalErrorsPreserved: true,
    reopenNetworkCalls: 0,
  };
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await app.close();
}
