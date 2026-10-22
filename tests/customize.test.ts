import { beforeEach, expect, test } from 'vitest';
import { dropSlots } from '../src/core/drop';
import { buildScene } from '../src/core/scene';
import { approxMeasure } from '../src/core/measure';
import { defaultStyle } from '../src/core/style';
import { clearElementOverrides, applyStyle } from '../src/overrides';
import { addTree, appearanceScope, restore, source, sources, tree as active, trees } from '../src/state';
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
  expect(edges.prims.filter(p=>p.t==='path'&&p.role==='edge').every(p=>p.t==='path'&&p.stroke==='orange')).toBe(true);
  expect(edges.prims.filter(p=>p.t==='text'&&p.role==='label').every(p=>p.t==='text'&&p.color==='red')).toBe(true);
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
