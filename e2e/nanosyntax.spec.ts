import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function canvas(page: Page) {
  return page.evaluate(() => {
    const snap = JSON.parse(localStorage.getItem('nanotrees:current') ?? '{}').snap;
    return snap?.w ?? { active: 't1', trees: [{ id: 't1', src: 's1' }], sources: { s1: snap?.s ?? '' }, groups: [], treeGroups: [] };
  });
}
async function setCode(page: Page, code: string) {
  if (!await page.locator('.cm-content').isVisible()) {
    await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
    const paper = page.locator('.active-sheet .paper');
    const box = (await paper.boundingBox())!;
    await paper.click({ position: { x: box.width / 2, y: box.height - 5 } });
  }
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
  await expect(page.locator('.status.ok')).toBeVisible();
}
async function example(page: Page, id: string, surface: string) {
  await page.getByTestId('examples-button').click();
  await expect(page.locator('[data-example="starke-sugar-of"], [data-example="caha-mara-portmanteau"], [data-example="caha-friulian-1sg"]')).toHaveCount(3);
  await page.locator('[data-example="' + id + '"]').click();
  await expect.poll(async () => (await canvas(page))?.groups?.[0]?.surface?.join(' · ')).toBe(surface);
  await expect(page.locator('.derivation-frame')).toHaveCount(1);
}
async function enable(page: Page) {
  const button = page.getByTestId('nanosyntax-toggle');
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}
async function context(page: Page) {
  const paper = page.locator('.active-sheet .paper');
  const box = (await paper.boundingBox())!;
  const area = (await page.getByTestId('canvas').boundingBox())!;
  if (box.x < area.x) await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  const visible = (await paper.boundingBox())!;
  await paper.click({ button: 'right', position: { x: visible.width / 2, y: visible.height - 5 } });
}
async function selectSheet(page: Page, id: string) {
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await page.locator('.sheet-head[data-tree-head="' + id + '"]').click({ position: { x: 3, y: 3 } });
  await expect.poll(async () => (await canvas(page)).active).toBe(id);
}
async function expression(page: Page, form: string) {
  const input = page.getByLabel('Expression (its words or morpheme)', { exact: true });
  await input.fill(form);
  await input.press('Enter');
}

test('nanosyntax mode only removes its tab and sheets, while the settings button toggles the whole panel', async ({ page }) => {
  await page.goto('./');
  await enable(page);
  await expect(page.getByTestId('nanosyntax-toggle')).toHaveCSS('background-color', 'rgb(237, 139, 44)');
  await expect(page.locator('.side-tabs [role="tab"]')).toHaveText(['Edit', 'Appearance', 'Nanosyntax']);
  await page.getByTestId('nanosyntax-toggle').click();
  await expect(page.getByTestId('side-nanosyntax')).toHaveCount(0);
  await expect(page.locator('.side-pane')).toBeVisible();
  await page.getByTestId('settings-toggle').click();
  await expect(page.locator('.side-pane')).not.toBeVisible();
  await page.getByTestId('settings-toggle').click();
  await expect(page.locator('.side-pane')).toBeVisible();
  await expect(page.getByTestId('side-appearance')).toHaveAttribute('aria-selected', 'true');
  await context(page);
  await expect(page.getByRole('menuitem', { name: /L-tree/ })).toHaveCount(0);
});

test('code belongs to a selected node or white sheet, and the controls below code are removed', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cm-content')).not.toBeVisible();
  await setCode(page, '[DP [D the] [NP cat]]');
  await expect(page.locator('.mode-options')).toHaveCount(0);
  await page.locator('[data-node] title', { hasText: /^DP$/ }).locator('..').click();
  const groups = await page.locator('.insp-panel .insp-group h3').allTextContents();
  expect(groups.indexOf('Branching')).toBeLessThan(groups.indexOf('Movement'));
  await expression(page, 'the cat');
  await expect(page.locator('.cm-content')).toContainText(';spell="the cat"');
  await expect(page.locator('.active-sheet .prims text').filter({ hasText: '⇒ the cat' })).toHaveCount(1);
  await page.getByLabel('Expression side', { exact: true }).selectOption('left');
  await expect(page.locator('.active-sheet .prims text').filter({ hasText: 'the cat ⇐' })).toHaveCount(1);
  // The canvas background is outside the selected tree's white sheet.
  await page.getByTestId('canvas').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.cm-content')).not.toBeVisible();
});

