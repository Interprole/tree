import * as A from '../actions';
import { activeTree, appearanceScope, customizeScope, selection, style, tree } from '../state';
import { ColorPicker, NumField } from './Inspector';
import { SettingsPanel } from './SettingsPanel';
import { Section } from './controls';

function Pattern({value,onChange}:{value:string;onChange:(v:'solid'|'dashed'|'dotted')=>void}) {
  return <label class="insp-field"><span>Line pattern</span><select aria-label="Line pattern" value={value} onChange={e=>onChange(e.currentTarget.value as 'solid'|'dashed'|'dotted')}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>;
}
export function CustomizePanel() {
  const sel=selection.value, s=style.value;
  const n=sel?.kind==='node'?A.nodeByKey(sel.key):sel?.kind==='edge'?A.nodeByKey(sel.child):null;
  const arrow=sel?.kind==='arrow'?tree.value?.arrows[sel.index]:undefined;
  const element=!!(n||arrow);
  const copies=!!n&&!!A.instanceOf(n);
  const scope=element?customizeScope.value:appearanceScope.value;
  const local=scope==='element'||scope==='copies';
  const changeScope=(v:typeof customizeScope.value)=>{
    customizeScope.value=v;
    if(v==='tree'||v==='canvas') appearanceScope.value=v;
    else A.copyScope.value=v==='copies'?'all':'this';
  };
  return <div class="customize-panel">
    <div class="scope customize-scope"><span class="end-lbl">Apply to</span><div class="seg small grow">
      {element&&<button class={scope==='element'?'on':''} onClick={()=>changeScope('element')}>This element</button>}
      {copies&&<button class={scope==='copies'?'on':''} onClick={()=>changeScope('copies')}>All copies</button>}
      <button class={scope==='tree'?'on':''} onClick={()=>changeScope('tree')}>{element?'All elements in this tree':'This tree'}</button>
      <button class={scope==='canvas'?'on':''} onClick={()=>changeScope('canvas')}>All trees</button>
    </div></div>
    {!local||!element?<SettingsPanel hideScope/>:<div class="settings" key={`${activeTree.value.id}:${sel?.kind}:${n?.key??''}`}>
      {n&&sel?.kind==='node'&&<>
        <Section title={n.kind==='leaf'?'Expression':'Node label'}>
          <ColorPicker value={n.color} onPick={c=>n.kind==='leaf'?A.setOption(n,'wordcolor',c):A.setColor(n,c,false)}/>
          <NumField label="Font size" value={n.fontSize} placeholder={String(s.fontSize)} min={1} onCommit={v=>A.setOption(n,n.kind==='leaf'?'wordsize':'size',v)}/>
        </Section>
        {n.kind!=='leaf'&&<Section title="Branch"><ColorPicker value={n.branchColor} onPick={c=>A.setColor(n,c,true)}/><NumField label="Spread daughters" value={n.spread} placeholder="0" onCommit={v=>A.setOption(n,'spread',v)}/></Section>}
        {n.sem&&<Section title="Meaning colour"><ColorPicker value={n.semColor} onPick={c=>A.setOption(n,'sem',c)}/></Section>}
      </>}
      {n&&sel?.kind==='edge'&&<Section title="Tree line">
        <ColorPicker value={n.edgeColor} onPick={c=>A.setOption(n,'edge',c)}/>
        <NumField label="Line width" value={n.edgeWidth} placeholder={String(s.lineWidth)} min={0} step={.1} onCommit={v=>A.setOption(n,'width',v)}/>
        <Pattern value={n.edgeLine??s.linePattern} onChange={v=>A.setOption(n,'edgeline',v)}/>
        <NumField label="Extra length" value={n.edgeLen} placeholder="0" onCommit={v=>A.setOption(n,'len',v)}/>
      </Section>}
      {arrow&&<Section title="Arrow">
        <ColorPicker value={arrow.color} onPick={c=>A.updateArrow(arrow,{color:c??undefined})}/>
        <NumField label="Line width" value={arrow.width} placeholder={String(s.arrowWidth)} min={0} step={.1} onCommit={v=>A.updateArrow(arrow,{width:v===null?undefined:+v})}/>
        <Pattern value={arrow.lineOwn||arrow.line!=='solid'?arrow.line:s.arrowPattern} onChange={line=>A.updateArrow(arrow,{line,lineOwn:true})}/>
        <label class="insp-field"><span>Arrowheads</span><select aria-label="Arrowheads" value={arrow.head} onChange={e=>A.updateArrow(arrow,{head:e.currentTarget.value as typeof arrow.head})}><option value="end">At target →</option><option value="start">At source ←</option><option value="both">Both ↔</option><option value="none">None</option></select></label>
      </Section>}

    </div>}
  </div>;
}
