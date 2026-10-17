import type { ADoc, ALeaf, ANode, APosStyle } from './ast';
import { analyseLabel, applyXbar } from './modes';
import type { XbarOptions } from './modes';
import { collectNodes, relink } from './model';
import type { DArrow, DNode, DSem, DTree } from './model';
import { baseText, cloneRuns, indicesOf, parseRich, plain } from './richtext';
import type { Runs } from './richtext';
import { abstractOver, compose, parseMeaning, SemError, showRuns, showTy, splitMeaning, toSource } from './semantics';
import type { Meaning } from './semantics';

export type LabelMode = 'manual' | 'xbar';
/** how a movement chain (one node with several #positions) is drawn */
export type ChainView = 'multidominance' | 'copies' | 'traces';

export interface SemanticsOptions {
  /** show meanings ($…$) under nodes */
  show: boolean;
  /** compute missing meanings bottom-up (FA, PC, EI, FC) */
  compute: boolean;
  /** show types and typed variables */
  types: boolean;
  /** show the composition rule (FA, PC, EI, FC, PA) */
  rules: boolean;
}

export interface BuildOptions {
  mode: LabelMode;
  xbar: XbarOptions;
  chains: ChainView;
  /** arrows between the positions of a chain (copies / traces) */
  chainArrows: boolean;
  /** movement indices on the positions of a chain */
  chainIndices: boolean;
  /** draw the arrows of head movement (without them, V+v and the struck source still show it) */
  headArrows: boolean;
  /** show null heads/specifiers (∅) */
  showEmpty: boolean;
  semantics: SemanticsOptions;
}

export const defaultBuildOptions: BuildOptions = {
  mode: 'manual',
  xbar: { bar: 'always', headLabel: 'X', emptySpecs: false, barStyle: 'prime', expandWords: true },
  chains: 'copies',
  chainArrows: true,
  chainIndices: false,
  headArrows: true,
  showEmpty: true,
  semantics: { show: true, compute: true, types: false, rules: true },
};

const EMPTY_WORDS = new Set(['∅', 'Ø', 'ø', 'e', '0']);

function isCopyText(runs: Runs): boolean {
  const b = baseText(runs).trim();
  return b.length >= 2 && b.startsWith('<') && b.endsWith('>');
}

function stripAngles(runs: Runs): Runs {
  const out = runs.map((r) => ({ ...r }));
  const first = out.find((r) => !r.sub && !r.sup);
  const last = [...out].reverse().find((r) => !r.sub && !r.sup);
  if (first) first.text = first.text.replace(/^\s*</, '');
  if (last) last.text = last.text.replace(/>\s*$/, '');
  return out.filter((r) => r.text !== '');
}

/** Words under a source node (through references), for triangles. */
function yieldOf(a: ANode, doc: ADoc, seen = new Set<ANode>()): string[] {
  if (seen.has(a)) return [];
  seen.add(a);
  const out: string[] = [];
  for (const c of a.children) {
    if (c.kind === 'leaf') out.push(c.text);
    else if (c.kind === 'node') out.push(...yieldOf(c, doc, seen));
    else {
      const t = doc.ids.get(c.id);
      if (t) out.push(...yieldOf(t, doc, seen));
    }
  }
  return out;
}