test('real-word examples replace the whole canvas and arrive with a complete derivation and visible phrasal L-trees', async ({ page }) => {
  await page.goto('./');
  await example(page, 'starke-sugar-of', 'of · sugar');
  await expect(page.locator('.lexical-sheet')).toHaveCount(3);
  await expect(page.locator('.tree-group-frame')).not.toHaveCount(0);
  await expect(page.locator('.prims text').filter({ hasText: '⇔' })).not.toHaveCount(0);
  await example(page, 'caha-mara-portmanteau', 'wili- · gamiñ');
  const mara = await canvas(page);
  const maraTree = mara.trees.find((tree: { lexical?: unknown; derivation?: unknown }) => !tree.lexical && !tree.derivation);
  expect(maraTree.name).toBe('Kloudová 2020: Mara wilamiñ (wili-gamiñ)');
  expect(mara.sources[maraTree.src].split('\n')[0]).not.toContain('Caha');
  await expect(page.locator('.lexical-sheet')).toHaveCount(2);
  await expect.poll(async () => (await canvas(page))?.groups?.length).toBe(1);
  await example(page, 'caha-friulian-1sg', 'fin · -iʃ');
  const saved = await canvas(page);
  expect(saved.groups).toHaveLength(1);
  const lexical = saved.trees.filter((entry: { lexical?: unknown }) => entry.lexical);
  expect(lexical).toHaveLength(3);
  const fin = lexical.find((entry: { src: string }) => saved.sources[entry.src].includes(';spell="fin"'));
  expect(saved.sources[fin.src]).toBe('[NumP;spell="fin" [Num]]');
  await expect(page.getByLabel('Spellout-driven movement')).toHaveValue('caha2025');
  await expect(page.getByLabel('Auxiliary workspace closure')).toHaveValue('early');
  await expect(page.getByLabel('Merge F after workspace reopening')).toHaveValue('aux-only');
  await expect(page.getByTestId('hide-lower-copies')).toHaveCount(0);
  await expect(page.getByLabel('L-tree expression')).toHaveCount(0);
  // Ordinary examples also replace the entire canvas.
  await page.getByTestId('examples-button').click();
  await page.locator('[data-example="wh"]').click();
  await expect(page.locator('.derivation-frame')).toHaveCount(0);
  await expect(page.locator('.lexical-sheet')).toHaveCount(0);
  await expect.poll(async () => (await canvas(page))?.trees?.length).toBe(1);
});

