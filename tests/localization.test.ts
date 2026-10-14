import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { translate, normalizeLocale, formatDate } from '../apps/desktop/src/localization';
import { createDesktopApplication } from '../apps/desktop/src/adapters/application/desktop';
import type { CredentialVault } from '../apps/desktop/src/adapters/storage/credentials';
import { schemas } from '../apps/desktop/src/adapters/contracts/validation';

test('explicit locales select complete UI messages; unknown or absent preference defaults to English', () => {
  assert.equal(normalizeLocale(undefined), 'en');
  assert.equal(normalizeLocale('fr'), 'en');
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(translate('en', 'dialog.close'), 'Close dialog');
  assert.equal(translate('zh-CN', 'dialog.close'), '关闭窗口');
  assert.equal(
    formatDate('en', '2026-10-14T00:00:00Z', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    'October 14, 2026',
  );
  assert.equal(
    formatDate('zh-CN', '2026-10-14T00:00:00Z', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    '2026年10月14日',
  );
});
test('language persists through the public desktop API without configured models, account changes or task execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'framo-locale-'));
  let access = 0;
  const vault = {
    hasKey: () => false,
    get: () => {
      access++;
      throw Error('No credentials');
    },
    currentId: () => undefined,
  } as unknown as CredentialVault;
  const create = () =>
    createDesktopApplication({
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
    });
  let app = await create();
  try {
    assert.equal((await app.methods.bootstrap()).settings.language, 'en');
    const before = (await app.methods.bootstrap()).settings;
    const next = await app.methods.setLanguage('zh-CN');
    assert.equal(next.language, 'zh-CN');
    assert.equal(next.hasApiKey, false);
    assert.equal(next.agentModel, before.agentModel);
    assert.equal(next.generationCostLimit, before.generationCostLimit);
    await app.dispose();
    app = await create();
    assert.equal((await app.methods.bootstrap()).settings.language, 'zh-CN');
    await app.methods.setLanguage('en');
    assert.equal(access, 0);
    assert.throws(() => schemas.setLanguage.parse('fr'));
    assert.equal(schemas.setLanguage.parse('en'), 'en');
  } finally {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
