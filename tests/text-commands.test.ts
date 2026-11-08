import { describe, expect, test } from 'vitest';
import { parse } from '../src/core/parser';
import { parseRich, plain } from '../src/core/richtext';
import { approxMeasure, runsWidth } from '../src/core/measure';
import { buildScene, runsPieces } from '../src/core/scene';
import { runsToMarkup, serialize } from '../src/core/serialize';
import { defaultStyle } from '../src/core/style';
import { exportLatex } from '../src/core/latex';
import { tree } from './helpers';
import { applyChanges, escapeLabel, escapeText, renameNode } from '../src/core/edits';

describe('LaTeX text commands',()=>{
  test('visual label and expression edits preserve complete commands and escape ordinary punctuation',()=>{
    const value=String.raw`\textbf{Long label} literal [x]`;
    expect(escapeLabel(value)).toBe(String.raw`\textbf{Long label}~literal~\[x\]`);
    expect(escapeText(value)).toBe(String.raw`\textbf{Long label} literal \[x\]`);
    const p=parse('[N word]');if(!p.ok)throw new Error('fixture');
    const next=applyChanges('[N word]',renameNode('[N word]',p.doc.root!,String.raw`\textit{New label}`).changes);
    expect(plain(tree(next).root.label)).toBe('New label');
    expect(tree(next).root.label[0].italic).toBe(true);
  });
  test('nested font commands keep their scope and reset normal text',()=>{
    const runs=parseRich(String.raw`a \textbf{bold \textit{both} bold} z \textsc{nom} \textnormal{plain}`);
    expect(plain(runs)).toBe('a bold both bold z nom plain');
    expect(runs.find(r=>r.text==='both')).toMatchObject({italic:true,bold:true});
    expect(runs.find(r=>r.text==='nom')).toMatchObject({sc:true});
    expect(runs.find(r=>r.text==='plain')).toMatchObject({italic:false,bold:false});
    expect(runs[0].bold).toBeUndefined();
  });
  test('braced commands are text in labels and expressions, not feature blocks',()=>{
    const input=String.raw`[\textbf{Long label}#n{u\phi} \textit{two \textsc{words}} | \textsc{nom.sg}]`;
    const p=parse(input);expect(p.ok).toBe(true);if(!p.ok)return;
    expect(p.doc.root).toMatchObject({label:String.raw`\textbf{Long label}`,id:'n',features:[String.raw`u\phi`]});
    const t=tree(input);expect(plain(t.root.label)).toBe('Long label');
    expect(plain(t.root.children[0].label)).toBe('two words');
    expect(t.root.children[0].gloss?.[0]).toEqual([{text:'nom.sg',sc:true}]);
    expect(parse(String.raw`[N \textit{unclosed]`).ok).toBe(false);
  });
  test('commands handle escaped braces and structural characters inside their groups',()=>{
    const t=tree(String.raw`[N \textbf{a \{b\} [c] #d \%}]`);
    expect(plain(t.root.children[0].label)).toBe('a {b} [c] #d %');
    expect(parseRich(String.raw`"\textbf{literal}"`)).toEqual([{text:String.raw`\textbf{literal}`}]);
  });
  test('explicit italic/upright override the default expression font and measure the same way',()=>{
    const runs=parseRich(String.raw`\textit{italic}\textup{upright}`);
    for(const baseItalic of [false,true]) {
      const drawn=runsPieces(runs,0,20,17,baseItalic,false,approxMeasure,'cmu');
      expect(drawn.pieces.map(p=>p.italic)).toEqual([true,false]);
      expect(drawn.width).toBe(runsWidth(runs,{font:'cmu',size:17,italic:baseItalic},approxMeasure));
    }
    const t=tree(String.raw`[XP;spell="\\textup{word}" [X]]`);
    const scene=buildScene(t,defaultStyle,approxMeasure);
    expect(scene.prims.filter(p=>p.t==='text'&&p.role==='spellout').flatMap(p=>p.t==='text'?p.pieces:[]).find(p=>p.text==='word')?.italic).toBe(false);
    const emph=tree(String.raw`[N \emph{word}]`),emphScene=buildScene(emph,defaultStyle,approxMeasure);
    expect(exportLatex(emph,emphScene,defaultStyle,{format:'forest',standalone:false})).toContain('\\textup{word}');
  });
  test('popular decorations, subscripts and superscripts preserve styling through serialization',()=>{
    const input=String.raw`\underline{under} \overline{bar} \sout{strike} \textsubscript{\textbf{i}} \textsuperscript{2} \emph{emph}`;
    const runs=parseRich(input),roundtrip=parseRich(runsToMarkup(runs,false));
    expect(roundtrip).toEqual(runs);
    expect(runs.find(r=>r.text==='i')).toMatchObject({sub:true,bold:true});
    const t=tree(String.raw`[\textbf{N} \underline{\textit{word}}]`);
    expect(tree(serialize(t)).root.label).toEqual(t.root.label);
    const sc=buildScene(t,defaultStyle,approxMeasure);
    expect(sc.prims.some(p=>p.t==='path'&&p.role==='deco')).toBe(true);
    for(const format of ['forest','qtree','tikz'] as const) {
      const tex=exportLatex(t,sc,defaultStyle,{format,standalone:true});
      expect(tex).not.toContain('textbackslash{}textit');
      if(format!=='tikz') {expect(tex).toContain('\\underline{');expect(tex).toContain('\\textit{');}
    }
  });
});