test('three independent algorithm choices show numbered instructions, persist and drive derivation', async ({ page }) => {
  await page.goto('./');
  await example(page, 'caha-mara-portmanteau', 'wili- · gamiñ');
  await expect(page.getByTestId('nanosyntax-panel').locator('select')).toHaveCount(3);
  await expect(page.getByTestId('nanosyntax-panel').getByTestId('build-derivation')).toHaveCount(0);
  for (const section of ['movement-rules', 'closure-rules', 'backtracking-rules']) {
    await expect(page.getByTestId(section).locator('select')).toHaveCount(1);
    await expect(page.getByTestId(section).locator('ol li').first()).toBeVisible();
    await expect(page.getByTestId(section).locator('a').first()).toHaveAttribute('href', /^https:\/\//);
  }
  await page.getByLabel('Spellout-driven movement').selectOption('caha2025');
  await page.getByLabel('Auxiliary workspace closure').selectOption('late');
  await page.getByLabel('Merge F after workspace reopening').selectOption('multiple-merge');
  await expect(page.getByTestId('backtracking-rules')).toContainText('EVERY reopened workspace');
  await expect(page.getByTestId('backtracking-rules')).toContainText('chapter 7 of Nanosyntax and the Lexicalization Algorithm (2025)');
  await page.getByLabel('Auxiliary workspace closure').selectOption('early');
  const owner = (await canvas(page)).trees.find((tree: { lexical?: unknown; derivation?: unknown }) => !tree.lexical && !tree.derivation);
  await selectSheet(page, owner.id);
  await context(page);
  await expect(page.getByRole('menuitem', { name: 'Add a node', exact: true })).toHaveCount(0);
  await page.getByTestId('build-derivation').click();
  await expect.poll(async () => (await canvas(page)).groups.length).toBe(2);
  const saved = await canvas(page);
  expect(saved.groups[1].algorithm).toEqual({ movement: 'caha2025', closure: 'early', backtracking: 'multiple-merge' });
  expect(saved.groups[1].complete).toBe(true);
  expect(saved.groups[1].surface).toEqual(['wili-', 'gamiñ']);
  await page.reload();
  await page.getByTestId('side-nanosyntax').click();
  await expect(page.getByLabel('Spellout-driven movement')).toHaveValue('caha2025');
  await expect(page.getByLabel('Auxiliary workspace closure')).toHaveValue('early');
  await expect(page.getByLabel('Merge F after workspace reopening')).toHaveValue('multiple-merge');
  await page.getByRole('button', { name: 'Whole canvas', exact: true }).click();
  await page.getByLabel('Auxiliary workspace closure').selectOption('late');
  await expect(page.getByRole('alertdialog', { name: 'Values of their own' })).toBeVisible();
  await page.getByTestId('override-yes').click();
  await page.getByRole('button', { name: 'Use canvas settings for this tree', exact: true }).click();
  await page.getByRole('button', { name: 'This tree', exact: true }).click();
  await expect(page.getByLabel('Auxiliary workspace closure')).toHaveValue('late');
  const local = (await canvas(page)).trees.find((tree: { lexical?: { scope: string } }) => tree.lexical?.scope === 'tree');
  await selectSheet(page, local.id);
  await context(page);
  await expect(page.getByTestId('build-derivation')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('.active-sheet [data-node]').first().click({ button: 'right' });
  await page.getByTestId('build-derivation').click();
  await expect.poll(async () => (await canvas(page)).groups.length).toBe(3);
  expect((await canvas(page)).groups[2].sourceTree).toBe(owner.id);
});

test('nanosyntax canvas changes use Appearance Ask, Keep, Replace and remembered choices', async ({ page }) => {
  await page.goto('./');
  await enable(page);
  await page.getByLabel('Spellout-driven movement').selectOption('starke2018');
  await page.getByRole('button', { name: 'Whole canvas', exact: true }).click();
  await page.getByLabel('Spellout-driven movement').selectOption('starke2018');
  await page.getByLabel('Spellout-driven movement').selectOption('caha2025');
  await expect(page.getByRole('alertdialog', { name: 'Values of their own' })).toContainText('spellout-driven movement');
  await page.getByTestId('override-no').click();
  await page.getByRole('button', { name: 'This tree', exact: true }).click();
  await expect(page.getByLabel('Spellout-driven movement')).toHaveValue('starke2018');
  await page.getByLabel('Auxiliary workspace closure').selectOption('late');
  await page.getByRole('button', { name: 'Whole canvas', exact: true }).click();
  await page.getByLabel('Auxiliary workspace closure').selectOption('late');
  await page.getByLabel('Auxiliary workspace closure').selectOption('early');
  await expect(page.getByRole('alertdialog', { name: 'Values of their own' })).toContainText('auxiliary workspace closure');
  await page.getByRole('alertdialog').getByText("Don't ask again (change it in Appearance → Values of their own)", { exact: true }).click();
  await page.getByTestId('override-yes').click();
  await page.getByRole('button', { name: 'This tree', exact: true }).click();
  await expect(page.getByLabel('Auxiliary workspace closure')).toHaveValue('early');
  await expect(page.getByLabel('Spellout-driven movement')).toHaveValue('starke2018');
  expect(await page.evaluate(() => localStorage.getItem('nanotrees:override'))).toBe('replace');
  await page.getByRole('button', { name: 'Whole canvas', exact: true }).click();
  await page.getByLabel('Spellout-driven movement').selectOption('starke2018');
  await page.getByLabel('Spellout-driven movement').selectOption('caha2025');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'This tree', exact: true }).click();
  await expect(page.getByLabel('Spellout-driven movement')).toHaveValue('caha2025');
});

