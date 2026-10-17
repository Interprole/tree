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
  // the label field of the edit panel: the tree follows as you type
  const label = page.locator('.inspector input[aria-label="Label"]');
  await expect(label).toBeFocused();
  await label.fill("V'");
  await page.keyboard.press('Enter');
  await expect.poll(() => code(page)).toContain("[V' runs]");
  // add a daughter with the keyboard: its label is ready to be typed
  await page.locator('[data-node] title', { hasText: "V′" }).locator('..').click();
  await page.keyboard.press('a');
  await expect(label).toBeFocused();
  await label.fill('Adv');
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
  await expect(page.locator('.inspector h2', { hasText: 'Arrow' })).toBeVisible();
  await page.locator('.inspector button', { hasText: 'Dashed' }).click();
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
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: /My trees/ }).click();
  await page.getByPlaceholder('Name').fill('Mine');
  await page.getByRole('button', { name: 'Save current tree' }).click();
  await page.keyboard.press('Escape');
  await setCode(page, '[B other]');
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: /My trees/ }).click();
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
  await page.locator('.inspector button', { hasText: 'Re-merge as daughter' }).click();
  await page.locator('[data-node] title', { hasText: /^DP$/ }).first().locator('..').click();
  await expect.poll(() => code(page)).toBe('[CP\n    [DP#dp what]\n    [VP [V see] #dp]]');
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
  const insp = page.locator('.inspector');
  await expect(insp.locator('h2', { hasText: 'Arrow' })).toBeVisible();
  await insp.locator('.swatch[title="#1d4ed8"]').click();
  await expect.poll(() => code(page)).toContain('@#1d4ed8');
  await insp.locator('button', { hasText: 'Reverse' }).click();
  await expect.poll(() => code(page)).toContain('#a -> #b');
  await insp.locator('.label-list input').first().fill('wh');
  await insp.locator('.label-list button', { hasText: '+ Add' }).click();
  await insp.locator('.label-list input').nth(1).fill('**A**');
  await insp.locator('.label-list select').nth(1).selectOption('above');
  await insp.locator('.label-list button', { hasText: 'Apply' }).click();
  await expect.poll(() => code(page)).toContain('"wh" above"**A**"');
  await page.keyboard.press('Escape');
  const box = await page.locator('.label-hit').first().boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => code(page)).toMatch(/"wh"@\d+,\d+/);
  // click a label: edit it in the panel, then delete it
  const lab = await page.locator('.label-hit').first().boundingBox();
  await page.mouse.click(lab!.x + lab!.width / 2, lab!.y + lab!.height / 2);
  const text = insp.locator('input[aria-label^="Text"]');
  await text.fill('A-mvt');
  await text.press('Enter');
  await expect.poll(() => code(page)).toMatch(/"A-mvt"@\d+,\d+/);
  const lab2 = await page.locator('.label-hit').first().boundingBox();
  await page.mouse.click(lab2!.x + lab2!.width / 2, lab2!.y + lab2!.height / 2);
  await insp.locator('button', { hasText: 'Delete label' }).click();
  await expect.poll(() => code(page)).not.toContain('A-mvt');
});

test('node: notes, edge style, spacing at once, restructure', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [DP she] [VP [V saw] [DP him]]]');
  const node = (label: string) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) });
  const insp = page.locator('.inspector');
  await node('VP').click();
  await insp.locator('.label-list input').first().fill('focus');
  await insp.locator('.label-list button', { hasText: 'Apply' }).click();
  await expect.poll(() => code(page)).toContain('[VP [V saw] [DP him] &"focus"]');
  await node('VP').click();
  await insp.locator('.seg button', { hasText: 'Edge' }).click();
  await insp.locator('.swatch[title="#b91c1c"]').click();
  await expect.poll(() => code(page)).toContain('[VP;edge=#b91c1c');
  // number fields apply at once: typing, and the arrow keys
  const width = insp.locator('.num-field', { hasText: 'Edge width' }).locator('input');
  await width.fill('3');
  await expect.poll(() => code(page)).toContain(';width=3');
  await width.press('ArrowUp');
  await expect.poll(() => code(page)).toContain(';width=3.5');
  const spread = insp.locator('.num-field', { hasText: 'Spread' }).locator('input');
  await spread.focus();
  await spread.press('ArrowUp');
  await expect.poll(() => code(page)).toContain(';spread=1');
  await page.locator('.canvas').focus();
  await page.keyboard.press('Escape');
  await node('S').click();
  await insp.locator('button', { hasText: '← left' }).click();
  await expect.poll(() => code(page)).toMatch(/^\[S\s+\[VP[^]*\]\s+\[DP she\]\]$/);
  // already left-branching: a message, no change
  await insp.locator('button', { hasText: '← left' }).click();
  await expect(page.locator('.toast')).toContainText('Already left-branching');
});

