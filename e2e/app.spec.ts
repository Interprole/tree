import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function setCode(page: Page, text: string) {
  const ed = page.locator('.cm-content');
  await ed.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
  await page.waitForTimeout(150);
}

const code = (page: Page) => page.locator('.cm-content').innerText();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test('opens with an example tree', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('[data-node]').first()).toBeVisible();
  await expect(page.locator('.status.ok')).toContainText('nodes');
});

test('live rendering, errors keep the last good tree', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP Иван] [VP спит]]');
  await expect(page.locator('.prims text', { hasText: 'Иван' })).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.status.error')).toContainText('Missing "]"');
  await expect(page.locator('.prims text', { hasText: 'Иван' })).toHaveCount(1);
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);
});

test('canvas editing syncs to the code and undo works', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  await page.locator('[data-node] title', { hasText: 'VP' }).locator('..').click();
  await page.keyboard.press('Enter');
  await page.locator('.rename-box').fill("V'");
  await page.keyboard.press('Enter');
  await expect.poll(() => code(page)).toContain("[V' runs]");
  // add a daughter with the keyboard
  await page.locator('[data-node] title', { hasText: "V′" }).locator('..').click();
  await page.keyboard.press('a');
  await page.locator('.rename-box').fill('Adv');
  await page.keyboard.press('Enter');
  await expect.poll(() => code(page)).toContain("[V' runs [Adv]]");
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => code(page)).toContain("[V' runs [X]]");
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => code(page)).toContain('[VP runs]');
});

test('arrow tool adds an arrow line; selecting and restyling it', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP what] [C′ did [VP see [DP t]]]]');
  await page.locator('button[aria-label="Draw movement arrow"]').click();
  const nodes = page.locator('[data-node]');
  await nodes.filter({ has: page.locator('title', { hasText: /^t$/ }) }).click();
  await nodes.filter({ has: page.locator('title', { hasText: /^what$/ }) }).click();
  await expect.poll(() => code(page)).toMatch(/#\w+ -> #\w+/);
  await expect(page.locator('.arrow-bar')).toBeVisible();
  await page.locator('.arrow-bar button', { hasText: 'Dashed' }).click();
  await expect.poll(() => code(page)).toContain('dashed');
});

test('c-command highlighting', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP [V saw] [NP Mary]]]');
  await page.locator('.mode-switch button', { hasText: 'Manual' }).click();
  await page.locator('button[aria-label="Show c-command domain"]').click();
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^V$/ }) }).click();
  await expect(page.locator('.rel-ccommand')).toHaveCount(2);
});

test('share link restores tree and settings', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await setCode(page, '[XP [Y share me]]');
  await page.locator('.mode-switch button', { hasText: 'BPS' }).click();
  await page.getByTestId('share').click();
  const url = page.url();
  expect(url).toContain('#t=');
  const p2 = await context.newPage();
  await p2.goto(url);
  await expect(p2.locator('.cm-content')).toContainText('[XP [Y share me]]');
  await expect(p2.locator('.mode-switch button.on')).toHaveText('BPS');
});

test('LaTeX export shows forest code', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  await page.getByTestId('export').click();
  await page.getByRole('tab', { name: 'LaTeX' }).click();
  await expect(page.locator('textarea.code')).toHaveValue(/\\begin\{forest\}[\s\S]*\[\{S\}/);
});

test('downloads SVG, PNG and PDF', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP Иван] [VP φ runs]]');
  await page.getByTestId('export').click();
  for (const [label, ext] of [['Download SVG', '.svg'], ['Download PNG', '.png'], ['Download PDF', '.pdf']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: label }).click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(ext.replace('.', '\\.') + '$'));
    const path = await dl.path();
    expect(path).toBeTruthy();
  }
});

test('my trees: save and reopen', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[A saved tree]');
  await page.getByRole('button', { name: 'My trees' }).click();
  await page.getByPlaceholder('Name').fill('Mine');
  await page.getByRole('button', { name: 'Save current tree' }).click();
  await page.keyboard.press('Escape');
  await setCode(page, '[B other]');
  await page.getByRole('button', { name: 'My trees' }).click();
  await page.locator('.tree-list .open', { hasText: 'Mine' }).click();
  await expect(page.locator('.cm-content')).toContainText('[A saved tree]');
});

test('language switch', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Язык: русский' }).click();
  await expect(page.getByTestId('export')).toContainText('Экспорт');
});