test('only the current movement copy is retained, and hiding the mode keeps all data for re-enabling', async ({ page }) => {
  await page.goto('./');
  await example(page, 'caha-friulian-1sg', 'fin · -iʃ');
  const saved = await canvas(page);
  const steps = saved.trees.filter((entry: { derivation?: unknown }) => entry.derivation);
  let moves = 0;
  for (const entry of steps) {
    const code = saved.sources[entry.src];
    expect(code).not.toMatch(/nsgap|\[\s*\]/);
    if (['move-spec', 'move-complement', 'pied-pipe', 'subextract'].includes(entry.derivation.action)) {
      moves++;
      expect(code).toContain('#ns');
    } else expect(code).not.toContain('#ns');
  }
  expect(moves).toBeGreaterThan(2);
  await expect(page.locator('.active-sheet .arrow-hit')).toHaveCount(0);
  const count = saved.trees.length;
  await page.getByTestId('nanosyntax-toggle').click();
  await expect(page.locator('.lexical-sheet, .derivation-frame')).toHaveCount(0);
  await expect(page.locator('.side-pane')).toBeVisible();
  await expect.poll(async () => (await canvas(page))?.trees?.length).toBe(count);
  await page.getByTestId('nanosyntax-toggle').click();
  await expect(page.locator('.lexical-sheet')).toHaveCount(3);
  await expect(page.locator('.derivation-frame')).toHaveCount(1);
});

test('tree context menus create an L-tree and edit its scope or remove its lexical role', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[Num]');
  await enable(page);
  await context(page);
  await expect(page.getByRole('menuitem').first()).toHaveText('New tree here');
  await expect(page.getByRole('menuitem').nth(1)).toHaveText('New L-tree to this tree');
  await expect(page.getByRole('menuitem', { name: /Copy the tree|Linked copy of the tree|Edit this tree/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'New L-tree to this tree', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill('NumP');
  await page.getByLabel('Label', { exact: true }).press('Enter');
  await expression(page, 'fin');
  await expect(page.locator('.cm-content')).toContainText(';spell="fin"');
  await expect(page.locator('.active-sheet .prims text').filter({ hasText: '⇔ fin' })).toHaveCount(1);
  await expect.poll(async () => (await canvas(page))?.trees?.filter((entry: { lexical?: unknown }) => !entry.lexical)?.length).toBe(1);
  const owner = (await canvas(page)).trees.find((entry: { lexical?: unknown }) => !entry.lexical).id;
  await context(page);
  await page.getByRole('menuitem', { name: 'Change L-tree scope…', exact: true }).click();
  await page.getByRole('button', { name: 'Pick an S-tree on the canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await page.locator('[data-tree="' + owner + '"] .paper').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.canvas-hint')).toHaveCount(0);
  await expect.poll(async () => (await canvas(page))?.trees?.find((entry: { lexical?: unknown }) => entry.lexical)?.lexical?.owner).toBe(owner);
  await context(page);
  await page.getByRole('menuitem', { name: 'Change L-tree scope…', exact: true }).click();
  await page.getByLabel('L-tree scope', { exact: true }).selectOption('canvas');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => (await canvas(page))?.trees?.find((entry: { lexical?: { scope: string } }) => entry.lexical)?.lexical?.scope).toBe('canvas');
  await context(page);
  await page.getByRole('menuitem', { name: 'Stop using as an L-tree', exact: true }).click();
  await expect(page.locator('.lexical-sheet')).toHaveCount(0);
  await expect(page.locator('.active-sheet .prims text').filter({ hasText: '⇒ fin' })).toHaveCount(1);
});

test('ordinary trees can be grouped through the context menu and group membership survives reload', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[A]');
  await expect.poll(async () => (await canvas(page))?.trees?.length).toBe(1);
  const first = (await canvas(page)).active;
  await context(page);
  await page.getByRole('menuitem', { name: 'New tree here', exact: true }).click();
  await setCode(page, '[B]');
  await context(page);
  await page.getByRole('menuitem', { name: 'Add to a group…', exact: true }).click();
  await page.getByLabel('Group or tree', { exact: true }).selectOption('tree:' + first);
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.tree-group-frame')).toHaveCount(1);
  await expect.poll(async () => (await canvas(page))?.treeGroups?.[0]?.members?.length).toBe(2);
  const before = (await canvas(page)).trees.map((entry: { id: string; x: number; y: number }) => ({ id: entry.id, x: entry.x, y: entry.y }));
  const head = await page.locator('.tree-group-head').boundingBox();
  await page.mouse.move(head!.x + 10, head!.y + 10);
  await page.mouse.down();
  await page.mouse.move(head!.x + 50, head!.y + 35, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await canvas(page)).trees[0].x).not.toBe(before[0].x);
  const after = (await canvas(page)).trees;
  expect(after[0].x - before[0].x).toBe(after[1].x - before[1].x);
  expect(after[0].y - before[0].y).toBe(after[1].y - before[1].y);
  await page.reload();
  await expect(page.locator('.tree-group-frame')).toHaveCount(1);
});