test('custom colour, mother, layout of the code', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  const insp = page.locator('.inspector');
  await page.locator('[data-node] title', { hasText: /^VP$/ }).locator('..').click();
  await insp.locator('.swatch.custom input').evaluate((el: HTMLInputElement) => {
    el.value = '#123456';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => code(page)).toContain('[VP@#123456 runs]');
  // the colour is offered again
  await expect(insp.locator('.swatch[title="#123456"]')).toHaveCount(1);
  // a mother above VP, with the code laid out on lines
  await page.keyboard.press('p');
  await expect(insp.locator('input[aria-label="Label"]')).toBeFocused();
  await insp.locator('input[aria-label="Label"]').fill('TP');
  await page.keyboard.press('Enter');
  await expect.poll(() => code(page)).toBe('[S\n    [NP John]\n    [TP [VP@#123456 runs]]]');
});

test('several trees: a copy, a linked copy, each with its own export', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  // an independent copy
  await page.locator('.tree-tab').first().locator('.tab-more').click();
  // the menu is really on top (not cut off by the strip of tabs)
  const item = page.locator('.tab-menu button', { hasText: 'Copy' }).first();
  const box = (await item.boundingBox())!;
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.tab-menu'), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);
  await item.click();
  await expect(page.locator('.tree-tab')).toHaveCount(2);
  await expect(page.locator('.sheet-head')).toHaveCount(2);
  await setCode(page, '[S [NP Mary] [VP sleeps]]');
  await page.locator('.tree-tab .tab-name').first().click();
  await expect(page.locator('.cm-content')).toContainText('John');
  // a linked copy follows every edit
  await page.locator('.tree-tab').first().locator('.tab-more').click();
  await page.locator('.tab-menu button', { hasText: 'Linked copy' }).click();
  await expect(page.locator('.tree-tab')).toHaveCount(3);
  await expect(page.locator('.tree-tab.on .link-mark')).toHaveCount(1);
  await setCode(page, '[S [NP Bill] [VP runs]]');
  await page.locator('.tree-tab .tab-name').first().click();
  await expect(page.locator('.cm-content')).toContainText('Bill');
  await page.locator('.tree-tab .tab-name').nth(1).click();
  await expect(page.locator('.cm-content')).toContainText('Mary');
  // all three are on the canvas; the export names the tree
  await expect(page.locator('.other-sheet')).toHaveCount(2);
  await page.getByTestId('export').click();
  await expect(page.locator('.modal h2')).toContainText('Tree 1 (copy)');
  await page.keyboard.press('Escape');
  // the whole canvas is autosaved
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nanotrees:current') ?? '{}').snap?.w?.trees?.length))
    .toBe(3);
});

test('deleting a restyled chain arrow hides it instead of restoring the default', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#wh what] [VP [V buy] #wh]]');
  await page.locator('.arrow-hit').first().evaluate((el) => {
    const p = el as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    (window as unknown as { __pt: unknown }).__pt = { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
  });
  const pt = await page.evaluate(() => (window as unknown as { __pt: { x: number; y: number } }).__pt);
  await page.mouse.click(pt.x, pt.y);
  await page.locator('.inspector button', { hasText: 'Dashed' }).click();
  await expect.poll(() => code(page)).toContain('#wh/2 -> #wh/1 dashed');
  await page.locator('.inspector button', { hasText: 'Delete arrow' }).click();
  await expect.poll(() => code(page)).toContain('#wh/2 -> #wh/1 hide');
  await expect(page.locator('.arrow-hit')).toHaveCount(0);
});