/** "formula : type" → display runs (as written) */
function formulaRuns(src: string): Runs {
  const [formula] = splitMeaning(src);
  const f = formula
    .replace(/\\lambda\b\s*/g, 'λ')
    .replace(/\b(lambda|iota|exists|forall)\s*(?=[\p{L}][\p{L}\p{N}′']*\s*[._:])/gu, (_, w: string) => ({ lambda: 'λ', iota: 'ι', exists: '∃', forall: '∀' })[w as 'lambda']!)
    .replace(/->/g, '→')
    .replace(/&/g, '∧')
    .replace(/\*/g, '×')
    // typed binders: λP_<e,t>. → λP with subscript ⟨e,t⟩
    .replace(/([λ∃∀ι]\s*[\p{L}][\p{L}\p{N}′']*)[_:]\s*([<⟨][^.]*[>⟩]|[a-z]\w*)(?=\s*\.)/gu, (_, v: string, ty: string) => `${v}_{${ty.replace(/</g, '⟨').replace(/>/g, '⟩')}}`);
  return parseRich(f);
}

/** Build the display tree from the AST. */
export function buildTree(doc: ADoc, opts: BuildOptions = defaultBuildOptions): DTree | null {
  if (!doc.root) return null;
  const byAst = new Map<ANode, DNode>();
  const meanings = new Map<DNode, Meaning>();
  /** pronunciation of each occurrence: source mother → shared node → flag */
  const occFlags = new Map<ANode, Map<DNode, OccInfo>>();
  const setOcc = (mother: ANode, child: DNode, info: OccInfo) => {
    if (!occFlags.has(mother)) occFlags.set(mother, new Map());
    occFlags.get(mother)!.set(child, info);
  };

  const mkLeaf = (l: ALeaf, key: string): DNode => {
    let label = parseRich(l.text);
    const d: DNode = { key, kind: 'leaf', label, children: [], parents: [], src: l, indices: indicesOf(label) };
    if (isCopyText(label)) {
      d.copy = true;
      label = stripAngles(label);
      d.label = label;
    }
    if (EMPTY_WORDS.has(baseText(label).trim())) d.empty = true;
    if (l.gloss.length) d.gloss = l.gloss.map((g) => parseRich(g, { smallCaps: true }));
    return d;
  };

  const mk = (a: ANode, key: string): DNode => {
    const existing = byAst.get(a);
    if (existing) return existing;
    let label = parseRich(a.label, { primes: true });
    const d: DNode = { key: a.id ? `#${a.id}` : key, kind: 'phrase', label, children: [], parents: [], src: a, indices: indicesOf(label) };
    byAst.set(a, d);
    if (a.id) d.id = a.id;
    if (a.triangle) d.triangle = true;
    const o = a.opts ?? {};
    if (o.edge) d.edgeColor = o.edge;
    if (o.width && Number.isFinite(Number(o.width))) d.edgeWidth = Number(o.width);
    if (o.len && Number.isFinite(Number(o.len))) d.edgeLen = Number(o.len);
    if (o.spread && Number.isFinite(Number(o.spread))) d.spread = Number(o.spread);
    if (o.sem) d.semColor = o.sem;
    if (o.to) d.headTo = o.to;
    if (a.notes) d.notes = a.notes.map((n, index) => ({ runs: parseRich(n.text), side: n.side, off: n.off, index }));
    if (a.color) d.color = a.color;
    if (a.branchColor) {
      d.branchColor = a.branchColor;
      if (!d.color) d.color = a.branchColor;
    }
    if (isCopyText(label)) {
      d.copy = true;
      label = stripAngles(label);
      d.label = label;
    }
    if (a.features) d.features = a.features.map((f) => parseRich(f));
    if (a.gloss) d.gloss = a.gloss.map((g) => parseRich(g, { smallCaps: true }));
    if (a.sem !== undefined) {
      try {
        const m = parseMeaning(a.sem);
        meanings.set(d, m);
        d.sem = { runs: formulaRuns(a.sem), type: showTy(m.ty) };
      } catch (e) {
        d.sem = { runs: formulaRuns(a.sem), error: (e as Error).message };
      }
    }
    a.children.forEach((c, i) => {
      if (c.kind === 'node') {
        const child = mk(c, `${key}.${i}`);
        d.children.push(child);
        if (c.id) setOcc(a, child, { flag: c.pronounce });
      } else if (c.kind === 'leaf') d.children.push(mkLeaf(c, `${key}.${i}`));
      else {
        const child = mk(doc.ids.get(c.id)!, `${key}.${i}`);
        d.children.push(child);
        setOcc(a, child, { flag: c.pronounce ?? (c.text !== undefined ? true : undefined), text: c.text, sem: c.sem, triangle: c.triangle, color: c.color });
      }
    });
    if (d.triangle) {
      const hasPhrase = d.children.some((c) => c.kind === 'phrase');
      const leaves = d.children.filter((c) => c.kind === 'leaf');
      d.untriangled = d.children;
      if (hasPhrase) {
        // a triangle over a structure: the structure stays in the code, the picture shows its words
        const words = yieldOf(a, doc).join(' ');
        d.children = [{ key: `${key}.tri`, kind: 'leaf', label: parseRich(words || '…'), children: [], parents: [], indices: [], synthetic: true }];
      } else if (leaves.length > 1) {
        const joined: DNode = { ...leaves[0], label: leaves.flatMap((l, i) => (i ? [{ text: ' ' }, ...l.label] : l.label)) };
        d.children = [joined];
      }
    }
    return d;
  };

  let root = mk(doc.root, 'n');
  relink(root);
  propagateStyles(root);

  if (!opts.showEmpty) root = removeEmpty(root);
  if (opts.mode === 'xbar') root = applyXbar(root, opts.xbar);
  relink(root);

  // ---- movement chains
  const chains = resolveChains(root, occFlags, opts, meanings, doc.posStyles);
  const nodes = relink(root);

  // ---- arrows
  const arrows: DArrow[] = [];
  const byId = new Map<string, DNode>();
  for (const n of nodes) if (n.id && !n.copyOf) byId.set(n.id, n);
  const resolve = (id: string, occ?: number): DNode | undefined => {
    const ch = chains.get(id);
    if (occ !== undefined && ch) return ch.instances[occ - 1];
    return byId.get(id) ?? ch?.instances[0];
  };
  /**
   * Movement is written in the tree: chains (#id … #id) and head movement (;to= on the moved head).
   * Their arrows are drawn when arrows for that kind of movement are on (or the arrow is marked
   * visible), unless marked hide; an arrow line between the same two places only restyles it.
   * Other arrow lines are just arrows (plain), or head movement written the older way.
   */
  const headMoves = nodes
    .filter((n) => n.headTo && !n.copyOf)
    .map((n) => ({ from: n, to: byId.get(n.headTo!)! }))
    .filter((m) => m.to && m.to !== m.from);
  const covered: [DNode, DNode][] = [];
  const isCovered = (x: DNode, y: DNode) => covered.some(([a, b]) => (a === x && b === y) || (a === y && b === x));
  const silentMoves: DArrow[] = [];
  const legacy = new Set<DArrow>();
  doc.arrows.forEach((a, index) => {
    const labels = a.labels.map((l, i) => ({ runs: parseRich(l.text), side: l.side, off: l.off, index: i }));
    const styled = (from: DNode, to: DNode, extra: Partial<DArrow> = {}): DArrow => ({ from, to, head: a.head, line: a.line, route: a.route, labels, color: a.color, bend: a.bend ?? [0, 0], via: a.via, plain: a.plain, fromAt: a.fromAt, toAt: a.toAt, src: a, index, ...extra });
    // a link of a chain
    if (a.from === a.to && a.fromOcc && a.toOcc && !a.plain) {
      if (opts.chains === 'multidominance') return;
      const from = resolve(a.from, a.fromOcc);
      const to = resolve(a.to, a.toOcc);
      if (!from || !to || from === to) return;
      covered.push([from, to]);
      if (!a.hidden && (opts.chainArrows || a.visible)) arrows.push(styled(from, to, { chain: { id: a.from, from: a.fromOcc, to: a.toOcc } }));
      return;
    }
    const from = resolve(a.from, a.fromOcc);
    const to = resolve(a.to, a.toOcc);
    if (!from || !to || from === to) return;
    // the arrow of a head movement written on the head
    const hm = !a.plain && headMoves.find((m) => m.from === from && m.to === to);
    if (hm) {
      covered.push([from, to]);
      if (!a.hidden && (opts.headArrows || a.visible)) arrows.push(styled(from, to, { headMove: { from: a.from, to: a.to } }));
      return;
    }
    if (a.hidden) {
      // an arrow written the older way: hidden, its head movement stays
      if (!a.plain) silentMoves.push(styled(from, to));
      covered.push([from, to]);
      return;
    }
    const d = styled(from, to);
    if (!a.plain) legacy.add(d);
    arrows.push(d);
  });
  if (opts.chains !== 'multidominance' && opts.chainArrows) {
    for (const [id, ch] of chains) {
      for (let k = 1; k < ch.instances.length; k++) {
        const from = ch.instances[k];
        const to = ch.instances[k - 1];
        if (isCovered(from, to)) continue;
        arrows.push({ from, to, head: 'end', line: 'solid', route: 'under', labels: [], bend: [0, 0], auto: true, chain: { id, from: k + 1, to: k } });
      }
    }
  }
  if (opts.headArrows) {
    for (const m of headMoves) {
      if (isCovered(m.from, m.to)) continue;
      arrows.push({ from: m.from, to: m.to, head: 'end', line: 'solid', route: 'under', labels: [], bend: [0, 0], auto: true, headMove: { from: m.from.id ?? m.from.key, to: m.to.id! } });
    }
  }

  const moves: DArrow[] = [...[...legacy], ...silentMoves, ...headMoves.map((m) => ({ from: m.from, to: m.to, head: 'end' as const, line: 'solid' as const, route: 'under' as const, labels: [], bend: [0, 0] as [number, number] }))];
  const moved = applyHeadMovement(moves);
  // older head-movement arrows follow the switch too (unless marked visible)
  if (!opts.headArrows) for (let i = arrows.length - 1; i >= 0; i--) if (moved.has(arrows[i]) && legacy.has(arrows[i]) && !arrows[i].src?.visible) arrows.splice(i, 1);
  if (opts.semantics.show) {
    computeSemantics(root, meanings, opts.semantics);
    for (const n of collectNodes(root)) {
      if (n.sem?.type && !opts.semantics.types) n.sem = { ...n.sem, type: undefined };
      if (n.sem?.rule && !opts.semantics.rules) n.sem = { ...n.sem, rule: undefined };
    }
  } else for (const n of collectNodes(root)) delete n.sem;
  return { root, arrows, nodes };
}

/* ------------------------------------------------------------ chains */

export interface Chain {
  /** occurrences, highest first */
  instances: DNode[];
  overt: boolean[];
  index?: string;
}

function depthMap(root: DNode): Map<DNode, number> {
  const depth = new Map<DNode, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const n = queue.shift()!;
    for (const c of n.children) {
      if (!depth.has(c)) {
        depth.set(c, depth.get(n)! + 1);
        queue.push(c);
      }
    }
  }
  return depth;
}

function nearestSrc(n: DNode): ANode | undefined {
  let cur: DNode | undefined = n;
  while (cur) {
    if (cur.src?.kind === 'node' && !cur.synthetic) return cur.src;
    cur = cur.parents[0];
  }
  return undefined;
}

function cloneSubtree(n: DNode, suffix: string): DNode {
  return {
    ...n,
    key: n.key + suffix,
    label: cloneRuns(n.label),
    children: n.children.map((ch) => cloneSubtree(ch, suffix)),
    untriangled: n.untriangled?.map((ch) => cloneSubtree(ch, suffix)),
    parents: [],
    copyOf: n.copyOf ?? n.key,
    id: undefined,
  };
}

function markCopy(n: DNode) {
  n.copy = true;
  delete n.sem;
  n.children.forEach(markCopy);
}

/** notes of one position are numbered from here (the shared notes of the constituent come first) */
export const POS_NOTE = 1000;

const INDEX_LETTERS = 'ijklmnopqrsuvwxyzabcdfgh'.split('');

/**
 * Turn shared nodes (#id) into the chosen chain view. In the copies and traces views every
 * position gets its own copy; only pronounced positions (the highest one by default, or those
 * marked #id!) are drawn normally.
 */
interface OccInfo {
  /** true = pronounced, false = silent, undefined = default */
  flag?: boolean;
  /** pronounced with other words */
  text?: string;
  /** meaning of this position */
  sem?: string;
  /** this position only as a triangle / in a colour */
  triangle?: boolean;
  color?: string;
}

function resolveChains(root: DNode, occFlags: Map<ANode, Map<DNode, OccInfo>>, opts: BuildOptions, meanings: Map<DNode, Meaning>, posStyles: APosStyle[] = []): Map<string, Chain> {
  const posOf = new Map(posStyles.map((p) => [`${p.id}/${p.occ}`, p.mods]));
  const chains = new Map<string, Chain>();
  relink(root);
  const all = collectNodes(root);
  const shared = all.filter((n) => n.parents.length > 1 && n.id);
  if (!shared.length) return chains;

  // letters already used as (binding) subscripts are not reused for movement indices
  const used = new Set<string>();
  for (const n of all) for (const i of n.indices) used.add(i);
  const pickIndex = (id: string) => {
    if (/^[a-z]$/.test(id) && !used.has(id)) {
      used.add(id);
      return id;
    }
    const l = INDEX_LETTERS.find((x) => !used.has(x)) ?? id;
    used.add(l);
    return l;
  };

  // innermost chains first (remnant movement: the inner chain is resolved inside the moved phrase)
  const depth = depthMap(root);
  shared.sort((a, b) => depth.get(b)! - depth.get(a)!);

  for (const s of shared) {
    relink(root);
    const d = depthMap(root);
    const ord = new Map(collectNodes(root).map((n, i) => [n, i]));
    const slots: { parent: DNode; index: number; info: OccInfo }[] = [];
    for (const p of [...new Set(s.parents)]) {
      p.children.forEach((c, index) => {
        if (c !== s) return;
        const mother = nearestSrc(p);
        slots.push({ parent: p, index, info: (mother ? occFlags.get(mother)?.get(s) : undefined) ?? {} });
      });
    }
    slots.sort((a, b) => (d.get(a.parent) ?? 0) - (d.get(b.parent) ?? 0) || (ord.get(a.parent) ?? 0) - (ord.get(b.parent) ?? 0));
    // what each position has on its own: its #ref (#wh^@red"words"), and its line (#wh/2: …)
    const own = slots.map((sl, i) => {
      const L = posOf.get(`${s.id}/${i + 1}`);
      const text = L?.text ?? sl.info.text;
      return {
        L,
        flag: L?.pronounce ?? (L?.text !== undefined ? true : undefined) ?? sl.info.flag,
        text,
        sem: L?.sem ?? sl.info.sem,
        triangle: L?.triangle ?? sl.info.triangle,
        color: L?.color ?? sl.info.color,
      };
    });
    const overt = slots.map((_, i) => own[i].flag ?? i === 0);
    const chain: Chain = { instances: [], overt };
    if (opts.chainIndices) chain.index = pickIndex(s.id!);
    const indexRun = chain.index ? [{ text: chain.index, sub: true }] : [];

    if (opts.chains === 'multidominance') {
      if (chain.index) s.label = [...s.label, ...indexRun];
      chain.instances = slots.map(() => s);
      chains.set(s.id!, chain);
      continue;
    }
    // clone before marking anything silent
    const clones = slots.map((_, i) => {
      if (i === 0) return s;
      // everything written on the constituent is shared by all its positions
      // keys stay the same from one drawing to the next: a selected copy stays selected after an edit
      return cloneSubtree(s, `~c${i + 1}`);
    });
    slots.forEach((sl, i) => {
      const info = own[i];
      let inst: DNode;
      if (overt[i] || opts.chains === 'copies') {
        inst = clones[i];
        if (!overt[i]) markCopy(inst);
        if (chain.index) inst.label = [...inst.label, ...indexRun];
      } else {
        // trace: the category with a "t"
        const t: DNode = { key: `${s.key}~t${i + 1}`, kind: 'leaf', label: [{ text: 't' }, ...indexRun], children: [], parents: [], indices: [], trace: true, synthetic: true };
        inst = { key: `${s.key}~tp${i + 1}`, kind: 'phrase', label: cloneRuns(s.label), children: [t], parents: [], indices: [], src: s.src, trace: true, copyOf: s.key, color: s.color, branchColor: s.branchColor, notes: s.notes, edgeColor: s.edgeColor, edgeWidth: s.edgeWidth, edgeLen: s.edgeLen };
      }
      // pronounced with other words: #wh!"whom"
      if (info.text !== undefined && overt[i]) {
        // "zij | she": the words, then gloss lines
        const [words, ...gloss] = info.text.split(/\s*\|\s*/);
        const leaf: DNode = { key: `${inst.key}~w`, kind: 'leaf', label: parseRich(words), children: [], parents: [], indices: [], synthetic: true };
        if (gloss.length) leaf.gloss = gloss.map((g) => parseRich(g, { smallCaps: true }));
        inst.children = [leaf];
        inst.triangle = false;
      }
      // this position only as a triangle over its words (the structure stays in the code): #wh^
      // this copy open although the constituent is a triangle: open
      if (info.triangle === false && inst.triangle && inst.untriangled) {
        inst.children = inst.untriangled;
        inst.triangle = false;
        if (!overt[i]) inst.children.forEach(markCopy);
      }
      if (info.triangle && !(info.text !== undefined && overt[i])) {
        if (!inst.trace) {
          const words: string[] = [];
          const walk = (x: DNode) => (x.kind === 'leaf' ? words.push(plain(x.label).trim()) : x.children.forEach(walk));
          inst.children.forEach(walk);
          inst.children = [{ key: `${inst.key}~tri`, kind: 'leaf', label: parseRich(words.filter(Boolean).join(' ') || '…'), children: [], parents: [], indices: [], synthetic: true, copy: inst.copy }];
        }
        inst.triangle = true;
      }
      // this position only in a colour: #wh@gray
      if (info.color === 'none') {
        // the default colour on this copy, although the constituent has one
        const clear = (x: DNode) => {
          delete x.color;
          delete x.branchColor;
          delete x.posColor;
          x.children.forEach(clear);
        };
        clear(inst);
      } else if (info.color) {
        const paint = (x: DNode) => {
          x.posColor = info.color;
          x.children.forEach(paint);
        };
        paint(inst);
      }
      // meaning of this position: #wh$x : e$ (e.g. a trace as a variable)
      if (info.sem !== undefined) {
        try {
          const m = parseMeaning(info.sem);
          meanings.set(inst, m);
          inst.sem = { runs: formulaRuns(info.sem), type: showTy(m.ty) };
        } catch (e) {
          inst.sem = { runs: formulaRuns(info.sem), error: (e as Error).message };
        }
      }
      // features, notes and the edge above of this position only
      const L = info.L;
      if (L?.features) inst.features = L.features.map((f) => parseRich(f));
      if (L?.notes) inst.notes = [...(inst.notes ?? []), ...L.notes.map((n, j) => ({ runs: parseRich(n.text), side: n.side, off: n.off, index: POS_NOTE + j, pos: { id: s.id!, occ: i + 1 } }))];
      if (L?.edge) inst.edgeColor = L.edge;
      if (L?.width && Number.isFinite(Number(L.width))) inst.edgeWidth = Number(L.width);
      if (L?.len && Number.isFinite(Number(L.len))) inst.edgeLen = Number(L.len);
      inst.chainRef = { id: s.id!, occ: i + 1 };
      sl.parent.children[sl.index] = inst;
      chain.instances.push(inst);
    });
    chains.set(s.id!, chain);
  }
  relink(root);
  return chains;
}

/* ------------------------------------------------------------ head movement */

/** a head: only terminals below it and a non-phrasal label (V, v, T — not DP or T′) */
const isHead = (n: DNode) => n.kind === 'phrase' && n.children.every((c) => c.kind === 'leaf') && analyseLabel(n.label).level === 0;

/**
 * An explicit arrow between two heads is head movement: the source is struck through and the
 * target is labelled with the complex head (V+v+T for successive steps).
 */
function applyHeadMovement(arrows: DArrow[]): Set<DArrow> {
  const head = (n: DNode) => (n.kind === 'leaf' ? n.parents[0] : n);
  const moves = arrows
    .filter((a) => !a.auto && !a.plain && !a.headMove)
    .map((a) => ({ from: head(a.from), to: head(a.to), arrow: a }))
    .filter((m) => m.from && m.to && m.from !== m.to && isHead(m.from) && isHead(m.to));
  const moved = new Set(moves.map((m) => m.arrow));
  if (!moves.length) return moved;
  const original = new Map<DNode, Runs>();
  for (const m of moves) for (const n of [m.from, m.to]) if (!original.has(n)) original.set(n, cloneRuns(n.label));
  const into = new Map<DNode, DNode[]>();
  for (const m of moves) {
    if (!into.has(m.to)) into.set(m.to, []);
    into.get(m.to)!.push(m.from);
  }
  const memo = new Map<DNode, Runs>();
  const complex = (n: DNode, seen = new Set<DNode>()): Runs => {
    if (memo.has(n)) return memo.get(n)!;
    if (seen.has(n)) return original.get(n)!;
    seen.add(n);
    const parts = (into.get(n) ?? []).map((s) => complex(s, seen));
    const r = parts.length ? [...parts.flatMap((p) => [...p, { text: '+' }]), ...original.get(n)!] : original.get(n)!;
    memo.set(n, r);
    return r;
  };
  // the words move along: sing+s at the target
  const NULL = /^[∅Øø]$/;
  const originalWords = new Map<DNode, string[]>();
  for (const m of moves) for (const n of [m.from, m.to]) if (!originalWords.has(n)) originalWords.set(n, n.children.filter((c) => c.kind === 'leaf').map((c) => plain(c.label).trim()));
  const wordsMemo = new Map<DNode, string[]>();
  const words = (n: DNode, seen = new Set<DNode>()): string[] => {
    if (wordsMemo.has(n)) return wordsMemo.get(n)!;
    if (seen.has(n)) return originalWords.get(n)!;
    seen.add(n);
    const r = [...(into.get(n) ?? []).flatMap((s) => words(s, seen)), ...originalWords.get(n)!];
    wordsMemo.set(n, r);
    return r;
  };
  for (const m of moves) {
    m.from.struck = true;
    for (const c of m.from.children) c.struck = true;
  }
  for (const n of into.keys()) {
    n.label = complex(n);
    const all = words(n).filter(Boolean);
    const overt = all.filter((w) => !NULL.test(w));
    const text = (overt.length ? overt : all).join('+');
    if (!text) continue;
    const leaf = n.children.find((c) => c.kind === 'leaf');
    if (leaf) {
      leaf.label = parseRich(text);
      n.children = n.children.filter((c) => c.kind !== 'leaf' || c === leaf);
    } else n.children = [{ key: `${n.key}~hm`, kind: 'leaf', label: parseRich(text), children: [], parents: [n], indices: [], synthetic: true }];
  }
  return moved;
}

/* ------------------------------------------------------------ semantics */

function computeSemantics(root: DNode, explicit: Map<DNode, Meaning>, o: SemanticsOptions) {
  const memo = new Map<DNode, Meaning | null>();
  const byKey = new Map([...explicit].map(([n, m]) => [n.key, m]));
  const own = (n: DNode) => explicit.get(n) ?? (n.copyOf && !n.copy && !n.trace ? byKey.get(n.copyOf) : undefined);
  const describe = (m: Meaning, rule?: string): DSem => ({ runs: showRuns(m.term, o.types), type: showTy(m.ty), computed: true, rule, source: `${toSource(m.term)} : ${showTy(m.ty).replace(/⟨/g, '<').replace(/⟩/g, '>')}` });
  const go = (n: DNode): Meaning | null => {
    if (memo.has(n)) return memo.get(n)!;
    memo.set(n, null);
    let result: Meaning | null = null;
    const kids = n.children.filter((c) => c.kind === 'phrase');
    const kidMeanings = kids.map(go);
    if (own(n)) result = own(n)!;
    else if (n.sem?.error) result = null;
    else if (kids.length) {
      const known = kidMeanings.filter((m): m is Meaning => !!m);
      if (known.length === 1) {
        result = known[0];
        if (o.compute) n.sem = describe(result);
      } else if (known.length === 2 && kids.length === 2) {
        try {
          // Predicate Abstraction: a moved constituent and a sister that contains a lower position
          // of its chain whose meaning is a variable (#wh$x : e$)
          let [m1, m2] = [known[0], known[1]];
          let pa = false;
          for (const [i, j] of [
            [0, 1],
            [1, 0],
          ]) {
            const mover = kids[i];
            const ref = mover.chainRef;
            if (!ref) continue;
            const lower = collectNodes(kids[j]).find((x) => x.chainRef?.id === ref.id && x.chainRef.occ > ref.occ && explicit.has(x));
            const v = lower && explicit.get(lower)!;
            if (v && (v.term.k === 'const' || v.term.k === 'var')) {
              const abstracted = abstractOver(i === 0 ? m2 : m1, v.term.name, v.ty);
              if (i === 0) m2 = abstracted;
              else m1 = abstracted;
              pa = true;
              break;
            }
          }
          const c = compose(m1, m2);
          result = c;
          if (o.compute) n.sem = describe(c, pa ? `PA+${c.rule}` : c.rule);
        } catch (e) {
          if (o.compute && e instanceof SemError) n.sem = { runs: [], error: e.message, computed: true };
        }
      } else if (known.length > 2 || (known.length === 2 && kids.length > 2)) {
        if (o.compute) n.sem = { runs: [], error: `${kids.length} daughters: composition is binary (binarize this node)`, computed: true };
      }
    }
    memo.set(n, result);
    return result;
  };
  go(root);
}

/* ------------------------------------------------------------ misc */

/** Copy colours and copy-marking down to descendants. */
function propagateStyles(root: DNode) {
  const visit = (n: DNode, branch: string | undefined, copy: boolean) => {
    if (branch && !n.branchColor) n.branchColor = branch;
    if (branch && !n.color) n.color = branch;
    if (copy) n.copy = true;
    for (const c of n.children) visit(c, n.branchColor ?? branch, copy || !!n.copy);
  };
  visit(root, undefined, false);
}

function isNullNode(n: DNode): boolean {
  if (n.kind === 'leaf') return !!n.empty && baseText(n.label).trim() !== 'e';
  if (n.children.length === 0) return ['∅', 'Ø'].includes(baseText(n.label).trim());
  return n.children.every(isNullNode);
}

function removeEmpty(root: DNode): DNode {
  const seen = new Set<DNode>();
  const visit = (n: DNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    const kept = n.children.filter((c) => !isNullNode(c));
    if (kept.length > 0 || n.children.every((c) => c.kind === 'leaf')) n.children = kept;
    n.children.forEach(visit);
  };
  visit(root);
  return root;
}

export function labelText(n: DNode): string {
  return plain(n.label);
}
