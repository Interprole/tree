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
  // drag the bend handle down by 40px
  const h = await page.locator('.bend-handle').boundingBox();
  expect(h).toBeTruthy();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => code(page)).toMatch(/bend=0,\d+/);
  // delete the selected arrow with the keyboard
  await page.locator('.canvas').focus();
  await page.keyboard.press('Delete');
  await expect.poll(() => code(page)).not.toContain('->');
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
  await page.locator('.mode-switch button', { hasText: 'X-bar' }).click();
  await page.getByTestId('share').click();
  const url = page.url();
  expect(url).toContain('#t=');
  const p2 = await context.newPage();
  await p2.goto(url);
  await expect(p2.locator('.cm-content')).toContainText('[XP [Y share me]]');
  await expect(p2.locator('.mode-switch:not(.chain-switch) button.on')).toHaveText('X-bar');
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

test('triangle toggles without losing structure', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [DP [D the] [N cat]] [VP runs]]');
  await page.locator('.mode-switch button', { hasText: 'Manual' }).click();
  await page.locator('[data-node] title', { hasText: /^DP$/ }).locator('..').click();
  await page.keyboard.press('t');
  await expect.poll(() => code(page)).toContain('[DP ^ [D the] [N cat]]');
  await expect(page.locator('.prims text', { hasText: 'the cat' })).toHaveCount(1);
  await page.locator('[data-node] title', { hasText: /^DP$/ }).locator('..').click();
  await page.keyboard.press('t');
  await expect.poll(() => code(page)).toContain('[DP [D the] [N cat]]');
});

test('add an existing constituent again by clicking it (a chain)', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP what] [VP [V see]]]');
  await page.locator('.mode-switch button', { hasText: 'Manual' }).click();
  await page.locator('[data-node] title', { hasText: /^VP$/ }).locator('..').click();
  await page.locator('.node-bar button[title^="Add an existing"]').click();
  await page.locator('.menu-list button', { hasText: 'Add as a daughter' }).click();
  await page.locator('[data-node] title', { hasText: /^DP$/ }).first().locator('..').click();
  await expect.poll(() => code(page)).toBe('[CP [DP#dp what] [VP [V see] #dp]]');
  // copies view: a gray copy and an arrow
  await expect(page.locator('.prims text', { hasText: 'what' })).toHaveCount(2);
  await expect(page.locator('.arrow-hit')).toHaveCount(1);
  await page.locator('.chain-switch button', { hasText: 'Traces' }).click();
  await expect(page.locator('.prims text', { hasText: /^t$/ })).toHaveCount(1);
});

test('semantics example computes meanings', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="semantics"]').click();
  await expect(page.locator('.prims text', { hasText: 'agent' }).first()).toBeVisible();
  await expect(page.locator('.prims text', { hasText: /^✗/ })).toHaveCount(0);
});

test('guide opens', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('guide').click();
  await page.locator('.guide-nav button', { hasText: 'Semantics' }).click();
  await expect(page.locator('.guide-body')).toContainText('Event Identification');
});

test('arrow: colour, reverse, several labels, drag a label', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#a what] [C′ did [VP see [DP#b t]]]]\n#b -> #a');
  const mid = await page.locator('.arrow-hit').first().evaluate((el) => {
    const p = el as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
  });
  await page.mouse.click(mid.x, mid.y);
  await expect(page.locator('.arrow-bar')).toBeVisible();
  await page.locator('.arrow-bar .swatch[title="#1d4ed8"]').click();
  await expect.poll(() => code(page)).toContain('@#1d4ed8');
  await page.locator('.arrow-bar button', { hasText: 'Reverse' }).click();
  await expect.poll(() => code(page)).toContain('#a -> #b');
  await page.locator('.arrow-bar .label-list input').first().fill('wh');
  await page.locator('.arrow-bar .label-list button', { hasText: '+ Add' }).click();
  await page.locator('.arrow-bar .label-list input').nth(1).fill('**A**');
  await page.locator('.arrow-bar .label-list select').nth(1).selectOption('above');
  await page.locator('.arrow-bar .label-list button', { hasText: 'Apply' }).click();
  await expect.poll(() => code(page)).toContain('"wh" above"**A**"');
  await page.keyboard.press('Escape');
  const box = await page.locator('.label-hit').first().boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => code(page)).toMatch(/"wh"@\d+,\d+/);
  // click a label: rename it, then delete it
  const lab = await page.locator('.label-hit').first().boundingBox();
  await page.mouse.click(lab!.x + lab!.width / 2, lab!.y + lab!.height / 2);
  await page.locator('.label-editor input').fill('A-mvt');
  await page.locator('.label-editor input').press('Enter');
  await expect.poll(() => code(page)).toMatch(/"A-mvt"@\d+,\d+/);
  const lab2 = await page.locator('.label-hit').first().boundingBox();
  await page.mouse.click(lab2!.x + lab2!.width / 2, lab2!.y + lab2!.height / 2);
  await page.locator('.label-editor button[aria-label="Delete this label"]').click();
  await expect.poll(() => code(page)).not.toContain('A-mvt');
});

test('node: notes, edge style, restructure', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [DP she] [VP [V saw] [DP him]]]');
  const node = (label: string) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) });
  await node('VP').click();
  await page.locator('.node-bar button[aria-label="Notes next to the node"]').click();
  await page.locator('.label-list input').first().fill('focus');
  await page.locator('.label-list button', { hasText: 'Apply' }).click();
  await expect.poll(() => code(page)).toContain('[VP [V saw] [DP him] &"focus"]');
  await node('VP').click();
  await page.locator('.node-bar button[aria-label="Colours"]').click();
  await page.locator('.style-pop .seg button', { hasText: 'Edge' }).click();
  await page.locator('.style-pop .swatch[title="#b91c1c"]').click();
  await expect.poll(() => code(page)).toContain('[VP;edge=#b91c1c');
  await page.locator('.node-bar button[aria-label^="Spacing"]').click();
  await page.locator('.num-field', { hasText: 'Edge width' }).locator('input').fill('3');
  await page.locator('.num-field', { hasText: 'Edge width' }).locator('input').press('Tab');
  await expect.poll(() => code(page)).toContain(';width=3');
  await page.locator('.canvas').focus();
  await page.keyboard.press('Escape');
  await node('S').click();
  await page.locator('.node-bar button[aria-label^="More"]').click();
  await page.locator('.menu-list button', { hasText: 'left' }).click();
  await expect.poll(() => code(page)).toMatch(/^\[S \[VP.*\] \[DP she\]\]$/);
  // already left-branching: a message, no change (the menu is still open)
  await page.locator('.menu-list button', { hasText: 'left' }).click();
  await expect(page.locator('.toast')).toContainText('Already left-branching');
});