test('panes can be resized', async ({ page }) => {
  await page.goto('./');
  const pane = page.locator('.code-pane');
  const w0 = (await pane.boundingBox())!.width;
  const sp = (await page.locator('.code-pane .splitter').boundingBox())!;
  await page.mouse.move(sp.x + sp.width / 2, sp.y + 200);
  await page.mouse.down();
  await page.mouse.move(sp.x + sp.width / 2 + 120, sp.y + 200, { steps: 5 });
  await page.mouse.up();
  const w1 = (await pane.boundingBox())!.width;
  expect(w1).toBeGreaterThan(w0 + 80);
});

test('selecting another node does not take the keyboard away from the shortcuts', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  const node = (label: string) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) });
  await node('VP').dblclick();
  await expect(page.locator('.inspector input[aria-label="Label"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await node('NP').click();
  await expect(page.locator('.inspector input[aria-label="Label"]')).not.toBeFocused();
  await page.keyboard.press('s');
  await expect.poll(() => code(page)).toMatch(/\[NP John\]\s+\[X\]/);
});

test('bend points: double-click the arrow to add one, drag it, double-click it to remove it', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#a what] [C′ did [VP see [DP#b t]]]]\n#b -> #a');
  const at = (f: number) =>
    page.locator('.arrow-hit').first().evaluate((el, f) => {
      const p = el as SVGPathElement;
      const pt = p.getPointAtLength(p.getTotalLength() * f);
      const m = p.getScreenCTM()!;
      return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
    }, f);
  // one handle becomes two bend points: +1
  const p1 = await at(0.3);
  await page.mouse.dblclick(p1.x, p1.y);
  await expect.poll(() => code(page)).toMatch(/via=-?\d+,-?\d+;-?\d+,-?\d+$/m);
  await expect(page.locator('.bend-handle.via')).toHaveCount(2);
  // and one more
  const p2 = await at(0.75);
  await page.mouse.dblclick(p2.x, p2.y);
  await expect(page.locator('.bend-handle.via')).toHaveCount(3);
  const h = (await page.locator('.bend-handle.via').nth(1).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + 50, { steps: 5 });
  await page.mouse.up();
  const before = await code(page);
  await page.mouse.dblclick(h.x + h.width / 2, h.y + 50);
  await expect.poll(() => code(page)).not.toBe(before);
  await expect(page.locator('.bend-handle.via')).toHaveCount(2);
  await page.locator('.inspector button', { hasText: 'Automatic shape' }).click();
  await expect.poll(() => code(page)).not.toContain('via=');
});

test('head movement without the arrow', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[TP [T#t -s] [VP [V#v sing] [DP it]]]\n#v -> #t');
  await expect(page.locator('.prims')).toContainText('sing+-s');
  const mid = await page.locator('.arrow-hit').first().evaluate((el) => {
    const p = el as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
  });
  await page.mouse.click(mid.x, mid.y);
  await page.locator('.inspector button', { hasText: 'Movement without the arrow' }).click();
  await expect.poll(() => code(page)).toContain('#v -> #t hide');
  await expect(page.locator('.arrow-hit')).toHaveCount(0);
  // the movement stays
  await expect(page.locator('.prims')).toContainText('sing+-s');
  // the arrow comes back from the panel of the node
  await page.locator('[data-node] title', { hasText: /^V\+T$/ }).locator('..').click();
  await page.locator('.inspector button', { hasText: 'Show arrow' }).click();
  await expect.poll(() => code(page)).not.toContain('hide');
  await expect(page.locator('.arrow-hit')).toHaveCount(1);
  // all head-movement arrows off, the movement still on
  await page.getByTestId('settings-toggle').click();
  await page.locator('.settings .toggle', { hasText: 'Arrows for head movement' }).click();
  await expect(page.locator('.arrow-hit')).toHaveCount(0);
  await expect(page.locator('.prims')).toContainText('sing+-s');
});

test('save the canvas to disk and open it again (download where files cannot be written)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = undefined;
    w.showOpenFilePicker = undefined;
  });
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  await page.locator('.tree-tab').first().locator('.tab-more').click();
  await page.locator('.tab-menu button', { hasText: 'Linked copy' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')]);
  expect(dl.suggestedFilename()).toMatch(/\.nanotrees$/);
  const { readFileSync } = await import('node:fs');
  const text = readFileSync((await dl.path())!, 'utf8');
  const data = JSON.parse(text);
  expect(data.app).toBe('NanoTrees');
  expect(data.canvas.w.trees).toHaveLength(2);
  await expect(page.getByTestId('file-menu')).toContainText('.nanotrees');
  // something else, then open the file again
  await setCode(page, '[X other]');
  await expect(page.locator('.unsaved-dot')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('ControlOrMeta+o')]);
  await chooser.setFiles({ name: 'mine.nanotrees', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('.tree-tab')).toHaveCount(2);
  await expect(page.locator('.cm-content')).toContainText('John');
  await expect(page.locator('.unsaved-dot')).toHaveCount(0);
});

