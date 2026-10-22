import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function setCode(page: Page, text: string) {
  await showCode(page);
  const ed = page.locator('.cm-content');
  await ed.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
  await page.waitForTimeout(150);
}

async function showCode(page: Page) {
  if (!await page.locator('.cm-content').isVisible()) {
    await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
    const paper = page.locator('.active-sheet .paper');
    const box = (await paper.boundingBox())!;
    // The top corner can lie under another sheet's caption. Select the
    // white bottom margin without relying on panels recentering the canvas.
    await paper.click({ position: { x: box.width / 2, y: box.height - 5 } });
  }
}
async function selectTree(page: Page, index: number) {
  await showCode(page);
  await page.locator('.tree-tab .tab-name').nth(index).click();
  await showCode(page);
}
async function copyWholeBranch(page: Page, linked = false) {
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await page.locator('.active-sheet [data-node]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: linked ? /^Copy as a linked branch/ : /^Copy branch/ }).click();
  await page.getByTestId('canvas').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.getByRole('menuitem', { name: /^Paste as a new tree here/ }).click();
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await showCode(page);
}
const code = async (page: Page) => (await page.locator('.cm-line').allTextContents()).join('\n');

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
  await page.getByTestId('side-appearance').click();
  await page.getByLabel('Line pattern',{exact:true}).selectOption('dashed');
  await expect.poll(() => code(page)).toContain('dashed');
  // drag a bend of the arrow down: the arrow takes over its bends as its own points
  const h = await page.locator('.bend-handle').first().boundingBox();
  expect(h).toBeTruthy();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => code(page)).toMatch(/via=-?\d+,-?\d+/);
  // delete the selected arrow with the keyboard
  await page.locator('.canvas').focus();
  await page.keyboard.press('Delete');
  await expect.poll(() => code(page)).not.toContain('->');
});

