import { test } from '@playwright/test';
import { examples } from '../src/examples';

const OUT = 'screenshots/out';

for (const scheme of ['light', 'dark'] as const) {
  test(`desktop ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    for (const ex of examples) {
      await page.getByTestId('examples-button').click();
      await page.locator(`[data-example="${ex.id}"]`).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${ex.id}-desktop-${scheme}.png` });
    }
  });
}

test('mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  for (const ex of examples) {
    await page.getByTestId('examples-button').click();
    await page.locator(`[data-example="${ex.id}"]`).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${ex.id}-mobile.png` });
  }
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.screenshot({ path: `${OUT}/mobile-code.png` });
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.screenshot({ path: `${OUT}/mobile-settings.png` });
});

test('interactions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="wh"]').click();
  await page.waitForTimeout(400);
  // select a node
  await page.locator('[data-node]').nth(4).click();
  await page.screenshot({ path: `${OUT}/ui-node-selected.png` });
  await page.getByTestId('settings-toggle').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ui-settings.png` });
  await page.getByTestId('export').click();
  await page.screenshot({ path: `${OUT}/ui-export.png` });
  await page.getByRole('tab', { name: 'LaTeX' }).click();
  await page.screenshot({ path: `${OUT}/ui-export-latex.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('guide').click();
  await page.screenshot({ path: `${OUT}/ui-guide.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="wh"]').click();
  await page.locator('.arrow-hit').first().click({ force: true });
  await page.screenshot({ path: `${OUT}/ui-arrow-selected.png` });
});

test('presets and modes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="wh"]').click();
  await page.getByTestId('settings-toggle').click();
  for (const p of ['Slides', 'Board', 'Paper']) {
    await page.locator('.preset', { hasText: p }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/preset-${p.toLowerCase()}.png` });
  }
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="xbar"]').click();
  await page.locator('.settings button', { hasText: 'Overline' }).click();
  await page.locator('.settings button', { hasText: 'X⁰' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/xbar-overline.png` });
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="bps"]').click();
  await page.locator('.settings button', { hasText: 'Set {the' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/bps-set.png` });
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="atb"]').click();
  await page.locator('.settings button', { hasText: 'Traces' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/atb-copies.png` });
});