test('save into a connected file, again with Ctrl+S, and keep it up to date', async ({ page }) => {
  await page.addInitScript(() => {
    const files: Record<string, string> = {};
    const w = window as unknown as Record<string, unknown>;
    w.__files = files;
    w.showSaveFilePicker = async (o: { suggestedName: string }) => {
      const name = o.suggestedName;
      return { name, createWritable: async () => ({ write: async (t: string) => (files[name] = t), close: async () => undefined }) };
    };
  });
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: /Save to disk/ }).click();
  const files = () => page.evaluate(() => (window as unknown as { __files: Record<string, string> }).__files);
  await expect.poll(async () => Object.keys(await files())).toEqual(['trees.nanotrees']);
  await setCode(page, '[S [NP Mary] [VP runs]]');
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => (await files())['trees.nanotrees']).toContain('Mary');
  // automatic saving into the file
  await page.getByTestId('file-menu').click();
  await page.locator('.menu-toggle input').check();
  await page.keyboard.press('Escape');
  await setCode(page, '[S [NP Bill] [VP runs]]');
  await expect.poll(async () => (await files())['trees.nanotrees']).toContain('Bill');
  await expect(page.locator('.unsaved-dot')).toHaveCount(0);
});

test('copy a subtree and paste it as a copy: a daughter, a sister, a new tree', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP [V saw] [DP#o Mary]]]');
  const node = (label: string) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) });
  await node('VP').click();
  await page.locator('.canvas').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await node('NP').first().click();
  await page.locator('.canvas').focus();
  await page.keyboard.press('ControlOrMeta+v');
  // a copy of its own: the id is renamed
  await expect.poll(() => code(page)).toMatch(/\[NP\s+John\s+\[VP\s+\[V saw\]\s+\[DP#o2 Mary\]\]\]/);
  await expect.poll(() => code(page)).toContain('[DP#o Mary]');
  // a copy as a sister (Ctrl+D)
  await node('V').first().click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect.poll(() => code(page)).toMatch(/\[V saw\]\s+\[V saw\]/);
  // nothing selected: a new tree on the canvas
  await page.keyboard.press('Escape');
  await page.locator('.canvas').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.tree-tab')).toHaveCount(2);
  await expect(page.locator('.cm-content')).toContainText('[VP');
});

test('this copy or all copies: triangle, colour, features; shortcuts with another layout', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#wh [D which] [NP book]] [VP [V buy] #wh]]');
  const dp = (i: number) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^DP$/ }) }).nth(i);
  const insp = page.locator('.inspector');
  await dp(1).click();
  await expect(insp.locator('.scope button.on')).toContainText('This copy #wh/2');
  // the T key with another keyboard layout: a triangle over this copy only
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'τ', code: 'KeyT', bubbles: true })));
  await expect.poll(() => code(page)).toContain('#wh/2: ^');
  await expect(page.locator('.prims text', { hasText: 'which book' })).toHaveCount(1);
  await dp(1).click();
  await insp.locator('.swatch[title="#15803d"]').click();
  await expect.poll(() => code(page)).toContain('#wh/2: ^ @#15803d');
  // the pronounced copy on its own
  await dp(0).click();
  await insp.locator('input[aria-label="Features, separated by commas"]').fill('uφ');
  await insp.locator('input[aria-label="Features, separated by commas"]').press('Enter');
  await expect.poll(() => code(page)).toContain('#wh/1: {uφ}');
  // all copies: written on the constituent
  await dp(0).click();
  await insp.locator('.scope button', { hasText: 'All copies' }).click();
  await insp.locator('.swatch[title="#1d4ed8"]').click();
  await expect.poll(() => code(page)).toContain('[DP#wh@#1d4ed8');
  // the A key with another layout adds a daughter
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^VP$/ }) }).click();
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'α', code: 'KeyA', bubbles: true })));
  await expect.poll(() => code(page)).toContain('[X]');
});
