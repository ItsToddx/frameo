import type { Page } from '@playwright/test';
export async function selectLanguage(page: Page, language: 'en' | 'zh-CN') {
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await dialog.getByTestId('language-select').selectOption(language);
  else {
    const menu = page.locator('.project-menu');
    if ((await menu.getAttribute('open')) === null) await page.getByTestId('project-menu').click();
    await menu.getByTestId('language-select').selectOption(language);
    await page.getByTestId('project-menu').click();
  }
  await page.waitForFunction((value) => document.documentElement.lang === value, language);
}
export async function openLibrary(page: Page) {
  if (await page.locator('.library-drawer').isVisible()) return;
  await page
    .locator('.app-header')
    .getByRole('button', { name: /^(Media library|素材库)$/ })
    .click();
}
export async function openEditor(page: Page) {
  if (await page.getByTestId('timeline').isVisible()) return;
  await page
    .getByTestId('sequence-card')
    .first()
    .getByRole('button', { name: /^(Edit sequence|编辑作品)/ })
    .click();
  await page.getByTestId('timeline').waitFor();
}
export async function openInspector(page: Page) {
  if (!(await page.locator('.inspector').isVisible()))
    await page.getByRole('button', { name: /^(Open inspector|打开检查器)$/ }).click();
}
export async function conversationView(page: Page, view: 'chat' | 'reviews') {
  const menu = page.locator('.conversation-menu');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu
    .getByRole('button', {
      name: view === 'chat' ? /^(Chat|对话)$/ : /^(Review history|审阅历史)$/,
    })
    .click();
}
