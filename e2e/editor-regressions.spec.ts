import { expect, test } from '@playwright/test';

test('opening and closing code keeps the tree at the same screen position', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await expect(page.locator('.cm-content')).not.toBeVisible();
  const root = page.locator('.active-sheet [data-node] title', { hasText: /^TP$/ }).locator('..');
  const before = await root.boundingBox();
  await root.click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect.poll(async () => {
    const now = (await root.boundingBox())!;
    return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
  }).toBeLessThan(1);
  await page.getByRole('button', { name: 'Hide the code', exact: true }).click();
  await expect(page.locator('.cm-content')).not.toBeVisible();
  await expect.poll(async () => {
    const now = (await root.boundingBox())!;
    return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
  }).toBeLessThan(1);
  await page.getByRole('button', { name: 'Show the code', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect.poll(async () => {
    const now = (await root.boundingBox())!;
    return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
  }).toBeLessThan(1);
  const splitter = await page.getByRole('separator', { name: 'Width of the code', exact: true }).boundingBox();
  await page.mouse.move(splitter!.x + splitter!.width / 2, splitter!.y + splitter!.height / 2);
  await page.mouse.down();
  await page.mouse.move(splitter!.x + 60, splitter!.y + splitter!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const now = (await root.boundingBox())!;
    return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
  }).toBeLessThan(1);
});

test('settings panel visibility and width keep the tree at the same screen position', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  const root = page.locator('.active-sheet [data-node] title', { hasText: /^TP$/ }).locator('..');
  const before = await root.boundingBox();
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('settings-toggle').click();
    await expect(page.locator('.side-pane')).not.toBeVisible();
    await expect.poll(async () => {
      const now = (await root.boundingBox())!;
      return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
    }).toBeLessThan(1);
    await page.getByTestId('settings-toggle').click();
    await expect(page.locator('.side-pane')).toBeVisible();
    await expect.poll(async () => {
      const now = (await root.boundingBox())!;
      return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
    }).toBeLessThan(1);
  }
  const splitter = await page.getByRole('separator', { name: 'Width of the right panel' }).boundingBox();
  await page.mouse.move(splitter!.x + splitter!.width / 2, splitter!.y + splitter!.height / 2);
  await page.mouse.down();
  await page.mouse.move(splitter!.x - 90, splitter!.y + splitter!.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const now = (await root.boundingBox())!;
    return Math.abs(now.x - before!.x) + Math.abs(now.y - before!.y);
  }).toBeLessThan(1);
});

test('Nanosyntax is the last side-panel tab', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('nanosyntax-toggle').click();
  await expect(page.locator('.side-tabs [role="tab"]')).toHaveText(['Edit', 'Customize', 'Nanosyntax']);
});

test('the top Nanosyntax button opens and closes the panel repeatedly', async ({ page }) => {
  await page.goto('./');
  const toggle = page.getByTestId('nanosyntax-toggle');
  for (let i = 0; i < 2; i++) {
    await toggle.click();
    await expect(page.getByTestId('nanosyntax-panel')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(page.getByTestId('nanosyntax-panel')).toHaveCount(0);
    await expect(page.locator('.side-pane')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  }
});

test('selected panel text keeps native copy and cut even when a tree node is selected', async ({ page }) => {
  await page.goto('./');
  await page.locator('.active-sheet .paper').click({ position: { x: 12, y: 12 } });
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('[DP [D the] [NP cat]]');
  await page.locator('[data-node] title', { hasText: /^DP$/ }).locator('..').click();
  const code = await editor.innerText();
  const outcome = await page.evaluate(() => {
    const fieldLabel = document.querySelector('.inspector .insp-field > span')!;
    const range = document.createRange();
    range.selectNodeContents(fieldLabel);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const results = ['copy', 'cut'].map((type) => {
      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData });
      document.dispatchEvent(event);
      return { prevented: event.defaultPrevented, data: clipboardData.getData('text/plain') };
    });
    selection.removeAllRanges();
    return results;
  });
  expect(outcome).toEqual([{ prevented: false, data: '' }, { prevented: false, data: '' }]);
  await expect(editor).toHaveText(code);
  // Ordinary canvas copying still reaches the selected branch.
  const canvasCopy = await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData });
    document.querySelector('.canvas')!.dispatchEvent(event);
    return { prevented: event.defaultPrevented, data: clipboardData.getData('text/plain') };
  });
  expect(canvasCopy.prevented).toBe(true);
  expect(canvasCopy.data).toContain('[DP');
});
