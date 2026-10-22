import * as A from './actions';
import { askOverride } from './ask';
import type { ANode } from './core/ast';
import type { BuildOptions } from './core/build';
import * as E from './core/edits';
import { parse, walkAst } from './core/parser';
import type { TreeStyle } from './core/style';
import { outlineSource, parseOutlines } from './core/outlines';
import { activeId, appearanceScope, build, canvasSettings, mergeBuild, setBuild, setStyle, source, sources, style, trees } from './state';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
function paths(p:object,pre:string[]=[]):string[][] {
  return Object.entries(p).flatMap(([k,v])=>v&&typeof v==='object'&&!Array.isArray(v)?paths(v,[...pre,k]):[[...pre,k]]);
}
const get=(o:unknown,p:string[]):unknown=>p.reduce<unknown>((x,k)=>(x as Record<string,unknown>|undefined)?.[k],o);
const patchOf=(p:string[],v:unknown):Record<string,unknown>=>p.length===1?{[p[0]]:v}:{[p[0]]:patchOf(p.slice(1),v)};
const textOf=(id:string)=>id===activeId.value?source.value:sources.value[trees.value.find(e=>e.id===id)!.srcId]??'';

/** Remove only private values governed by these general settings; preserve all other source. */
export function clearElementOverrides(text:string,keys:string[]):string {
  let next=text;
  for(const key of keys) {
    const result=parse(next); if(!result.ok||!result.doc.root) continue;
    const d=result.doc, changes:E.TextChange[]=[];
    const inherited=new Map<ANode,string|undefined>();
    const visit=(n:ANode,color?:string)=>{inherited.set(n,color);for(const c of n.children)if(c.kind==='node')visit(c,n.branchColor??color);};visit(d.root!);
    const opts:Record<string,string[]>={lineColor:['edge','wordedge'],lineWidth:['width','wordwidth'],linePattern:['edgeline','wordline'],levelGap:['len','wordlen'],siblingGap:['spread'],fontSize:['size','wordsize'],leafColor:['wordcolor'],semColor:['sem'],semComputedColor:['sem']};
    const remove=opts[key]??[];
    const shapeKey=({shapeColor:'color',shapeWidth:'width',shapePattern:'line',shapePadding:'padding'} as const)[key as 'shapeColor'];
    const patchMods=(mods:Record<string,unknown>)=>{
      const out={...mods}; for(const k of remove) delete out[k];
      if(key==='nodeColor'||key==='leafColor') {delete out.color;delete out.branchColor;}
      if(shapeKey) for(const k of ['outline','wordoutline']) if(typeof out[k]==='string') out[k]=outlineSource(parseOutlines(out[k] as string).map(o=>({...o,[shapeKey]:undefined})));
      return out;
    };
    walkAst(d.root!,n=>{
      const before=n.opts??{},after=patchMods(before) as Record<string,string>;
      const branch=n.branchColor??inherited.get(n);
      let color=n.color;
      if(key==='nodeColor') {
        if(color&&color!=='default') {if(!after.sem)after.sem=color;color=undefined;}
        if(branch)color='default';
      }
      if(key==='leafColor'&&branch&&n.children.some(c=>c.kind==='leaf'))after.wordcolor='default';
      if(key==='lineColor') {
        if(inherited.get(n))after.edge='default';
        if(branch&&n.children.some(c=>c.kind==='leaf'))after.wordedge='default';
      }
      if((key==='semColor'||key==='semComputedColor')&&(n.color||branch))after.sem='default';
      if(color!==n.color||JSON.stringify(before)!==JSON.stringify(after)) changes.push({from:n.labelSpan.to,to:n.headerSpan.to,insert:E.modifiers({...n,color,opts:after})});
      if(key==='nodeColor'||key==='leafColor') for(const c of n.children) if(c.kind==='ref'&&c.color) changes.push(...E.setRefStyle(c,{color:null}).changes);
    });
    for(const p of d.posStyles) {
      const after=patchMods({...p.mods}) as typeof p.mods;
      if(JSON.stringify(after)!==JSON.stringify(p.mods)) changes.push({from:p.span.from,to:p.span.to,insert:E.posStyleLine(p.id,p.occ,after)??''});
    }
    for(const a of d.arrows) {
      let patch:Partial<typeof a>|null=null;
      if(key==='arrowColor'&&a.color) patch={color:undefined};
      if(key==='arrowWidth'&&a.width!==undefined) patch={width:undefined};
      if(key==='arrowPattern'&&(a.lineOwn||a.line!=='solid')) patch={line:'solid',lineOwn:undefined};
      if((key==='chainArrows'||key==='headArrows')&&!a.plain&&(a.hidden||a.visible)) {
        const chain=a.from===a.to&&!!a.fromOcc;
        if(chain===(key==='chainArrows')) patch={hidden:undefined,visible:undefined};
      }
      if(patch) changes.push(...E.updateArrow(a,patch).changes);
    }
    if(changes.length) next=E.applyChanges(next,changes);
  }
  return next;
}
function writeText(id:string,next:string) {
  const old=textOf(id); if(old===next)return;
  if(id===activeId.value) A.applyEdit({changes:[{from:0,to:old.length,insert:next}]});
  else {const e=trees.value.find(e=>e.id===id);if(e)sources.value={...sources.value,[e.srcId]:next};}
}
function setFor(id:string,kind:'style'|'build',part:object) {
  if(id===activeId.value) {if(kind==='style')setStyle(part as Partial<TreeStyle>);else setBuild(part as DeepPartial<BuildOptions>);}
  else trees.value=trees.value.map(e=>e.id!==id?e:kind==='style'?{...e,style:{...e.style,...part}}:{...e,build:mergeBuild(e.build,part as DeepPartial<BuildOptions>)});
}
async function apply(kind:'style'|'build',patch:object) {
  const ps=paths(patch),keys=ps.map(p=>p.join('.'));
  const canvas=appearanceScope.value==='canvas', ids=canvas?trees.value.map(e=>e.id):[activeId.value];
  const old=canvasSettings.value[kind];
  const own=new Map<string,string[]>();
  for(const id of ids) {
    const obj=id===activeId.value?(kind==='style'?style.value:build.value):trees.value.find(e=>e.id===id)![kind];
    own.set(id,canvas?ps.filter(p=>get(obj,p)!==get(old,p)&&get(obj,p)!==get(patch,p)).map(p=>p.join('.')):[]);
  }
  const elementOwn=ids.filter(id=>clearElementOverrides(textOf(id),keys)!==textOf(id));
  if(canvas) canvasSettings.value={...canvasSettings.value,[kind]:kind==='style'?{...old,...patch}:mergeBuild(canvasSettings.value.build,patch as DeepPartial<BuildOptions>)};
  // Inherited items follow at once; independent ones await the same replacement dialog.
  for(const id of ids) for(const p of ps) if(!own.get(id)!.includes(p.join('.'))) setFor(id,kind,patchOf(p,get(patch,p)));
  const privateTrees=ids.filter(id=>own.get(id)!.length);
  if(!privateTrees.length&&!elementOwn.length)return;
  const names=[...new Set([...privateTrees,...elementOwn])].map(id=>trees.value.find(e=>e.id===id)?.name).join(', ');
  const yes=await askOverride(`${canvas?'canvas':ids[0]}:${keys.join(',')}`,`${names} contain values of their own for ${keys.map(k=>k.replace(/([A-Z])/g,' $1').toLowerCase()).join(', ')}. Replace those values too, or keep them independent?`);
  if(!yes)return;
  for(const id of ids) {
    if(!trees.value.some(e=>e.id===id))continue;
    for(const p of ps) if(own.get(id)!.includes(p.join('.')))setFor(id,kind,patchOf(p,get(patch,p)));
    writeText(id,clearElementOverrides(textOf(id),keys));
  }
}
export function applyStyle(p:Partial<TreeStyle>){void apply('style',p);}
export function applyBuild(p:DeepPartial<BuildOptions>){void apply('build',p);}
