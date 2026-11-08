import { beforeEach, expect, test } from 'vitest';
import { dropSlots } from '../src/core/drop';
import { buildScene } from '../src/core/scene';
import { approxMeasure } from '../src/core/measure';
import { defaultStyle } from '../src/core/style';
import { clearElementOverrides, applyStyle } from '../src/overrides';
import { activeId, addTree, appearanceScope, canvasSettings, restore, snapshot, source, sources, style, tree as active, trees } from '../src/state';
import { copyScope, moveNode, nodeByKey, setOption } from '../src/actions';
import { overridePolicy } from '../src/ask';
import { tree } from './helpers';

beforeEach(()=>{overridePolicy.value='replace';copyScope.value='all';restore({s:'[S [A a] [B b] [C c]]'});});
test('daughter gaps are n+1 and sister slots are ordered',()=>{
  const t=tree(source.value),sc=buildScene(t,defaultStyle,approxMeasure);
  const root=sc.hits.find(h=>h.node===t.root)!;
  const slots=dropSlots(root,sc);
  expect(slots.map(s=>s.index)).toEqual([0,1,2,3]);
  expect(slots.every((s,i)=>i===0||s.x>slots[i-1].x)).toBe(true);
  const sisters=dropSlots(sc.hits.find(h=>h.node.id==='a')??sc.hits[1],sc).filter(s=>s.mode==='sister');
  expect(sisters.map(s=>s.index)).toEqual([0,1]);
});
test('moving within the same mother omits the two gaps around the current position',()=>{
  const t=tree(source.value),sc=buildScene(t,defaultStyle,approxMeasure);
  const root=sc.hits.find(h=>h.node===t.root)!;
  const [a,b,c]=t.root.children;
  expect(dropSlots(root,sc,a).map(s=>s.index)).toEqual([2,3]);
  expect(dropSlots(root,sc,b).map(s=>s.index)).toEqual([0,3]);
  expect(dropSlots(root,sc,c).map(s=>s.index)).toEqual([0,1]);
  // No move is supplied for a copy or an independent source tree.
  expect(dropSlots(root,sc).map(s=>s.index)).toEqual([0,1,2,3]);
  expect(dropSlots(root,sc,tree('[X]').root).map(s=>s.index)).toEqual([0,1,2,3]);
});
test('neighbouring sister targets omit the same unchanged positions',()=>{
  const t=tree(source.value),sc=buildScene(t,defaultStyle,approxMeasure);
  const [a,b,c]=t.root.children;
  const before=sc.hits.find(h=>h.node===a)!,after=sc.hits.find(h=>h.node===c)!;
  expect(dropSlots(before,sc,b).filter(s=>s.mode==='sister').map(s=>s.index)).toEqual([0]);
  expect(dropSlots(after,sc,b).filter(s=>s.mode==='sister').map(s=>s.index)).toEqual([1]);
});
test('an only daughter has no alternative position under its current mother',()=>{
  const t=tree('[S [A a]]'),sc=buildScene(t,defaultStyle,approxMeasure);
  expect(dropSlots(sc.hits.find(h=>h.node===t.root)!,sc,t.root.children[0])).toEqual([]);
});
test('branch can move to first daughter and before a sister',()=>{
  moveNode(active.value!.root.children[2],active.value!.root,'daughter',false,{index:0});
  expect(active.value!.root.children.map(n=>n.src!.kind==='node'?n.src!.label:'')).toEqual(['C','A','B']);
  moveNode(active.value!.root.children[2],active.value!.root.children[0],'sister',false,{index:0});
  expect(active.value!.root.children.map(n=>n.src!.kind==='node'?n.src!.label:'')).toEqual(['B','C','A']);
});
test('shift-style copy is independent and alt-style copy is linked',()=>{
  moveNode(active.value!.root.children[0],active.value!.root,'daughter',true,{index:3});
  expect(active.value!.root.children).toHaveLength(4);
  expect(source.value).not.toContain(';link=');
  moveNode(active.value!.root.children[1],active.value!.root,'daughter','linked',{index:0});
  expect(source.value.match(/;link=/g)).toHaveLength(2);
});
test('expression edges have independent source options',()=>{
  const word=active.value!.root.children[0].children[0];
  setOption(word,'width','3');
  expect(source.value).toContain(';wordwidth=3');
  expect(active.value!.root.children[0].edgeWidth).toBeUndefined();
  expect(active.value!.root.children[0].children[0].edgeWidth).toBe(3);
});
test('general styles remove only corresponding private values, including chain positions and shapes',()=>{
  const s='[S;outline="s1 oval branch red 2 dashed 8" [A#a@red;size=30;edge=blue a] #a]\n#a/2: @green width=4 size=22\n#a/2 -> #a/1 dashed width=3 @red';
  const next=clearElementOverrides(s,['nodeColor','fontSize','arrowPattern','shapeColor']);
  expect(next.split('\n').slice(0,2).join('\n')).not.toMatch(/@(?:red|green)|size=/);
  expect(next).toContain('@red');
  expect(next).toContain(';edge=blue');
  expect(next).toContain('width=4');
  expect(next).toContain('width=3');
  expect(next).toContain('s1 oval branch - 2 dashed 8');
});
test('canvas style reaches private elements in inactive trees',async()=>{
  const id=addTree('[X;edge=red [Y y]]');
  appearanceScope.value='canvas';
  applyStyle({lineColor:'blue'});
  await new Promise(resolve=>setTimeout(resolve,0));
  const e=trees.value.find(e=>e.id===id)!;
  expect(sources.value[e.srcId]).not.toContain(';edge=red');
  expect(nodeByKey(active.value!.root.key)).toBeTruthy();
});

