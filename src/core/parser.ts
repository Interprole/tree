import type { AArrow, ADoc, ALeaf, ANode, APosStyle, ARef, ArrowHead, LabelSide, ParseError, ParseResult, Span } from './ast';

/**
 * Bracket-notation parser.
 *
 *   [Label#id*@color  text | gloss  {feat, feat}  [child ...]  #ref ]
 *   #a -> #b dashed "label"         (movement arrow, outside the tree)
 *   % comment
 */

class Fail extends Error {
  constructor(public err: ParseError) {
    super(err.message);
  }
}

const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';
const ID_RE = /[\p{L}\p{N}_\-.:]/u;
const NODE_OPTS = new Set(['edge', 'width', 'edgeline', 'len', 'spread', 'size', 'wordsize', 'wordcolor', 'outline', 'wordoutline', 'wordedge', 'wordwidth', 'wordlen', 'wordline', 'sem', 'color', 'branch', 'link', 'to', 'spell', 'spellside', 'spellfail']);
const LABEL_RE = /^(left|right|above|below)?"((?:[^"\\]|\\.)*)"(?:@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?/;

/** side"text"@dx,dy at the start of s */
export function matchLabel(s: string): { side: LabelSide; text: string; off?: [number, number]; length: number } | null {
  const m = LABEL_RE.exec(s);
  if (!m) return null;
  return { side: (m[1] as LabelSide) ?? 'auto', text: m[2].replace(/\\(.)/g, '$1'), off: m[3] !== undefined ? [Number(m[3]), Number(m[4])] : undefined, length: m[0].length };
}

export function lineCol(src: string, pos: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') {
      line++;
      col = 1;
    } else col++;
  }
  return { line, col };
}

class Parser {
  i = 0;
  ids = new Map<string, ANode>();
  refs: ARef[] = [];
  constructor(public src: string) {}

  fail(message: string, from: number, to = from + 1, related?: Span): never {
    throw new Fail({ message, from, to: Math.min(Math.max(to, from), this.src.length), related });
  }

  peek(o = 0) {
    return this.src[this.i + o];
  }

  /** skip whitespace and % comments */
  skipWs() {
    for (;;) {
      const c = this.peek();
      if (isWs(c)) this.i++;
      else if (c === '%') {
        while (this.i < this.src.length && this.peek() !== '\n') this.i++;
      } else break;
    }
  }

