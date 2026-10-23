import type { NodeHit, Scene } from './scene';
import type { DNode } from './model';

export interface DropSlot { key:string; mode:'daughter'|'sister'; index:number; x:number; y:number }
/** Ordered gaps below the label, excluding positions that leave a moved branch in place. */
export function dropSlots(hit:NodeHit, scene:Scene, moving?:DNode):DropSlot[] {
  const {node,box} = hit;
  const children = node.children.flatMap(n => {const h=scene.hits.find(h=>h.node===n); return h?[h]:[];});
  const xs = children.map(h=>h.x).sort((a,b)=>a-b);
  const spread = Math.max(24, (box.x2-box.x1)/2+10);
  const gaps = xs.length ? [Math.min(xs[0]-20, hit.x-spread), ...xs.slice(1).map((x,i)=>(xs[i]+x)/2), Math.max(xs[xs.length-1]+20,hit.x+spread)] : [hit.x];
  const slots:DropSlot[] = gaps.map((x,index)=>({key:hit.key,mode:'daughter',index,x,y:box.y2+12}));
  if(node.parents.length) slots.push({key:hit.key,mode:'sister',index:0,x:box.x1-14,y:(box.y1+box.y2)/2},{key:hit.key,mode:'sister',index:1,x:box.x2+14,y:(box.y1+box.y2)/2});
  return slots.filter(slot=>{
    if(!moving)return true;
    const parent=slot.mode==='daughter'?node:node.parents[0];
    if(!parent)return true;
    const current=parent.children.indexOf(moving);
    if(current<0)return true;
    const gap=slot.mode==='daughter'?slot.index:parent.children.indexOf(node)+slot.index;
    return gap!==current&&gap!==current+1;
  });
}