test('replacing one branch colour property preserves its other element colours',()=>{
  const original='[S@@red [A a] [B b]]';
  const render=(text:string)=>buildScene(tree(text),{...defaultStyle,nodeColor:'blue',leafColor:'green',lineColor:'orange'},approxMeasure);
  const expressions=render(clearElementOverrides(original,['leafColor']));
  expect(expressions.prims.filter(p=>p.t==='text'&&p.role==='leaf').every(p=>p.t==='text'&&p.color==='green')).toBe(true);
  expect(expressions.prims.filter(p=>p.t==='path'&&p.role==='edge').every(p=>p.t==='path'&&p.stroke==='red')).toBe(true);
  const labels=render(clearElementOverrides(original,['nodeColor']));
  expect(labels.prims.filter(p=>p.t==='text'&&p.role==='label').every(p=>p.t==='text'&&p.color==='blue')).toBe(true);
  expect(labels.prims.filter(p=>p.t==='text'&&p.role==='leaf').every(p=>p.t==='text'&&p.color==='red')).toBe(true);
  const edges=render(clearElementOverrides(original,['lineColor']));
  for(const e of edges.edges) {
    const child=tree(clearElementOverrides(original,['lineColor'])).nodes.find(n=>n.key===e.child)!;
    expect(edges.prims.find(p=>p.t==='path'&&p.role==='edge'&&p.node===child.key)).toMatchObject({stroke:child.kind==='leaf'?'red':'orange'});
  }
  expect(edges.prims.filter(p=>p.t==='text'&&p.role==='label').every(p=>p.t==='text'&&p.color==='red')).toBe(true);
});

test.each([
  ['lineColor','edge','wordedge'], ['lineWidth','width','wordwidth'], ['linePattern','edgeline','wordline'],
  ['wordLineColor','wordedge','edge'], ['wordLineWidth','wordwidth','width'], ['wordLinePattern','wordline','edgeline'],
])('%s replaces only its own class of private line settings', (key,removed,kept)=>{
  const text='[S [A#a;edge=red;width=2;edgeline=dashed;wordedge=blue;wordwidth=3;wordline=dotted a] #a]\n#a/2: edge=green width=4 edgeline=dotted wordedge=purple wordwidth=5 wordline=dashed';
  const next=clearElementOverrides(text,[key]);
  expect(next).not.toMatch(new RegExp('(?:;|\\s)'+removed+'='));
  expect(next).toMatch(new RegExp(';'+kept+'='));
  expect(next).toMatch(new RegExp(' '+kept+'='));
});