test('c-command and dominance have no toolbar controls or C/D shortcuts',async({page})=>{
  await page.goto('./');await setCode(page,'[S [NP John] [VP runs]]');
  await page.locator('[data-node]').first().click();await page.keyboard.press('c');await page.keyboard.press('d');
  await expect(page.locator('.canvas-tools')).not.toContainText(/C-command|Dominance|Relations/);
  await expect(page.locator('.rel-ccommand,.rel-dominance')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Remerge a constituent as daughter',exact:true }).click();
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
  await page.getByTestId('side-appearance').click();
  await page.locator('.customize-panel .swatch[title="#1d4ed8"]').first().click();
  await page.getByTestId('side-edit').click();
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
  const line=page.locator('[data-edge$="|n.1"]');
  // Pick the actual incoming VP line, not its node.
  const path=await line.evaluate(el=>{const p=el as SVGPathElement,q=p.getPointAtLength(p.getTotalLength()/2),m=p.getScreenCTM()!;return {x:m.a*q.x+m.c*q.y+m.e,y:m.b*q.x+m.d*q.y+m.f};});
  await page.mouse.click(path.x,path.y);
  const custom=page.locator('.customize-panel');
  await custom.locator('.swatch[title="#b91c1c"]').click();
  await expect.poll(() => code(page)).toContain('[VP;edge=#b91c1c');
  const width=custom.locator('.num-field',{hasText:'Line width'}).locator('input');
  await width.fill('3');
  await expect.poll(()=>code(page)).toContain(';width=3');
  await width.press('ArrowUp');
  await expect.poll(()=>code(page)).toContain(';width=3.1');
  await node('VP').click();
  await page.getByTestId('side-appearance').click();
  const spread=custom.locator('.num-field',{hasText:'Spread daughters'}).locator('input');
  await spread.focus();await spread.press('ArrowUp');
  await expect.poll(()=>code(page)).toContain(';spread=1');
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
  await page.getByTestId('side-appearance').click();
  const custom=page.locator('.customize-panel');
  await custom.locator('.swatch.custom input').first().evaluate((el: HTMLInputElement) => {
    el.value = '#123456';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => code(page)).toContain('[VP@#123456 runs]');
  // the colour is offered again
  await expect(custom.locator('.swatch[title="#123456"]').first()).toBeVisible();
  await page.getByTestId('side-edit').click();
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
  // Whole trees are copied through their root branch.
  await copyWholeBranch(page);
  await expect(page.locator('.tree-tab')).toHaveCount(2);
  await expect(page.locator('.sheet-head')).toHaveCount(2);
  await setCode(page, '[S [NP Mary] [VP sleeps]]');
  await selectTree(page, 0);
  await expect(page.locator('.cm-content')).toContainText('John');
  // a linked copy follows every edit
  await copyWholeBranch(page, true);
  await expect(page.locator('.tree-tab')).toHaveCount(3);
  await expect(page.locator('.tree-tab.on .link-mark')).toHaveCount(1);
  // an edit inside the linked tree (its root is the linked branch) reaches the original
  await expect(page.locator('.cm-content')).toContainText(';link=');
  await setCode(page, (await code(page)).replace('John', 'Bill'));
  await selectTree(page, 0);
  await expect(page.locator('.cm-content')).toContainText('Bill');
  await selectTree(page, 1);
  await expect(page.locator('.cm-content')).toContainText('Mary');
  // all three are on the canvas; the export names the tree
  await expect(page.locator('.other-sheet')).toHaveCount(2);
  await page.getByTestId('export').click();
  await expect(page.locator('.modal h2')).toContainText((await page.locator('.tree-tab.on .tab-name').textContent())!.trim());
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
  await page.getByTestId('side-appearance').click();
  await page.getByLabel('Line pattern',{exact:true}).selectOption('dashed');
  await expect.poll(() => code(page)).toContain('#wh/2 -> #wh/1 dashed');
  await page.getByTestId('side-edit').click();
  await page.locator('.inspector button', { hasText: 'Delete arrow' }).click();
  await expect.poll(() => code(page)).toContain('#wh/2 -> #wh/1 hide');
  await expect(page.locator('.arrow-hit')).toHaveCount(0);
});

test('panes can be resized', async ({ page }) => {
  await page.goto('./');
  await showCode(page);
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
  // every bend of the arrow is marked; a double-click adds one more
  await page.locator('.arrow-hit').first().click({ force: true, position: { x: 1, y: 1 } }).catch(() => undefined);
  const p0 = await at(0.5);
  await page.mouse.click(p0.x, p0.y);
  const bends = await page.locator('.bend-handle').count();
  expect(bends).toBeGreaterThanOrEqual(1);
  const p1 = await at(0.3);
  await page.mouse.dblclick(p1.x, p1.y);
  await expect.poll(() => code(page)).toContain('via=');
  await expect(page.locator('.bend-handle.via')).toHaveCount(bends + 1);
  const h = (await page.locator('.bend-handle.via').nth(1).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  // while the bend is dragged the tree stays where it is (it does not shift or rescale), the handle under the pointer
  const cp = async () => (await page.locator('.canvas-svg text', { hasText: 'CP' }).first().boundingBox())!;
  const still = await cp();
  for (const dy of [60, 140, 220, 50]) {
    await page.mouse.move(h.x + h.width / 2 - dy / 2, h.y + dy, { steps: 3 });
    const now = await cp();
    expect(Math.abs(now.x - still.x) + Math.abs(now.y - still.y)).toBeLessThan(0.5);
    expect(Math.abs(now.width - still.width)).toBeLessThan(0.5);
    const g = (await page.locator('.bend-handle.via').nth(1).boundingBox())!;
    expect(Math.abs(g.y + g.height / 2 - (h.y + dy))).toBeLessThan(2);
  }
  await page.mouse.move(h.x + h.width / 2, h.y + 50, { steps: 3 });
  await page.mouse.up();
  const before = await code(page);
  await page.mouse.dblclick(h.x + h.width / 2, h.y + 50);
  await expect.poll(() => code(page)).not.toBe(before);
  await expect(page.locator('.bend-handle.via')).toHaveCount(bends);
  await page.locator('.inspector button', { hasText: 'Automatic shape' }).click();
  await expect.poll(() => code(page)).not.toContain('via=');
});

test('arrows are just arrows; movement: head movement written on the head, phrasal movement as copies', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[TP [T#t -s] [VP [V#v sing] [DP it]]]');
  const node = (label: string, i = 0) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label.replace(/[+]/g, '\\+')}$`) }) }).nth(i);
  const insp = page.locator('.inspector');
  const draw = async (from: string, to: string) => {
    await page.locator('button[aria-label="Draw movement arrow"]').click();
    await node(from).click();
    await node(to).click();
  };
  await draw('V', 'T');
  await expect.poll(() => code(page)).toContain('#v -> #t plain');
  await expect(page.locator('.prims')).not.toContainText('sing+-s');
  // movement between heads of two categories: head movement, written on the head
  await insp.locator('.seg button', { hasText: 'Movement' }).click();
  await expect.poll(() => code(page)).toContain('[V#v;to=t sing]');
  await expect.poll(() => code(page)).not.toContain('plain');
  await expect(page.locator('.prims')).toContainText('sing+-s');
  await expect(page.locator('.arrow-hit')).toHaveCount(1);
  // delete the arrow, keep the movement
  await page.locator('.arrow-hit').first().evaluate((el) => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  const mid = await page.locator('.arrow-hit').first().evaluate((el) => {
    const p = el as SVGPathElement;
    const pt = p.getPointAtLength(p.getTotalLength() / 2);
    const m = p.getScreenCTM()!;
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
  });
  await page.mouse.click(mid.x, mid.y);
  await insp.locator('button', { hasText: 'Delete arrow, keep movement' }).click();
  await expect.poll(() => code(page)).toContain('#v -> #t hide');
  await expect(page.locator('.arrow-hit')).toHaveCount(0);
  await expect(page.locator('.prims')).toContainText('sing+-s');
  // the same movement again: one visible arrow, no hidden one left
  await draw('V', 'V+T');
  await insp.locator('.seg button', { hasText: 'Movement' }).click();
  await expect.poll(() => code(page)).not.toContain('hide');
  await expect(page.locator('.arrow-hit')).toHaveCount(1);
  // the switch hides movement arrows only
  await page.getByTestId('side-appearance').click();
  await page.getByRole('button',{name:'All elements in this tree',exact:true}).click();
  await page.locator('.settings .toggle', { hasText: 'Arrows for head movement' }).click();
  await expect(page.locator('.arrow-hit')).toHaveCount(0);
  await expect(page.locator('.prims')).toContainText('sing+-s');
});

test('phrasal movement: copies; categories must match', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP what] [C\' [C did] [VP [V see] [DP what] [NP it]]]]');
  await page.locator('.mode-switch button', { hasText: 'Manual' }).click();
  const node = (label: string, i = 0) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) }).nth(i);
  const insp = page.locator('.inspector');
  await page.locator('button[aria-label="Draw movement arrow"]').click();
  await node('NP').click();
  await node('DP', 0).click();
  await insp.locator('.seg button', { hasText: 'Movement' }).click();
  await expect(page.locator('.toast')).toContainText('one category');
  await expect.poll(() => code(page)).toContain('plain');
  await insp.locator('button', { hasText: 'Delete arrow' }).click();
  await expect.poll(() => code(page)).not.toContain('->');
  await page.locator('button[aria-label="Draw movement arrow"]').click();
  await node('DP', 1).click();
  await node('DP', 0).click();
  await insp.locator('.seg button', { hasText: 'Movement' }).click();
  // the same words: the lower one is a silent copy of the higher one
  await expect.poll(() => code(page)).toMatch(/\[DP#dp what\][^]*\[V see\]\s+#dp\s+\[NP(#np)? it\]/);
  await expect.poll(() => code(page)).not.toContain('->');
  await expect(page.locator('.arrow-hit')).toHaveCount(1);
});

test('save the canvas to disk and open it again (download where files cannot be written)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showSaveFilePicker = undefined;
    w.showOpenFilePicker = undefined;
  });
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  await copyWholeBranch(page, true);
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
  await page.getByTestId('side-appearance').click();
  await page.locator('.customize-panel .swatch[title="#15803d"]').first().click();
  await page.getByTestId('side-edit').click();
  await expect.poll(() => code(page)).toContain('#wh/2: ^ @#15803d');
  // the pronounced copy on its own
  await dp(0).click();
  await insp.locator('input[aria-label="Features, separated by commas"]').fill('uφ');
  await insp.locator('input[aria-label="Features, separated by commas"]').press('Enter');
  await expect.poll(() => code(page)).toContain('#wh/1: {uφ}');
  // all copies: written on the constituent
  await dp(0).click();
  await insp.locator('.scope button', { hasText: 'All copies' }).click();
  await page.getByTestId('side-appearance').click();
  await page.getByRole('button',{name:'All copies',exact:true}).click();
  await page.locator('.customize-panel .swatch[title="#1d4ed8"]').first().click();
  await expect.poll(() => code(page)).toContain('[DP#wh@#1d4ed8');
  // the silent copy has its own colour: keep it
  await page.getByTestId('override-no').click();
  await expect.poll(() => code(page)).toContain('#wh/2: ^ @#15803d');
  // or replace it
  await page.waitForTimeout(1500);
  await page.locator('.customize-panel .swatch[title="#be185d"]').first().click();
  await page.getByTestId('override-yes').click();
  await expect.poll(() => code(page)).not.toContain('@#15803d');
  // the A key with another layout adds a daughter
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^VP$/ }) }).click();
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'α', code: 'KeyA', bubbles: true })));
  await expect.poll(() => code(page)).toContain('[X]');
});

test('linked branches: edits inside are repeated, around them free; undo; frames', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP [V saw] [DP Mary]]]');
  const node = (label: string, i = 0) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) }).nth(i);
  // right click: copy as a linked branch
  await node('VP').click({ button: 'right' });
  await page.locator('.ctx-menu button', { hasText: 'Copy as a linked branch' }).click();
  await expect.poll(() => code(page)).toMatch(/\[VP;link=\w+/);
  // paste it as a daughter of S
  await node('S').click({ button: 'right' });
  await page.locator('.ctx-menu button', { hasText: 'Paste as daughter' }).click();
  await expect.poll(async () => ((await code(page)).match(/;link=/g) ?? []).length).toBe(2);
  await expect(page.locator('.linked-frame')).toHaveCount(2);
  // inside one copy: both change
  await node('DP', 0).click();
  await page.keyboard.press('a');
  await page.locator('.inspector input[aria-label="Label"]').fill('AP');
  await page.keyboard.press('Enter');
  await expect.poll(async () => ((await code(page)).match(/\[AP\]/g) ?? []).length).toBe(2);
  // around it: a sister of one copy only
  await node('VP', 1).click();
  await page.keyboard.press('s');
  await page.locator('.inspector input[aria-label="Label"]').fill('ZP');
  await page.keyboard.press('Enter');
  await expect.poll(async () => ((await code(page)).match(/\[ZP\]/g) ?? []).length).toBe(1);
  await expect.poll(async () => ((await code(page)).match(/\[AP\]/g) ?? []).length).toBe(2);
  // undo the edit inside: both copies go back
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => ((await code(page)).match(/\[(AP|X)\]/g) ?? []).length).toBe(0);
});

test('mouse: drag a branch by its root, select a branch with a rectangle', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP [V saw] [DP Mary]]]');
  const node = (label: string) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: new RegExp(`^${label}$`) }) }).first();
  const dp = (await node('DP').boundingBox())!;
  const np = (await node('NP').boundingBox())!;
  await page.mouse.move(dp.x + dp.width / 2, dp.y + dp.height / 2);
  await page.mouse.down();
  await page.mouse.move(np.x + np.width / 2 + 30, np.y + np.height + 18, { steps: 8 });
  await expect(page.locator('.drop-target')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => code(page)).toMatch(/\[NP\s+John\s+\[DP Mary\]\]/);
  // Shift + a rectangle around "saw": the smallest branch is selected
  const v = (await node('V').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(v.x - 10, v.y - 10);
  await page.mouse.down();
  await page.mouse.move(v.x + v.width + 10, v.y + v.height * 3, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.inspector input[aria-label="Label"]')).toHaveValue(/^(V|VP)$/);
});

test('one copy open although all copies are triangles; expression; code panel; canvas menu', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#wh ^ [D which] [NP book]] [VP [V buy] #wh]]');
  await page.locator('.mode-switch button', { hasText: 'Manual' }).click();
  const dp = (i: number) => page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^DP$/ }) }).nth(i);
  await dp(1).click();
  await page.keyboard.press('t');
  await expect.poll(() => code(page)).toContain('#wh/2: open');
  await expect(page.locator('.prims text', { hasText: /^which$/ })).toHaveCount(1);
  // an expression for a node
  await setCode(page, '[S [NP] [VP runs]]');
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^NP$/ }) }).click();
  await page.locator('.inspector input[aria-label^="Expression"]').fill('student');
  await expect.poll(() => code(page)).toContain('[NP;spell="student"]');
  // the code panel folds away and comes back
  await page.locator('.code-hide').click();
  await expect.poll(async () => (await page.locator('.code-pane').boundingBox())?.width ?? 0).toBeLessThan(5);
  await page.locator('.code-show').click();
  await expect.poll(async () => (await page.locator('.code-pane').boundingBox())?.width ?? 0).toBeGreaterThan(100);
  // right click on the empty canvas: a new tree where the mouse is, clear the canvas
  await page.locator('.canvas').click({ button: 'right', position: { x: 30, y: 300 } });
  await page.locator('.ctx-menu button', { hasText: 'New tree here' }).click();
  await expect(page.locator('.tree-tab')).toHaveCount(2);
  // right click on a tree
  await page.getByRole('button', { name: 'Fit to window', exact: true }).click();
  await page.locator('.sheet-head').first().click({ button: 'right' });
  await expect(page.locator('.ctx-menu .ctx-title')).toBeVisible();
  await page.keyboard.press('Escape');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('clear-canvas').click();
  await expect(page.locator('.tree-tab')).toHaveCount(1);
  await showCode(page);
  await expect(page.locator('.cm-placeholder')).toBeVisible();
});

test('appearance for all trees: trees with their own value are asked about', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  await copyWholeBranch(page);
  // tree 2 has its own setting
  await page.getByTestId('side-appearance').click();
  await page.locator('.settings .seg button', { hasText: 'Struck through' }).click();
  // the empty canvas: settings of all trees
  await page.locator('.canvas').click({ position: { x: 10, y: 10 } });
  await page.getByTestId('side-appearance').click();
  await expect(page.locator('.customize-scope button.on')).toHaveText('All trees');
  await page.locator('.settings .seg button', { hasText: '⟨Angle brackets⟩' }).click();
  await expect(page.getByTestId('override-no')).toBeVisible();
  await page.getByTestId('override-no').click();
  // tree 1 followed, tree 2 kept its own
  await selectTree(page, 0);
  await page.getByTestId('side-appearance').click();
  await page.locator('.customize-scope button').first().click();
  await expect(page.locator('.settings .seg button.on', { hasText: '⟨Angle brackets⟩' })).toHaveCount(1);
  await selectTree(page, 1);
  await page.getByTestId('side-appearance').click();
  await page.locator('.customize-scope button').first().click();
  await expect(page.locator('.settings .seg button.on', { hasText: 'Struck through' })).toHaveCount(1);
});

test('empty trees: the sheet stays, a first node by right click, a branch dragged in from another tree', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  // a new tree starts empty
  await page.locator('.add-tree').click();
  await expect(page.locator('.empty-sheet')).toHaveCount(1);
  // drag NP from tree 1 onto the empty tree
  await selectTree(page, 0);
  await page.locator('button[aria-label="Fit to window"]').click();
  const np = (await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^NP$/ }) }).boundingBox())!;
  const empty = (await page.locator('.empty-sheet .paper').boundingBox())!;
  await page.mouse.move(np.x + np.width / 2, np.y + np.height / 2);
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, { steps: 10 });
  await expect(page.locator('.drop-target')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => code(page)).not.toContain('John');
  await selectTree(page, 1);
  await expect.poll(() => code(page)).toContain('[NP John]');
  // deleting the whole tree leaves its sheet; right click: add a node
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^NP$/ }) }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.empty-sheet.active-sheet')).toHaveCount(1);
  await page.locator('.empty-sheet.active-sheet .paper').click({ button: 'right' });
  await page.locator('.ctx-menu button', { hasText: 'Add a node' }).click();
  await expect.poll(() => code(page)).toBe('[X]');
  await expect(page.locator('.inspector input[aria-label="Label"]')).toBeFocused();
});

test('a selected copy stays selected while it is edited; a click on the canvas opens Customize', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#wh what] [VP [V buy] #wh]]');
  const copy = page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^DP$/ }) }).nth(1);
  await copy.click();
  await page.getByTestId('side-appearance').click();
  await page.locator('.customize-panel .swatch[title="#15803d"]').first().click();
  await page.getByTestId('side-edit').click();
  await expect.poll(() => code(page)).toContain('#wh/2: @#15803d');
  await expect(page.locator('.inspector h2')).toHaveText('Silent copy');
  await page.locator('.inspector input[aria-label^="Features"]').fill('uφ');
  await page.locator('.inspector input[aria-label^="Features"]').press('Enter');
  await expect(page.locator('.inspector h2')).toHaveText('Silent copy');
  await page.locator('.canvas').click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId('side-appearance')).toHaveClass(/on/);
  await expect(page.locator('.customize-scope button.on')).toHaveText('All trees');
});

test('the sheet of a tree can be made larger by its corner, and back', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[S [NP John] [VP runs]]');
  const paper = page.locator('.active-sheet .paper');
  const w0 = (await paper.boundingBox())!.width;
  const c = (await page.locator('.sheet-resize').boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await paper.boundingBox())!.width).toBeGreaterThan(w0 + 60);
  // the tree grows with it
  const fs = await page.locator('.prims text').first().getAttribute('font-size');
  expect(Number(fs)).toBeGreaterThan(17);
  // the export has the same size
  await page.getByTestId('export').click();
  await expect(page.locator('.modal')).toContainText('×');
  await page.keyboard.press('Escape');
  const c2 = (await page.locator('.sheet-resize').boundingBox())!;
  await page.mouse.dblclick(c2.x + c2.width / 2, c2.y + c2.height / 2);
  await expect.poll(async () => Math.round((await paper.boundingBox())!.width)).toBe(Math.round(w0));
});

test('a branch with a copy moves into another tree in full; the copy left behind is pronounced; paste into an empty tree', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [DP#wh what] [C\' [C did] [VP [V buy] #wh]]]');
  await page.locator('.mode-switch button', { hasText: 'Manual' }).click();
  await page.locator('.add-tree').click();
  await selectTree(page, 0);
  await page.locator('button[aria-label="Fit to window"]').click();
  // VP holds the silent copy of what: in the other tree it is written out
  const vp = (await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^VP$/ }) }).boundingBox())!;
  const empty = (await page.locator('.empty-sheet .paper').boundingBox())!;
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => code(page)).not.toContain('VP');
  await selectTree(page, 1);
  await expect.poll(() => code(page)).toBe('[VP [V buy] [DP what]]');
  // the DP leaves tree 1 the other way: tree 1 keeps a pronounced what
  await selectTree(page, 0);
  await setCode(page, '[CP [DP#wh what] [C\' [C did] [VP [V buy] #wh]]]');
  // Use a separate empty sheet as the drop target. Pasting at the canvas
  // corner can overlap the source when opening panels leaves the view fixed.
  await page.locator('.add-tree').click();
  await selectTree(page, 0);
  await page.locator('button[aria-label="Fit to window"]').click();
  const dp = (await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^DP$/ }) }).first().boundingBox())!;
  const empty2 = (await page.locator('.empty-sheet .paper').first().boundingBox())!;
  await page.mouse.move(dp.x + dp.width / 2, dp.y + dp.height / 2);
  await page.mouse.down();
  await page.mouse.move(empty2.x + empty2.width / 2, empty2.y + empty2.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => code(page)).toBe("[CP [C' [C did] [VP [V buy] [DP#wh what]]]]");
  // copy a branch, paste it into an empty tree
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^VP$/ }) }).click();
  await page.locator('.canvas').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('.add-tree').click();
  await page.locator('.empty-sheet.active-sheet .paper').click({ button: 'right' });
  await page.locator('.ctx-menu button', { hasText: 'Paste here' }).click();
  await expect.poll(() => code(page)).toBe('[VP [V buy] [DP#wh what]]');
});

test('ids renamed in another tree: head movement follows', async ({ page }) => {
  await page.goto('./');
  await setCode(page, '[CP [C#c ∅] [TP [T#t;to=c did] [VP buy]]]');
  await copyWholeBranch(page);
  // copy the whole tree 2 and paste it into tree 2 again: the ids are taken there
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^CP$/ }) }).click();
  await page.locator('.canvas').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('[data-node]').filter({ has: page.locator('title', { hasText: /^VP$/ }) }).click();
  await page.locator('.canvas').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => code(page)).toContain('[C#c2 ∅]');
  await expect.poll(() => code(page)).toContain('[T#t2;to=c2 did]');
  await expect(page.locator('.status.ok')).toBeVisible();
});

/** choose a font in the font menu (by id: a built-in font, or 'local:' for one of the computer) */
async function pickFont(page: Page, id: string) {
  await page.locator('.font-current').click();
  await page.locator(`.font-options [data-font="${id}"]`).click();
}

test('font menu: every name in its own font; an installed font keeps the tree as it is until named; a name the computer lacks is pointed out', async ({ page }) => {
  await page.goto('./');
  await page.locator('.canvas-svg').click({ position: { x: 5, y: 5 } });
  await page.locator('.font-current').click();
  const roboto = page.locator('.font-options [data-font="roboto"]');
  await expect(roboto).toHaveText('Roboto');
  expect(await roboto.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^Roboto/);
  await roboto.click();
  await expect(page.locator('.font-options')).toHaveCount(0);
  await expect(page.locator('.font-current')).toHaveText('Roboto');
  const text = page.locator('.canvas-svg text').first();
  await expect(text).toHaveAttribute('font-family', /^Roboto/);
  await pickFont(page, 'local:');
  await expect(page.locator('.local-font input')).toBeVisible();
  await expect(text).toHaveAttribute('font-family', /^Roboto/);
  await page.locator('.local-font input').fill('No Such Font Qx');
  await page.locator('.local-font input').press('Enter');
  await expect(text).toHaveAttribute('font-family', /No Such Font Qx/);
  await expect(page.locator('.hint.warn')).toContainText('No Such Font Qx');
  await pickFont(page, 'cmu');
  await expect(page.locator('.local-font')).toHaveCount(0);
});

test('installed fonts: picking from the list takes the font picked, not what was typed', async ({ page }) => {
  // the browser's list of installed fonts, counted
  await page.addInitScript(() => {
    const w = window as unknown as { queryLocalFonts: () => Promise<unknown[]>; asked: number };
    w.asked = 0;
    w.queryLocalFonts = async () => {
      w.asked++;
      return ['Robin Sans Test', 'Robust Serif Test', 'Other Test'].map((family) => ({ family, style: 'Regular', fullName: family, postscriptName: family, blob: async () => new Blob() }));
    };
  });
  await page.goto('./');
  await page.locator('.canvas-svg').click({ position: { x: 5, y: 5 } });
  await pickFont(page, 'local:');
  await page.locator('.local-font button', { hasText: 'List the fonts installed' }).click();
  await expect(page.locator('.font-names button')).toHaveCount(3);
  await page.locator('.local-font input').fill('rob');
  await expect(page.locator('.font-names button')).toHaveCount(2);
  await page.locator('.font-names button', { hasText: 'Robust Serif Test' }).click();
  const text = page.locator('.canvas-svg text').first();
  await expect(text).toHaveAttribute('font-family', /^"Robust Serif Test"/);
  await expect(page.locator('.local-font input')).toHaveValue('Robust Serif Test');
  await expect(page.locator('.font-names button.on')).toHaveText('Robust Serif Test');
  // typing alone changes nothing until Enter
  await page.locator('.local-font input').fill('Other');
  await page.locator('.canvas-svg').click({ position: { x: 5, y: 5 } });
  await expect(text).toHaveAttribute('font-family', /^"Robust Serif Test"/);
});

test.describe('Safari', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' });
  test('only the fonts of the system, listed to pick from, and why', async ({ page }) => {
    await page.goto('./');
    await page.locator('.canvas-svg').click({ position: { x: 5, y: 5 } });
    await page.locator('.font-current').click();
    await expect(page.locator('.font-options [data-font="local:"]')).toHaveText('A system font…');
    await page.locator('.font-options [data-font="local:"]').click();
    await expect(page.locator('.local-font .hint', { hasText: 'only the fonts that come with macOS' })).toBeVisible();
    await expect(page.locator('.local-font button', { hasText: 'List the fonts' })).toHaveCount(0);
    const first = page.locator('.font-names button').first();
    if (await first.count()) {
      const name = (await first.textContent())!;
      await first.click();
      await expect(page.locator('.canvas-svg text').first()).toHaveAttribute('font-family', new RegExp(name));
      await expect(page.locator('.font-names button.on')).toHaveText(name);
    }
  });
});