  /** Skip over a balanced {...} group starting at this.i (which must be "{"). */
  skipGroup() {
    const open = this.i;
    let depth = 0;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (c === '\\') {
        this.i += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          this.i++;
          return;
        }
      }
      this.i++;
    }
    this.fail('Unclosed "{"', open, open + 1);
  }

  skipQuote() {
    const open = this.i;
    this.i++;
    while (this.i < this.src.length && this.peek() !== '"') {
      if (this.peek() === '\\') this.i++;
      this.i++;
    }
    if (this.i >= this.src.length) this.fail('Unclosed quotation mark', open, open + 1);
    this.i++;
  }

  /**
   * Read inline text until one of the stop characters (outside quotes, escapes and script groups).
   * Returns the raw source slice trimmed, with its span.
   */
  readText(stops: string, stopAtHashWord: boolean): { text: string; span: Span } | null {
    const start = this.i;
    let lastNonWs = -1;
    let firstNonWs = -1;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (c === '\\') {
        if (firstNonWs < 0) firstNonWs = this.i;
        this.i += 2;
        // macro name
        while (this.i < this.src.length && /[A-Za-z]/.test(this.src[this.i - 1]) && /[A-Za-z]/.test(this.peek())) this.i++;
        lastNonWs = this.i - 1;
        continue;
      }
      if (c === '"') {
        if (firstNonWs < 0) firstNonWs = this.i;
        this.skipQuote();
        lastNonWs = this.i - 1;
        continue;
      }
      if ((c === '_' || c === '^') && this.peek(1) === '{') {
        if (firstNonWs < 0) firstNonWs = this.i;
        this.i++;
        this.skipGroup();
        lastNonWs = this.i - 1;
        continue;
      }
      if (c === '%') break;
      if (stops.includes(c)) break;
      if (stopAtHashWord && c === '#' && (this.i === start || isWs(this.src[this.i - 1]))) break;
      if (!isWs(c)) {
        if (firstNonWs < 0) firstNonWs = this.i;
        lastNonWs = this.i;
      }
      this.i++;
    }
    if (firstNonWs < 0) return null;
    const raw = this.src.slice(firstNonWs, lastNonWs + 1);
    return { text: raw.replace(/[ \t\r\n]+/g, ' '), span: { from: firstNonWs, to: lastNonWs + 1 } };
  }

  /** Parse the header token after "[" into label + modifiers. */
  parseHeader(node: ANode) {
    const tokStart = this.i;
    // read token: stops at whitespace, [ ] { (non-script) |
    let labelEnd = -1;
    while (this.i < this.src.length) {
      const c = this.peek();
      if (isWs(c) || c === '[' || c === ']' || c === '|' || c === '%' || c === '$') break;
      if (c === '{') {
        const prev = this.src[this.i - 1];
        if ((prev === '_' || prev === '^') && this.i - 1 >= tokStart) {
          this.skipGroup();
          continue;
        }
        break;
      }
      if (c === '\\') {
        this.i += 2;
        while (this.i < this.src.length && /[A-Za-z]/.test(this.src[this.i - 1]) && /[A-Za-z]/.test(this.peek())) this.i++;
        continue;
      }
      if (c === '"') {
        this.skipQuote();
        continue;
      }
      if ((c === '#' || c === ';' || c === '@') && labelEnd < 0) {
        labelEnd = this.i;
      }
      this.i++;
    }
    const tokEnd = this.i;
    if (labelEnd < 0) labelEnd = tokEnd;
    let labelStart = tokStart;
    // qtree compatibility: [.DP ...]
    if (this.src[labelStart] === '.' && labelEnd - labelStart > 1) labelStart++;
    node.label = this.src.slice(labelStart, labelEnd);
    node.labelSpan = { from: labelStart, to: labelEnd };
    node.headerSpan = { from: tokStart, to: tokEnd };
    // modifiers
    let j = labelEnd;
    while (j < tokEnd) {
      const c = this.src[j];
      if (c === ';') {
        const spell = /^;([a-z]+)="((?:[^"\\]|\\.)*)"/.exec(this.src.slice(j, tokEnd));
        if (spell) {
          if (!NODE_OPTS.has(spell[1])) this.fail('Unknown node option ' + spell[1], j, j + spell[0].length);
          const value=spell[2].replace(/\\(["\\])/g, '$1');
          if(spell[1]==='color')node.color=value;
          else if(spell[1]==='branch')node.branchColor=value;
          else (node.opts ??= {})[spell[1]]=value;
          j += spell[0].length;
          continue;
        }
        const m = /^;([a-z]+)=(#?[^;\s[\]@#]+)/.exec(this.src.slice(j, tokEnd));
        if (!m || !NODE_OPTS.has(m[1])) this.fail(`Node options include ;spell="word" ;size=20 ;outline="s1 oval branch" ;edge=red ;width=2 ;edgeline=dashed ;len=20 ;spread=10 ;sem=blue`, j, Math.min(tokEnd, j + (m ? m[0].length : 1)));
        if (m![1] === 'color') node.color = m![2];
        else if (m![1] === 'branch') node.branchColor = m![2];
        else (node.opts ??= {})[m![1]] = m![2];
        j += m![0].length;
      } else if (c === '#') {
        let k = j + 1;
        while (k < tokEnd && ID_RE.test(this.src[k])) k++;
        const id = this.src.slice(j + 1, k);
        if (!id) this.fail('Expected an id after "#", e.g. [DP#1 ...]', j, j + 1);
        if (this.ids.has(id)) {
          const prev = this.ids.get(id)!;
          this.fail(`Duplicate id "#${id}" (already used by [${prev.label || '…'}])`, j, k, prev.headerSpan);
        }
        node.id = id;
        this.ids.set(id, node);
        if (this.src[k] === '!' || this.src[k] === '?') {
          node.pronounce = this.src[k] === '!';
          k++;
        }
        j = k;
      } else if (c === '@') {
        const branch = this.src[j + 1] === '@';
        let k = j + (branch ? 2 : 1);
        const cs = k;
        if (this.src[k] === '#') k++;
        while (k < tokEnd && /[A-Za-z0-9]/.test(this.src[k])) k++;
        const color = this.src.slice(cs, k);
        if (!color || color === '#') this.fail('Expected a colour after "@", e.g. @red or @#c03', j, k + 1);
        if (branch) node.branchColor = color;
        else node.color = color;
        j = k;
      } else {
        this.fail(`Unexpected "${c}" in node header. Escape it as \\${c} to use it in a label.`, j, j + 1);
      }
    }
  }

  parseNode(): ANode {
    const open = this.i;
    this.i++; // [
    const node: ANode = {
      kind: 'node',
      label: '',
      labelSpan: { from: this.i, to: this.i },
      headerSpan: { from: this.i, to: this.i },
      children: [],
      span: { from: open, to: open },
    };
    // header: first token unless the node starts with a child/terminator
    while (this.peek() === ' ' || this.peek() === '\t') this.i++;
    const c = this.peek();
    if (c === undefined) this.fail('Missing "]" to close this bracket', open, open + 1);
    const triangleFirst = c === '^' && (isWs(this.peek(1)) || this.peek(1) === '[' || this.peek(1) === ']');
    if (c !== '[' && c !== ']' && c !== '{' && c !== '|' && c !== '\n' && c !== '\r' && c !== '%' && c !== '$' && !triangleFirst) {
      this.parseHeader(node);
    } else {
      node.labelSpan = { from: open + 1, to: open + 1 };
      node.headerSpan = { from: open + 1, to: open + 1 };
    }
    for (;;) {
      this.skipWs();
      const ch = this.peek();
      if (ch === undefined) {
        this.fail(`Missing "]" to close [${node.label || ''}`, open, open + 1);
      }
      if (ch === ']') {
        this.i++;
        node.span = { from: open, to: this.i };
        return node;
      }
      if (ch === '[') {
        node.children.push(this.parseNode());
        continue;
      }
      if (ch === '{') {
        const fs = this.i;
        this.skipGroup();
        const inner = this.src.slice(fs + 1, this.i - 1);
        node.features = splitTopLevel(inner, ',').map((s) => s.trim()).filter(Boolean);
        node.featureSpan = { from: fs, to: this.i };
        continue;
      }
      if (ch === '|') {
        this.i++;
        const g = this.readText('[]|{$&', false);
        const text = g ? g.text : '';
        const last = node.children[node.children.length - 1];
        if (last && last.kind === 'leaf') {
          last.gloss.push(text);
          last.fullSpan.to = g ? g.span.to : this.i;
        } else {
          (node.gloss ??= []).push(text);
        }
        continue;
      }
      if (ch === '#') {
        const s = this.i;
        let k = s + 1;
        while (k < this.src.length && ID_RE.test(this.src[k])) k++;
        const id = this.src.slice(s + 1, k);
        if (!id) this.fail('Expected an id after "#" (a reference to a shared node, e.g. #1)', s, s + 1);
        let pronounce: boolean | undefined;
        let text: string | undefined;
        let sem: string | undefined;
        let triangle: boolean | undefined;
        let color: string | undefined;
        // modifiers of this position, in any order: ! ? ^ @colour "words" $meaning$
        for (;;) {
          const m = this.src[k];
          if ((m === '!' || m === '?') && pronounce === undefined) {
            pronounce = m === '!';
            k++;
          } else if (m === '^' && !triangle) {
            triangle = true;
            k++;
          } else if (m === '@' && color === undefined && /[#A-Za-z0-9]/.test(this.src[k + 1] ?? '')) {
            let e = k + 1;
            if (this.src[e] === '#') e++;
            while (e < this.src.length && /[A-Za-z0-9]/.test(this.src[e])) e++;
            color = this.src.slice(k + 1, e);
            k = e;
          } else if (m === '"' && text === undefined) {
            const q = this.src.indexOf('"', k + 1);
            if (q < 0) this.fail('Unclosed quotation mark', k, k + 1);
            text = this.src.slice(k + 1, q);
            k = q + 1;
          } else if (m === '$' && sem === undefined) {
            const q = this.src.indexOf('$', k + 1);
            if (q < 0) this.fail('Unclosed "$"', k, k + 1);
            sem = this.src.slice(k + 1, q).trim();
            k = q + 1;
          } else break;
        }
        const ref: ARef = { kind: 'ref', id, span: { from: s, to: k } };
        if (pronounce !== undefined) ref.pronounce = pronounce;
        if (text !== undefined) ref.text = text;
        if (sem !== undefined) ref.sem = sem;
        if (triangle) ref.triangle = true;
        if (color) ref.color = color;
        this.refs.push(ref);
        node.children.push(ref);
        this.i = k;
        continue;
      }
      if (ch === '&') {
        const lab = matchLabel(this.src.slice(this.i + 1));
        if (!lab) this.fail('A note looks like &"text", &right"text" or &left"text"@10,-5', this.i, this.i + 1);
        (node.notes ??= []).push({ text: lab!.text, side: lab!.side, off: lab!.off, span: { from: this.i, to: this.i + 1 + lab!.length } });
        this.i += 1 + lab!.length;
        continue;
      }
      if (ch === '$') {
        const st = this.i;
        let k = st + 1;
        while (k < this.src.length && this.src[k] !== '$') {
          if (this.src[k] === '\\') k++;
          k++;
        }
        if (k >= this.src.length) this.fail('Unclosed "$": a meaning is written as $λx. cat(x) : <e,t>$', st, st + 1);
        node.sem = this.src.slice(st + 1, k).trim();
        node.semSpan = { from: st, to: k + 1 };
        this.i = k + 1;
        continue;
      }
      if (ch === '^' && this.peek(1) !== '{') {
        node.triangle = true;
        node.triangleSpan = { from: this.i, to: this.i + 1 };
        this.i++;
        continue;
      }
      const t = this.readText('[]|{$&', true);
      if (!t) {
        this.fail(`Unexpected "${ch}"`, this.i, this.i + 1);
      }
      const leaf: ALeaf = { kind: 'leaf', text: t.text, span: t.span, gloss: [], fullSpan: { ...t.span } };
      // merge with directly preceding leaf (separated only by a comment)
      node.children.push(leaf);
    }
  }

  /** #wh/2: ^ @red edge=blue width=2 len=10 {uφ, EPP} &"focus" $x : e$ "words" ! ? */
  parsePosStyle(): APosStyle {
    const start = this.i;
    let end = this.src.indexOf('\n', start);
    if (end < 0) end = this.src.length;
    const m = /^#([\p{L}\p{N}_\-.:]+?)\/(\d+)\s*:/u.exec(this.src.slice(start, end));
    if (!m) this.fail('A position style looks like  #wh/2: ^ @red', start, end);
    const style: APosStyle = { id: m![1], occ: Number(m![2]), mods: {}, span: { from: start, to: end } };
    const mods = style.mods;
    let k = start + m![0].length;
    for (;;) {
      while (k < end && (this.src[k] === ' ' || this.src[k] === '\t')) k++;
      if (k >= end || this.src[k] === '%') break;
      const c = this.src[k];
      const rest = this.src.slice(k, end);
      let mm: RegExpExecArray | null;
      if (c === '^') {
        mods.triangle = true;
        k++;
      } else if (rest.startsWith('open') && !/[\w]/.test(rest[4] ?? '')) {
        // no triangle on this copy, although the constituent has one
        mods.triangle = false;
        k += 4;
      } else if (c === '!' || c === '?') {
        mods.pronounce = c === '!';
        k++;
      } else if ((mm = /^@(#?[A-Za-z0-9]+)/.exec(rest))) {
        mods.color = mm[1];
        k += mm[0].length;
      } else if ((mm = /^(outline|wordoutline)="((?:[^"\\]|\\.)*)"/.exec(rest))) {
        mods[mm[1] as 'outline'] = mm[2].replace(/\\(["\\])/g, '$1');
        k += mm[0].length;
      } else if ((mm = /^(edge|width|len|edgeline|size|wordsize|wordcolor|wordedge|wordwidth|wordlen|wordline)=(#?[^\s%]+)/.exec(rest))) {
        mods[mm[1] as 'edge' | 'width' | 'len'] = mm[2];
        k += mm[0].length;
      } else if (c === '{') {
        this.i = k;
        this.skipGroup();
        mods.features = splitTopLevel(this.src.slice(k + 1, this.i - 1), ',').map((x) => x.trim()).filter(Boolean);
        k = this.i;
      } else if (c === '&') {
        const lab = matchLabel(this.src.slice(k + 1, end));
        if (!lab) this.fail('A note looks like &"text"', k, k + 1);
        (mods.notes ??= []).push({ text: lab!.text, side: lab!.side, off: lab!.off, span: { from: k, to: k + 1 + lab!.length } });
        k += 1 + lab!.length;
      } else if (c === '$') {
        const q = this.src.indexOf('$', k + 1);
        if (q < 0 || q > end) this.fail('Unclosed "$"', k, k + 1);
        mods.sem = this.src.slice(k + 1, q).trim();
        k = q + 1;
      } else if (c === '"') {
        const q = this.src.indexOf('"', k + 1);
        if (q < 0 || q > end) this.fail('Unclosed quotation mark', k, k + 1);
        mods.text = this.src.slice(k + 1, q);
        k = q + 1;
      } else {
        let e = k;
        while (e < end && !/\s/.test(this.src[e])) e++;
        this.fail(`Unknown position option "${this.src.slice(k, e)}". Use ^, open, @colour (@none), edge=, width=, len=, {features}, &"note", $meaning$, "words", ! or ?`, k, e);
      }
    }
    style.span.to = Math.min(end, k);
    while (style.span.to > start && /\s/.test(this.src[style.span.to - 1])) style.span.to--;
    this.i = end;
    return style;
  }

  parseArrow(): AArrow {
    const start = this.i;
    // statement runs to end of line
    let end = this.src.indexOf('\n', start);
    if (end < 0) end = this.src.length;
    // strip comment
    let lineEnd = end;
    for (let k = start; k < end; k++) {
      if (this.src[k] === '\\') {
        k++;
        continue;
      }
      if (this.src[k] === '"') {
        const q = this.src.indexOf('"', k + 1);
        if (q < 0 || q > end) break;
        k = q;
        continue;
      }
      if (this.src[k] === '%') {
        lineEnd = k;
        break;
      }
    }
    const line = this.src.slice(start, lineEnd);
    const m = /^#([\p{L}\p{N}_\-.:]+)(?:\/(\d+))?\s*(<->|<-|->|--|<=>|=>|<=)\s*#([\p{L}\p{N}_\-.:]+)(?:\/(\d+))?/u.exec(line);
    if (!m) {
      this.fail('Arrow lines look like:  #a -> #b  (optionally followed by dashed, curve, "label", @red)', start, lineEnd);
    }
    const op = m[3];
    const head: ArrowHead = op === '<->' || op === '<=>' ? 'both' : op === '<-' || op === '<=' ? 'start' : op === '--' ? 'none' : 'end';
    const arrow: AArrow = {
      from: m[1],
      to: m[4],
      head,
      line: 'solid',
      route: 'under',
      labels: [],
      span: { from: start, to: start + line.trimEnd().length },
    };
    if (m[2]) arrow.fromOcc = Number(m[2]);
    if (m[5]) arrow.toOcc = Number(m[5]);
    const rest = line.slice(m[0].length);
    const off = start + m[0].length;
    const tokRe = /\s*((?:left|right|above|below)?"(?:[^"\\]|\\.)*"(?:@-?[\d.]+,-?[\d.]+)?|\S+)/gy;
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(rest))) {
      const tok = t[1];
      const tokFrom = off + t.index + t[0].length - tok.length;
      const lab = matchLabel(tok);
      if (lab && lab.length === tok.length) arrow.labels.push({ text: lab.text, side: lab.side, off: lab.off, span: { from: tokFrom, to: tokFrom + tok.length } });
      else if (tok === 'dashed' || tok === 'dotted' || tok === 'solid') { arrow.line = tok; arrow.lineOwn = true; }
      else if (/^width=\d+(?:\.\d+)?$/.test(tok)) arrow.width = Number(tok.slice(6));
      else if (tok === 'under' || tok === 'curve') arrow.route = tok;
      else if (tok === 'hide') arrow.hidden = true;
      else if (tok === 'visible') arrow.visible = true;
      else if (tok === 'plain') arrow.plain = true;
      else if (/^(out|in)=(below|above|left|right)$/.test(tok)) {
        const [k, v] = tok.split('=') as ['out' | 'in', 'below'];
        if (k === 'out') arrow.outSide = v;
        else arrow.inSide = v;
      } else if (/^(from|to)=(node|word)$/.test(tok)) {
        const [k, v] = tok.split('=') as ['from' | 'to', 'node' | 'word'];
        if (k === 'from') arrow.fromAt = v;
        else arrow.toAt = v;
      }
      else if (tok.startsWith('via=')) {
        const pts = tok
          .slice(4)
          .split(';')
          .filter(Boolean)
          .map((p) => p.split(',').map(Number));
        if (!pts.length || pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) this.fail('via= expects points, e.g. via=0,40;30,60', tokFrom, tokFrom + tok.length);
        arrow.via = pts as [number, number][];
      }
      else if (tok.startsWith('@') && tok.length > 1) arrow.color = tok.slice(1);
      else if (tok.startsWith('bend=')) {
        const nums = tok.slice(5).split(',').map(Number);
        if (nums.some((n) => !Number.isFinite(n))) this.fail('bend= expects numbers, e.g. bend=0,20', tokFrom, tokFrom + tok.length);
        arrow.bend = [nums.length > 1 ? nums[0] : 0, nums.length > 1 ? nums[1] : nums[0]];
      } else this.fail(`Unknown arrow option "${tok}". Use solid, dashed, dotted, width=2, plain, hide, visible, out=below|above|left|right, in=…, from=node, to=node, "label", @colour, bend=x,y or via=x,y;x,y`, tokFrom, tokFrom + tok.length);
    }
    this.i = lineEnd;
    return arrow;
  }

  parseDoc(): ADoc {
    let root: ANode | null = null;
    const arrows: AArrow[] = [];
    const posStyles: APosStyle[] = [];
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === undefined) break;
      if (c === '[') {
        if (root) {
          this.fail('Only one tree per document: wrap several trees in a common root, e.g. [ [A …] [B …] ]', this.i, this.i + 1);
        }
        root = this.parseNode();
      } else if (c === ']') {
        this.fail('Unexpected "]": there is no open bracket to close', this.i, this.i + 1);
      } else if (c === '#') {
        const line = this.src.slice(this.i, (this.src.indexOf('\n', this.i) + 1 || this.src.length + 1) - 1);
        if (/^#[\p{L}\p{N}_\-.:]+?\/\d+\s*:/u.test(line)) posStyles.push(this.parsePosStyle());
        else arrows.push(this.parseArrow());
      } else {
        const s = this.i;
        let e = s;
        while (e < this.src.length && !isWs(this.src[e]) && this.src[e] !== '[') e++;
        this.fail(root ? 'Text after the tree. Only arrow lines (#a -> #b) may follow the tree.' : 'The tree must start with "["', s, e);
      }
    }
    // resolve refs
    for (const r of this.refs) {
      if (!this.ids.has(r.id)) this.fail(`No node with id "#${r.id}". Define it with [Label#${r.id} …]`, r.span.from, r.span.to);
    }
    for (const a of arrows) {
      for (const id of [a.from, a.to]) {
        if (!this.ids.has(id)) {
          const k = this.src.indexOf('#' + id, a.span.from);
          this.fail(`Arrow refers to unknown id "#${id}"`, k, k + id.length + 1);
        }
      }
    }
    // head movement written on the moved head: [V#v;to=t …]
    if (root) {
      walkAst(root, (n) => {
        const to = n.opts?.to;
        if (to && !this.ids.has(to)) {
          const k = this.src.indexOf(';to=' + to, n.headerSpan.from);
          this.fail(`Head movement to unknown id "#${to}"`, k, k + 4 + to.length);
        }
      });
    }
    for (const p of posStyles) {
      if (!this.ids.has(p.id)) this.fail(`No node with id "#${p.id}"`, p.span.from, p.span.from + p.id.length + 1);
    }
    if (root) this.checkCycles(root);
    return { root, arrows, posStyles, ids: this.ids };
  }

  checkCycles(root: ANode) {
    const visiting = new Set<ANode>();
    const done = new Set<ANode>();
    const visit = (n: ANode) => {
      if (done.has(n)) return;
      visiting.add(n);
      for (const ch of n.children) {
        let target: ANode | null = null;
        if (ch.kind === 'node') target = ch;
        else if (ch.kind === 'ref') {
          target = this.ids.get(ch.id)!;
          if (visiting.has(target)) {
            this.fail(`#${ch.id} refers to a node that contains this reference (a node cannot dominate itself)`, ch.span.from, ch.span.to);
          }
        }
        if (target) visit(target);
      }
      visiting.delete(n);
      done.add(n);
    };
    visit(root);
  }
}

/** Split a string on a separator at brace depth 0, respecting escapes and quotes. */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      cur += c + s[i + 1];
      i++;
      continue;
    }
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      const k = j < 0 ? s.length : j + 1;
      cur += s.slice(i, k);
      i = k - 1;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parse(src: string): ParseResult {
  const p = new Parser(src);
  try {
    return { ok: true, doc: p.parseDoc() };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.err };
    throw e;
  }
}

/** Walk all source nodes (each node once, refs not followed). */
export function walkAst(node: ANode, fn: (n: ANode, parent: ANode | null) => void, parent: ANode | null = null) {
  fn(node, parent);
  for (const c of node.children) if (c.kind === 'node') walkAst(c, fn, node);
}