test('node and expression lines render independent colour, width, pattern and hand drawing',()=>{
  const t=tree('[S [N word]]');
  const sc=buildScene(t,{...defaultStyle,lineColor:'red',lineWidth:2,linePattern:'dashed',handDrawn:true,
    wordLineColor:'blue',wordLineWidth:3,wordLinePattern:'dotted',wordHandDrawn:false},approxMeasure);
  const node=t.root.children[0],word=node.children[0];
  const nodeLine=sc.prims.find(p=>p.t==='path'&&p.role==='edge'&&p.node===node.key);
  const wordLine=sc.prims.find(p=>p.t==='path'&&p.role==='edge'&&p.node===word.key);
  expect(nodeLine).toMatchObject({stroke:'red',width:2,dash:[5,3.5]});
  expect(wordLine).toMatchObject({stroke:'blue',width:3,dash:[1.2,2.8]});
  expect(nodeLine?.t==='path'&&nodeLine.d).toContain('Q');
  expect(wordLine?.t==='path'&&wordLine.d).not.toContain('Q');
});

test('tree and canvas changes keep the other line class independent, including inactive trees',async()=>{
  const first=activeId.value;
  const second=addTree('[X;edge=red;wordedge=green;wordwidth=3 word]');
  appearanceScope.value='tree';
  applyStyle({lineColor:'blue',lineWidth:2});
  await new Promise(r=>setTimeout(r,0));
  expect(style.value).toMatchObject({lineColor:'blue',lineWidth:2,wordLineColor:defaultStyle.wordLineColor,wordLineWidth:1});
  expect(source.value).toContain(';wordedge=green');
  expect(trees.value.find(e=>e.id===first)!.style.lineColor).toBe(defaultStyle.lineColor);
  appearanceScope.value='canvas';
  applyStyle({wordLineColor:'purple',wordLineWidth:4});
  await new Promise(r=>setTimeout(r,0));
  expect(trees.value.find(e=>e.id===second)!.style).toMatchObject({lineColor:'blue',lineWidth:2,wordLineColor:'purple',wordLineWidth:4});
  expect(canvasSettings.value.style.lineColor).toBe(defaultStyle.lineColor);
  expect(source.value).not.toContain(';wordedge=green');
});

test('old saved shared lines migrate, while new independent defaults survive save/restore',()=>{
  restore({s:'[N word]',st:{lineColor:'red',lineWidth:2,linePattern:'dashed',handDrawn:true}});
  expect(style.value).toMatchObject({wordLineColor:'red',wordLineWidth:2,wordLinePattern:'dashed',wordHandDrawn:true});
  restore({s:'[N word]'});
  style.value={...style.value,lineColor:'blue',lineWidth:3,linePattern:'dotted',handDrawn:true};
  const saved=snapshot(true);restore(saved);
  expect(style.value).toMatchObject({lineColor:'blue',lineWidth:3,linePattern:'dotted',handDrawn:true,
    wordLineColor:defaultStyle.wordLineColor,wordLineWidth:1,wordLinePattern:'solid',wordHandDrawn:false});
});
test('an expression of a chain position can have its own size',()=>{
  restore({s:'[S [DP#d;spell="word"] [VP #d]]'});copyScope.value='this';
  const copy=active.value!.nodes.find(n=>n.chainRef?.id==='d'&&n.chainRef.occ===2)!;setOption(copy.children[0],'wordsize','24');
  expect(source.value).toContain('#d/2: wordsize=24');
  expect(active.value!.nodes.find(n=>n.chainRef?.id==='d'&&n.chainRef.occ===1)!.children[0].fontSize).toBeUndefined();
  expect(active.value!.nodes.find(n=>n.chainRef?.id==='d'&&n.chainRef.occ===2)!.children[0].fontSize).toBe(24);
});

test('an explicit expression colour at a silent position overrides its gray copy style',()=>{
  const t=tree('[S [DP#d;spell="word"] [VP #d]]\n#d/2: wordcolor=blue');
  const lower=t.nodes.find(n=>n.chainRef?.id==='d'&&n.chainRef.occ===2)!;
  const picture=buildScene(t,defaultStyle,approxMeasure);
  expect(picture.prims.find(p=>p.t==='text'&&p.node===lower.children[0].key&&p.role==='leaf')).toMatchObject({color:'blue'});
});
