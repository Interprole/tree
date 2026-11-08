import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';
async function setup(page:Page,code='[S [A a] [B b] [C c]]') {
  await page.goto('./');
  const paper=page.locator('.active-sheet .paper'), b=(await paper.boundingBox())!;
  await paper.click({position:{x:b.width/2,y:b.height-5}});
  const editor=page.locator('.cm-content');await editor.click();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.insertText(code);
  await page.locator('.mode-switch button',{hasText:'Manual'}).click();
  await page.getByRole('button',{name:'Fit to window',exact:true}).click();
}
const node=(page:Page,label:string)=>page.locator('.active-sheet [data-node]').filter({has:page.locator('title',{hasText:new RegExp('^'+label+'$')})}).first();
const code=(page:Page)=>page.locator('.cm-content').innerText();
async function pathPoint(locator:ReturnType<Page['locator']>) {
  return locator.evaluate(el=>{
    const p=el as SVGPathElement,m=p.getScreenCTM()!;
    for(const fraction of [.12,.02,.3,.48,.64,.8,.94]) {
      const q=p.getPointAtLength(p.getTotalLength()*fraction),x=m.a*q.x+m.c*q.y+m.e,y=m.b*q.x+m.d*q.y+m.f;
      if(document.elementFromPoint(x,y)===el)return {x,y};
    }
    throw new Error('No visible clickable part of this path');
  });
}
test('tree edges select independently, and general settings ask about private values',async({page})=>{
  await setup(page);const p=await pathPoint(page.locator('[data-edge]').first());await page.mouse.click(p.x,p.y);
  await expect(page.locator('.customize-panel')).toContainText('Line to node');
  await page.locator('.customize-panel .swatch[title="#b91c1c"]').click();await expect.poll(()=>code(page)).toContain(';edge=#b91c1c');
  await page.getByRole('button',{name:'All elements in this tree',exact:true}).click();
  const color=page.locator('.panel-section').filter({has:page.getByRole('heading',{name:'Lines to nodes',exact:true})}).locator('input[type="color"]');
  await color.evaluate((el:HTMLInputElement)=>{el.value='#123456';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByTestId('override-no').click();await expect.poll(()=>code(page)).toContain(';edge=#b91c1c');
  await page.getByTestId('side-edit').click();await node(page,'A').click();await expect(page.locator('.inspector')).not.toContainText('Edge width');
});

test('node and expression line settings remain independent at tree and canvas scope',async({page})=>{
  await setup(page,'[S [N cat] [V runs]]');
  await page.getByTestId('side-appearance').click();
  await page.getByRole('button',{name:'All elements in this tree',exact:true}).click();
  const section=(name:string)=>page.locator('.panel-section').filter({has:page.getByRole('heading',{name,exact:true})});
  const nodes=section('Lines to nodes'),words=section('Lines to expressions');
  const setColor=async(name:string,color:string)=>section(name).locator('input[type="color"]').evaluate((el:HTMLInputElement,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},color);
  await setColor('Lines to nodes','#123456');
  await expect(words.locator('input[type="color"]')).toHaveValue('#1a1a1a');
  await setColor('Lines to expressions','#654321');
  await expect(nodes.locator('input[type="color"]')).toHaveValue('#123456');
  await words.getByRole('radio',{name:'Dotted',exact:true}).click();
  await expect(nodes.getByRole('radio',{name:'Solid',exact:true})).toHaveClass(/on/);
  await expect(page.locator('.active-sheet .prims path[stroke="#123456"]')).toHaveCount(2);
  await expect(page.locator('.active-sheet .prims path[stroke="#654321"]')).toHaveCount(2);
  await page.getByRole('button',{name:'All trees',exact:true}).click();
  await setColor('Lines to expressions','#abcdef');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByTestId('override-yes').click();
  await page.getByRole('button',{name:'All elements in this tree',exact:true}).click();
  await expect(nodes.locator('input[type="color"]')).toHaveValue('#123456');
  await expect(words.locator('input[type="color"]')).toHaveValue('#abcdef');
  const wordKey=await node(page,'cat').getAttribute('data-node');
  const edge=page.locator(`[data-edge$="|${wordKey}"]`),p=await pathPoint(edge);await page.mouse.click(p.x,p.y);
  await expect(page.locator('.customize-panel')).toContainText('Line to expression');
  await page.locator('.customize-panel .swatch[title="#b91c1c"]').click();
  await expect.poll(()=>code(page)).toContain(';wordedge=#b91c1c');
  await expect.poll(()=>code(page)).not.toContain(';edge=#b91c1c');
});

test('LaTeX commands render, remain editable and appear in code completion',async({page})=>{
  await setup(page,String.raw`[\textbf{S} [N \textit{cat} \textup{plain}] [V \textsc{pst}]]`);
  await expect(page.locator('.active-sheet .prims')).not.toContainText('textbf');
  const root=page.locator('.active-sheet .prims tspan').filter({hasText:/^S$/});
  await expect(root.locator('..')).toHaveAttribute('font-weight','700');
  const cat=page.locator('.active-sheet .prims tspan').filter({hasText:/^cat$/});
  const plain=page.locator('.active-sheet .prims tspan').filter({hasText:/^plain$/});
  expect(await cat.evaluate(el=>getComputedStyle(el).fontStyle)).toBe('italic');
  expect(await plain.evaluate(el=>getComputedStyle(el).fontStyle)).toBe('normal');
  await expect(page.locator('.active-sheet .prims')).toContainText('PST');
  const editor=page.locator('.cm-content');await editor.click();await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n% \\textb');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('\\textbf');
});
test('spatial drops skip unchanged positions; Shift and Alt keep copy gaps',async({page})=>{
  await setup(page);
  async function drag(label:string,index:number,modifier?:'Shift'|'Alt') {
    await page.getByRole('button',{name:'Fit to window',exact:true}).click();
    const from=(await node(page,label).boundingBox())!,root=(await node(page,'S').boundingBox())!;
    if(modifier)await page.keyboard.down(modifier);
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(root.x+root.width/2,root.y+root.height/2,{steps:8});
    const gaps=page.locator('.drop-slot[data-drop-mode="daughter"]');await expect(gaps).toHaveCount(index===0?2:index+1);
    const slot=(await page.locator(`.drop-slot[data-drop-mode="daughter"][data-drop-index="${index}"]`).boundingBox())!;await page.mouse.move(slot.x+slot.width/2,slot.y+slot.height/2,{steps:4});await page.mouse.up();
    if(modifier)await page.keyboard.up(modifier);
  }
  await drag('C',0);await expect.poll(()=>code(page)).toMatch(/\[S\s+\[C c\]\s+\[A a\]\s+\[B b\]\]/);
  await drag('A',3,'Shift');await expect(page.locator('.active-sheet [data-node] title',{hasText:/^A$/})).toHaveCount(2);await expect.poll(()=>code(page)).not.toContain(';link=');
  await drag('B',4,'Alt');await expect.poll(async()=>(await code(page)).match(/;link=/g)?.length).toBe(2);
});
test('guide includes algorithms and real code examples from its shared source',async({page})=>{
  await page.goto('./');await page.getByTestId('guide').click();await page.locator('.guide-nav button',{hasText:'Nanosyntax:'}).click();
  await expect(page.locator('.guide-body')).toContainText('Multiple Merge');await expect(page.locator('.guide-body')).toContainText('Chapter 7');
  await page.locator('.guide-nav button',{hasText:'Expressions and spellout'}).click();await expect(page.locator('.guide-body pre')).toContainText('[NumP;spell="fin" [Num]]');
});

test('shape controls are absent from the preview',async({page})=>{
  await setup(page);await expect(page.getByLabel('Add a shape',{exact:true})).toHaveCount(0);
  await page.getByTestId('side-appearance').click();await expect(page.locator('.settings')).not.toContainText('Shape padding');
  await expect(page.locator('[data-shape]')).toHaveCount(0);
});
