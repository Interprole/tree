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
  await expect(page.locator('.customize-panel')).toContainText('Tree line');
  await page.locator('.customize-panel .swatch[title="#b91c1c"]').click();await expect.poll(()=>code(page)).toContain(';edge=#b91c1c');
  await page.getByRole('button',{name:'All elements in this tree',exact:true}).click();
  const color=page.locator('.settings .color-field').filter({hasText:/^Lines/}).locator('input[type="color"]');
  await color.evaluate((el:HTMLInputElement)=>{el.value='#123456';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByTestId('override-no').click();await expect.poll(()=>code(page)).toContain(';edge=#b91c1c');
  await page.getByTestId('side-edit').click();await node(page,'A').click();await expect(page.locator('.inspector')).not.toContainText('Edge width');
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
