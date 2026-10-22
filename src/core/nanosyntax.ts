import type { AChild } from './ast';
import { parse } from './parser';
import { parseRich, plain } from './richtext';
import { applyChanges, escapeLabel } from './edits';

/** Starke (2018), §§9.2–9.3; Caha (2019), §§4–6, especially (36)/(73);
 * De Clercq, Caha, Starke and Vanden Wyngaerd (2025), §§1.4 and 1.6, especially (45).
 * Movement copies are retained for display but ignored by lexical matching.
 * Only whole constituents of L-trees match, never arbitrary feature subsets.
 */
export type NSPreset = 'starke2018' | 'caha2019' | 'caha2019mm' | 'caha2025';
export interface NSAlgorithmSettings {
  movement: 'starke2018' | 'caha2025';
  closure: 'late' | 'early';
  backtracking: 'aux-only' | 'multiple-merge';
}
/** Strings remain accepted for saved canvases and literature example presets. */
export type NSAlgorithm = NSPreset | NSAlgorithmSettings;
export function resolveNSAlgorithm(algorithm: NSAlgorithm): NSAlgorithmSettings {
  if (typeof algorithm !== 'string') return { ...algorithm };
  return {
    movement: algorithm === 'caha2025' ? 'caha2025' : 'starke2018',
    closure: algorithm === 'starke2018' ? 'late' : 'early',
    backtracking: algorithm === 'caha2019mm' ? 'multiple-merge' : 'aux-only',
  };
}
export interface LexicalEntry { id: string; expression: string; source: string }
export type NSAction = 'merge' | 'lexicalize' | 'failure' | 'move-spec' | 'move-complement' | 'subextract' | 'pied-pipe' | 'backtrack' | 'spawn' | 'grow' | 'unresolved' | 'done';
export interface DerivationStep {
  action: NSAction;
  title: string;
  detail: string;
  source: string;
  /** Independent workspaces at this step, before they are merged. */
  workspaces?: string[];
  cycle: number;
  status: 'success' | 'failure' | 'info';
}
export interface DerivationResult {
  steps: DerivationStep[];
  source: string;
  complete: boolean;
  unresolved: string[];
  warnings: string[];
  surface: string[];
  limited: boolean;
}
export interface DerivationOptions { maxAttempts?: number; maxSteps?: number; hideLowerCopies?: boolean }

interface NSNode {
  key: string;
  label: string;
  atom?: boolean;
  gap?: string;
  moveGap?: string;
  children: NSNode[];
  remnant?: boolean;
  clb?: boolean;
  auxOpen?: boolean;
  /** Immutable provenance for replay inside independently reopened workspaces.
   * clone shares this history; the historical trees themselves are never edited. */
  history?: { template: NSNode; before: NSNode; option: number };
  spell?: { expression: string; entry: string; failed?: boolean };
}
interface Lex { entry: LexicalEntry; root: NSNode; size: number }
interface Match { lex: Lex; extra: number }
interface Option { tree: NSNode; target: NSNode; action: NSAction; title: string }
interface Frame { before: Map<string, NSNode>; options: Option[]; next: number; locked?: boolean; result?: Map<string, NSNode>; reopened?: boolean }

const text = (s: string) => plain(parseRich(s, { primes: true })).trim();
const clone = (n: NSNode): NSNode => ({ ...n, children: n.children.map(clone) });
const live = (n: NSNode) => n.children.filter((c) => !c.gap);
const size = (n: NSNode): number => n.gap ? 0 : 1 + n.children.reduce((s, c) => s + size(c), 0);
const featureCount = (n: NSNode): number => n.gap ? 0 : n.atom ? 1 : n.children.reduce((sum, c) => sum + featureCount(c), 0);
const all = (n: NSNode): NSNode[] => n.gap ? [] : [n, ...n.children.flatMap(all)];
const signature = (n: NSNode): string => {
  const kids = live(n);
  // An emptied movement landing site is not an extra projection in the remnant.
  if (!n.label && !n.atom && kids.length === 1) return signature(kids[0]);
  return JSON.stringify([n.atom ? 'head' : 'phrase', n.label, kids.map(signature)]);
};
const feature = (n: NSNode) => n.children.find((c) => c.atom)?.label ?? n.label.replace(/P$/, '');

/** Compact [F2 [F1]] expands to [F2P F2 [F1P F1]].
 * Explicit trees, including binary bottoms [NP N Root], retain their shape.
 */
function read(source: string, prefix: string): NSNode {
  const p = parse(source);
  if (!p.ok) throw new Error(p.error.message);
  if (!p.doc.root) throw new Error('Enter a non-empty bracket tree.');
  if (p.doc.arrows.length || p.doc.posStyles.length) throw new Error('Use a base S-tree or L-tree without movement arrows or position styles.');
  let k = 0;
  const go = (a: AChild): NSNode => {
    if (a.kind === 'ref') throw new Error('Start from a base S-tree without movement chains (# references).');
    const key = prefix + ++k;
    if (a.kind === 'leaf') {
      // Separate bare heads in an explicit binary bottom, e.g. [NP N Root].
      return { key, label: text(a.text), atom: true, children: [] };
    }
    const label = text(a.label);
    const headLabel = label.length > 1 && label.endsWith('P') ? label.slice(0, -1) : label;
    const bracketedHeads = a.children.some((c) => c.kind === 'node' && !c.children.some((x) => x.kind !== 'leaf') && text(c.label) === headLabel);
    const kids: NSNode[] = [];
    for (const child of a.children) {
      if (child.kind === 'leaf') {
        // When an ordinary visual tree carries its expression on this phrase,
        // its bare word daughter is phonology rather than an extra feature.
        if (a.opts?.spell !== undefined && text(child.text) === text(a.opts.spell)) continue;
        for (const word of child.text.trim().split(/\s+/)) kids.push({ key: prefix + ++k, label: text(word), atom: true, children: [] });
      } else if (bracketedHeads && child.kind === 'node' && !child.children.some((x) => x.kind !== 'leaf') && !text(child.label).endsWith('P')) {
        kids.push({ key: prefix + ++k, label: text(child.label), atom: true, children: [] });
      } else kids.push(go(child));
    }
    if (!label) {
      if (kids.length !== 2) throw new Error('An unlabelled Merge node must have two daughters.');
      return { key, label, children: kids };
    }
    if (!kids.some((c) => c.atom)) {
      const projected = label.length > 1 && label.endsWith('P');
      const f = projected ? label.slice(0, -1) : label;
      return { key, label: projected ? label : label + 'P', children: [{ key: prefix + ++k, label: f, atom: true, children: [] }, ...kids] };
    }
    return { key, label, children: kids };
  };
  const root = go(p.doc.root);
  if (all(root).length > 180) throw new Error('Use at most 180 nodes per S-tree or L-tree.');
  return root;
}

export function validateLexicalEntry(entry: LexicalEntry): string | null {
  if (!entry.expression.trim()) return 'Enter an expression (use ∅ for zero spellout).';
  try { read(entry.source, 'l'); return null; } catch (e) { return (e as Error).message; }
}

function lexicon(entries: LexicalEntry[]): Lex[] {
  return entries.map((entry, i) => {
    const error = validateLexicalEntry(entry);
    if (error) throw new Error('L-tree ' + (entry.expression || i + 1) + ': ' + error);
    const root = read(entry.source, 'l' + i + '_');
    return { entry, root, size: featureCount(root) };
  });
}
function matches(n: NSNode, lex: Lex[]): Match[] {
  const sig = signature(n);
  return lex.filter((l) => all(l.root).some((x) => signature(x) === sig))
    .map((l) => ({ lex: l, extra: l.size - featureCount(n) }))
    .sort((a, b) => a.extra - b.extra);
}

function clearSpells(n: NSNode) {
  delete n.spell;
  for (const child of n.children) if (!child.gap) clearSpells(child);
}
function lexicalize(n: NSNode, match: Match) {
  clearSpells(n);
  n.spell = { expression: match.lex.entry.expression, entry: match.lex.entry.id };
}

/** Extract from the original input to a movement attempt, marking all intervening remnants. */
function evacuate(root: NSNode, key: string): { tree: NSNode; target: NSNode } | null {
  const remnant = clone(root);
  let moved: NSNode | null = null;
  function take(n: NSNode): boolean {
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      if (c.gap) continue;
      if (c.key === key) {
        moved = c;
        n.children[i] = { key: root.key + '_gap_' + key, gap: c.key, label: c.label, children: [] };
        n.remnant = true;
        delete n.spell;
        return true;
      }
      if (take(c)) { n.remnant = true; delete n.spell; return true; }
    }
    return false;
  }
  if (!take(remnant) || !moved) return null;
  return { tree: { key: root.key + '_move_' + key, label: '', children: [moved, remnant], moveGap: root.key + '_gap_' + key }, target: remnant };
}

function movementOptions(root: NSNode, algorithm: NSAlgorithm): Option[] {
  const complement = live(root).find((c) => !c.atom);
  if (!complement) return [];
  const targets: { node: NSNode; action: NSAction; title: string }[] = [];
  if (resolveNSAlgorithm(algorithm).movement === 'starke2018') {
    if (!complement.label && live(complement).length === 2) {
      targets.push({ node: live(complement)[0], action: 'move-spec', title: 'Spec-to-spec movement' });
    }
    targets.push({ node: complement, action: 'move-complement', title: 'Complement (snowball) movement' });
  } else {
    // Closest labelled non-remnant phrase (breadth first). Unlabelled Merge
    // nodes and remnants cannot be initial targets, but may be pied-piped.
    const queue: { n: NSNode; parents: NSNode[] }[] = [{ n: complement, parents: [] }];
    while (queue.length) {
      const { n, parents } = queue.shift()!;
      if (n.label && !n.atom && !n.remnant) {
        targets.push({ node: n, action: n === complement ? 'move-complement' : parents.length === 1 && !complement.label ? 'move-spec' : 'subextract', title: 'Evacuate closest labelled non-remnant: ' + n.label });
        for (const parent of [...parents].reverse()) targets.push({ node: parent, action: 'pied-pipe', title: 'Pied-pipe immediately dominating ' + (parent.label || 'Merge node') });
        break;
      }
      for (const c of live(n)) if (!c.atom) queue.push({ n: c, parents: [...parents, n] });
    }
  }
  return targets.flatMap(({ node, action, title }) => {
    const moved = evacuate(root, node.key);
    return moved ? [{ ...moved, action, title }] : [];
  });
}

function options(root: NSNode, algorithm: NSAlgorithm): Option[] {
  const headlessMerge = !root.label && !root.children.some((c) => c.atom);
  const initial: Option = { tree: clone(root), target: clone(root), action: 'merge', title: headlessMerge ? 'Merge the two derived branches' : 'Merge ' + feature(root) };
  return [initial, ...(headlessMerge ? [] : movementOptions(root, algorithm))]
    .map((o) => o.action === 'merge' ? { ...o, target: o.tree } : o);
}

function schedule(root: NSNode): NSNode[] {
  const out: NSNode[] = [];
  function visit(n: NSNode) { for (const c of n.children) if (!c.atom) visit(c); out.push(n); }
  visit(root);
  return out;
}

function realize(template: NSNode, forest: Map<string, NSNode>): NSNode {
  return { ...template, children: template.children.map((c) => c.atom ? clone(c) : clone(forest.get(c.key)!)) };
}
function advance(forest: Map<string, NSNode>, template: NSNode, result: NSNode): Map<string, NSNode> {
  const next = new Map(forest);
  for (const c of template.children) if (!c.atom) next.delete(c.key);
  next.set(template.key, result);
  return next;
}

/** Use genuine chains for display so existing copies/traces/arrows/export keep working. */
function sourceOf(roots: NSNode[], unresolved = new Set<string>(), movement?: string): string {
  const nodes = roots.flatMap(all);
  const gaps: NSNode[] = [];
  function collect(n: NSNode) { if (n.gap) gaps.push(n); else n.children.forEach(collect); }
  roots.forEach(collect);
  const targets = new Set(gaps.filter((node) => node.key === movement).map((n) => n.gap!));
  const ids = new Map<string, string>();
  for (const n of nodes) if (targets.has(n.key)) ids.set(n.key, 'ns' + (ids.size + 1));
  const emit = (n: NSNode): string => {
    if (n.gap) {
      if (n.key !== movement) return '';
      const target = ids.get(n.gap);
      return target ? '#' + target : '';
    }
    // A syntactic head is an upright bracketed node, never a bare word expression.
    let head = escapeLabel(n.label);
    if (ids.has(n.key)) head += '#' + ids.get(n.key);
    if (n.spell) {
      head += ';spell=' + JSON.stringify(n.spell.expression);
      if (n.spell.failed) head += ';spellfail=yes';
    }
    if (unresolved.has(n.key)) head += '@red';
    const children = n.children.map(emit).filter(Boolean);
    if (!head && children.length < 2) return children[0] ?? '';
    const kids = children.join(' ');
    return '[' + head + (kids ? (head ? ' ' : '\n') + kids : '') + ']';
  };
  const tree = roots.length === 1 ? emit(roots[0]) : '[ ' + roots.map(emit).join(' ') + ']';
  return tree;
}

/** Expand compact lexical features to explicit phrasal trees, with phonology in ;spell. */
export function lexicalEntrySource(source: string, expression: string): string {
  const root = read(source, 'lex');
  if (expression.trim()) root.spell = { expression: expression.trim(), entry: '' };
  return sourceOf([root]);
}

/** Older saved derivations retained all chain positions. Apply the current per-step display rule. */
export function derivationDisplaySource(source: string, action: NSAction): string {
  const parsed = parse(source);
  if (!parsed.ok || !parsed.doc.root) return source;
  const movement = ['move-spec', 'move-complement', 'subextract', 'pied-pipe'].includes(action);
  let target: string | undefined;
  function findTarget(node: AChild) {
    if (node.kind !== 'node' || target) return;
    if (node.id && /^ns\d+$/.test(node.id)) target = node.id;
    else node.children.forEach(findTarget);
  }
  if (movement) findTarget(parsed.doc.root);
  let retained = false;
  const prune = (node: AChild): { keep: boolean; changes: { from: number; to: number; insert: string }[] } => {
    if (node.kind === 'ref') {
      const keep = movement && !retained && node.id === target;
      if (keep) retained = true;
      return { keep, changes: [] };
    }
    if (node.kind === 'leaf') return { keep: true, changes: [] };
    if (node.id && /^nsgap\d+$/.test(node.id)) return { keep: false, changes: [] };
    const children = node.children.map((child) => ({ child, result: prune(child) }));
    if (!node.label && !children.some(({ result }) => result.keep)) return { keep: false, changes: [] };
    return { keep: true, changes: children.flatMap(({ child, result }) => result.keep ? result.changes : [{ ...child.span, insert: '' }]) };
  };
  const changes = prune(parsed.doc.root).changes;
  for (const arrow of parsed.doc.arrows) if (/^nsgap\d+$/.test(arrow.from) || /^nsgap\d+$/.test(arrow.to)) changes.push({ ...arrow.span, insert: '' });
  return applyChanges(source, changes);
}

/** Upgrade saved empty-copy arrows to the same adjacent links as visible chains. */
export function sequenceHiddenCopyArrows(source: string): string {
  if (!source.includes('#nsgap')) return source;
  const parsed = parse(source);
  if (!parsed.ok || !parsed.doc.root) return source;
  const arrows = new Map(parsed.doc.arrows.filter((arrow) => arrow.plain && /^nsgap\d+$/.test(arrow.from)).map((arrow) => [arrow.from, arrow]));
  const previous = new Map<string, string>();
  const changes: { from: number; to: number; insert: string }[] = [];
  function visit(node: AChild) {
    if (node.kind !== 'node') return;
    const arrow = node.id && arrows.get(node.id);
    if (arrow) {
      let target = arrow.to;
      const seen = new Set([arrow.from]);
      while (arrows.has(target) && !seen.has(target)) {
        seen.add(target);
        target = arrows.get(target)!.to;
      }
      if (/^ns\d+$/.test(target)) {
        const to = previous.get(target) ?? target;
        previous.set(target, arrow.from);
        if (to !== arrow.to) {
          const line = source.slice(arrow.span.from, arrow.span.to);
          changes.push({ ...arrow.span, insert: line.replace(/(->\s*)#[\w-]+/, '$1#' + to) });
        }
      }
    }
    node.children.forEach(visit);
  }
  visit(parsed.doc.root);
  return applyChanges(source, changes);
}

function coverage(root: NSNode): { missing: NSNode[]; surface: string[] } {
  const missing: NSNode[] = [];
  const surface: string[] = [];
  function visit(n: NSNode, covered: boolean, owner: NSNode) {
    if (n.gap) return;
    if (n.spell && !n.spell.failed && !covered) surface.push(n.spell.expression);
    covered ||= !!n.spell && !n.spell.failed;
    if (n.atom && !covered) missing.push(owner);
    for (const c of n.children) visit(c, covered, n.atom ? owner : n);
  }
  visit(root, false, root);
  return { missing: [...new Map(missing.map((n) => [n.key, n])).values()], surface };
}

export function deriveNanosyntax(source: string, entries: LexicalEntry[], algorithm: NSAlgorithm, limits: DerivationOptions = {}): DerivationResult {
  const settings = resolveNSAlgorithm(algorithm);
  const lex = lexicon(entries);
  if (!lex.length) throw new Error('Add at least one L-tree before building a derivation.');
  const input = read(source, 's');
  const cycles = schedule(input);
  const steps: DerivationStep[] = [];
  const warnings: string[] = [];
  let forest = new Map<string, NSNode>();
  let frames: Frame[] = [];
  let attempts = 0;
  let workspaceSerial = 0;
  let limited = false;
  const maxAttempts = limits.maxAttempts ?? 1800;
  const maxSteps = limits.maxSteps ?? 700;
  const log = (action: NSAction, title: string, detail: string, cycle: number, state: Map<string, NSNode>, status: DerivationStep['status'] = 'info', movement?: string) => {
    if (steps.length >= maxSteps) { limited = true; return; }
    const roots = [...state.values()];
    steps.push({ action, title, detail, cycle: cycle + 1, status, source: sourceOf(roots, new Set(), movement), ...(roots.length > 1 ? { workspaces: roots.map((root) => sourceOf([root], new Set(), movement)) } : {}) });
  };
  function makeFrame(i: number, before: Map<string, NSNode>): Frame {
    return { before, options: options(realize(cycles[i], before), algorithm), next: 0 };
  }
  function tryNext(i: number, frame: Frame): Map<string, NSNode> | null {
    while (frame.next < frame.options.length) {
      if (++attempts > maxAttempts || steps.length >= maxSteps - 2) { limited = true; return null; }
      const option = frame.options[frame.next++];
      const state = advance(frame.before, cycles[i], clone(option.tree));
      // Recreate each option before applying lexicalisation (frames remain immutable).
      const tree = state.get(cycles[i].key)!;
      const target = all(tree).find((n) => n.key === option.target.key)!;
      log(option.action, option.title, option.action === 'merge' ? 'Insert the next feature; try identity with a whole constituent of an L-tree.' : 'Retry from the unmodified cycle; lower copies do not participate in matching.', i, state, 'info', option.tree.moveGap);
      const found = matches(target, lex);
      if (!found.length) {
        // An unlabelled Merge introduces no feature needing a new exponent.
        // Its already derived daughters retain their independent spellouts.
        if (!cycles[i].label && !cycles[i].children.some((c) => c.atom)) return state;
        target.spell = { expression: '∅', entry: '', failed: true };
        log('failure', 'No lexical match', 'No L-tree contains this entire constituent (identity matching / Superset Principle).', i, state, 'failure');
        continue;
      }
      const tied = found.filter((m) => m.extra === found[0].extra);
      const ambiguous = tied.length > 1 ? ' Equal-size alternatives: ' + tied.map((m) => m.lex.entry.expression).join(', ') + '; the first listed entry wins.' : '';
      if (ambiguous && !warnings.includes(ambiguous.trim())) warnings.push(ambiguous.trim());
      lexicalize(target, found[0]);
      remember(tree, cycles[i], frame.before, frame.next - 1);
      log('lexicalize', 'Spell out ⇒ ' + found[0].lex.entry.expression, 'Whole-constituent match. Fewest unused L-tree features (Elsewhere Condition).' + ambiguous, i, state, 'success');
      return state;
    }
    return null;
  }
  function remember(tree: NSNode, template: NSNode, before: Map<string, NSNode>, option: number) {
    if (settings.backtracking !== 'multiple-merge') return;
    const complements = template.children.filter((node) => !node.atom);
    const previous = complements.length === 1 && before.get(complements[0].key);
    if (previous) tree.history = { template, before: previous, option };
  }
  /** Replay younger cycles while keeping the original cycle options in preference order. */
  function replay(i: number, end: number, state: Map<string, NSNode>, path: Frame[]): { state: Map<string, NSNode>; path: Frame[] } | null {
    if (i > end) return { state, path };
    if (limited) return null;
    const frame = makeFrame(i, state);
    for (;;) {
      const next = tryNext(i, frame);
      if (!next) return null;
      const result = replay(i + 1, end, next, [...path, frame]);
      if (result) return result;
      log('backtrack', 'Undo failed continuation', 'Return to the next option for cycle ' + (i + 1) + '.', i, state);
    }
  }
  function backtrack(end: number): boolean {
    for (let j = end - 1; j >= 0 && !limited; j--) {
      const frame = frames[j];
      // Never replace an earlier successful Merge-XP with another spawned derivation.
      if (frame.locked) {
        // Early AUX Closure can be undone only after the ordinary main-spine
        // alternatives fail: Caha (2019), §6.5 (73)/(104).
        if (frame.result && !frame.reopened && j + 1 <= end) {
          frame.reopened = true;
          if (settings.backtracking === 'aux-only') log('backtrack', 'Reopen the auxiliary workspace', 'Main-spine spellout and rescue failed. Return to the Spec-formation stage and try Merge F in AUX (Caha 2019, (73)).', j, frame.result);
          const previous = frame.result.get(cycles[j].key)!;
          const others = [...frame.result.values()].filter((node) => node !== previous);
          const grown = settings.backtracking === 'multiple-merge'
            ? multipleMerge(j + 1, cycles[j + 1], previous, (roots) => [...roots, ...others], 0)
            : grow(j + 1, frame.result, true);
          if (grown) {
            const next = advance(frame.result, cycles[j + 1], grown);
            const grownFrame: Frame = { before: frame.result, options: [], next: 0, locked: true, result: next };
            const result = replay(j + 2, end, next, [...frames.slice(0, j + 1), grownFrame]);
            if (result) { forest = result.state; frames = result.path; return true; }
          }
        }
        break;
      }
      while (frame.next < frame.options.length && !limited) {
        log('backtrack', 'Backtrack to cycle ' + (j + 1), 'Later lexicalisation failed; undo younger cycles and try the next rescue option.', j, frame.before);
        const next = tryNext(j, frame);
        if (!next) break;
        const result = replay(j + 1, end, next, [...frames.slice(0, j), frame]);
        if (result) { forest = result.state; frames = result.path; return true; }
      }
    }
    return false;
  }
  function spawn(i: number, before: Map<string, NSNode>): NSNode | null {
    const merged = realize(cycles[i], before);
    // Merge-XP supplies ONE newly requested feature above an existing domain.
    // It must not replace an unmatched binary lexical bottom with a different root.
    if (merged.children.filter((c) => c.atom).length !== 1 || !merged.children.some((c) => !c.atom)) return null;
    const label = merged.label;
    const candidates = lex.flatMap((l) => all(l.root).filter((n) => !n.atom && n.label === label && feature(n) === feature(merged) && all(n).some((x) => live(x).length >= 2 && live(x).every((c) => c.atom))).map((n) => ({ n, l })))
      .sort((a, b) => size(a.n) - size(b.n) || a.l.size - b.l.size);
    for (const { n } of candidates) {
      if (++attempts > maxAttempts) { limited = true; return null; }
      let prefix = clone(n);
      // New workspace gets unique keys, and actually merges and spells out each layer.
      for (const x of all(prefix)) x.key = 'aux' + i + '_' + attempts + '_' + x.key;
      log('spawn', 'Spawn a new workspace for ' + feature(merged), 'All ordinary rescue and backtracking options failed. Build a complex left branch from the lexicon.', i, before);
      const aux = new Map<string, NSNode>();
      let succeeded = true;
      for (const layer of schedule(prefix)) {
        const current = realize(layer, aux);
        const state = new Map([['workspace', current], ...before]);
        log('merge', 'Workspace: Merge ' + feature(layer), 'Separate derivation, as in Starke (2018), step (3).', i, state);
        const found = matches(current, lex);
        if (!found.length) { current.spell = { expression: '∅', entry: '', failed: true }; succeeded = false; log('failure', 'Workspace has no match', 'This proposed left branch cannot be built cyclically.', i, state, 'failure'); break; }
        lexicalize(current, found[0]);
        remember(current, layer, aux, 0);
        aux.set(layer.key, current);
        state.set('workspace', current);
        log('lexicalize', 'Workspace: ⇒ ' + found[0].lex.entry.expression, 'Lexicalise this layer before continuing the subderivation.', i, state, 'success');
      }
      if (!succeeded) continue;
      prefix = aux.get(prefix.key)!;
      const result: NSNode = { ...merged, clb: true, auxOpen: settings.closure === 'late', children: [prefix, ...merged.children.filter((c) => !c.atom)] };
      const state = advance(before, cycles[i], result);
      if (result.auxOpen) {
        state.delete(cycles[i].key);
        result.children.forEach((branch) => state.set(branch.key, branch));
      }
      log('spawn', result.auxOpen ? 'Keep AUX open for the next feature' : 'Merge XP as a complex left branch',
        'The auxiliary phrase provides ' + feature(merged) + (result.auxOpen ? '; Late Closure keeps it separate until it cannot grow further.' : '; its expression precedes the existing material.'), i, state, 'success');
      return result;
    }
    return null;
  }
  function grow(i: number, before: Map<string, NSNode>, reopened = false): NSNode | null {
    const template = cycles[i];
    const comp = template.children.find((c) => !c.atom);
    const previous = comp && before.get(comp.key);
    if (!previous?.clb || (!reopened && !previous.auxOpen)) return null;
    const auxRoot: NSNode = { ...clone(template), key: template.key + '_growth', children: [...template.children.filter((c) => c.atom).map(clone), clone(previous.children[0])] };
    const main = previous.children.slice(1).map(clone);
    for (const [choice, option] of options(auxRoot, algorithm).entries()) {
      if (++attempts > maxAttempts || steps.length >= maxSteps - 2) { limited = true; return null; }
      const tree = clone(option.tree);
      const target = all(tree).find((n) => n.key === option.target.key)!;
      const state = new Map([['workspace', tree], ...before]);
      if (comp) state.delete(comp.key);
      for (const n of main) state.set(n.key, n);
      log(option.action === 'merge' ? 'grow' : option.action,
        (reopened ? 'Reopened workspace: ' : 'Open workspace: ') + option.title,
        reopened ? 'Reopen AUX only after main-spine alternatives have failed (Caha 2019, (73)).' : 'Keep the costly auxiliary workspace open and try the next feature there first (Starke 2018, §9.3).', i, state, 'info', tree.moveGap);
      const found = matches(target, lex);
      if (!found.length) {
        target.spell = { expression: '∅', entry: '', failed: true };
        log('failure', 'Workspace has no lexical match', 'Undo this attempt before trying the next rescue operation.', i, state, 'failure');
        continue;
      }
      // The reopened AUX option requires co-spellout with some feature of
      // the old Spec (Caha 2019, p.194): a new unary suffix is insufficient.
      if (reopened && !all(target).some((n) => all(previous.children[0]).some((old) => old.key === n.key))) continue;
      lexicalize(target, found[0]);
      if (settings.backtracking === 'multiple-merge') tree.history = { template, before: previous.children[0], option: choice };
      const result: NSNode = { ...clone(template), clb: true, auxOpen: settings.closure === 'late', children: [tree, ...main] };
      log('lexicalize', 'Growing branch: ⇒ ' + found[0].lex.entry.expression,
        'The larger lexicalisation overrides spellout in its domain. ' + (settings.closure === 'early' ? 'Close AUX immediately and merge it before the main spine.' : 'The auxiliary remains available for coordinated growth.'),
        i, result.auxOpen ? state : advance(before, template, result), 'success');
      return result;
    }
    return null;
  }
  /** Caha (2019), §7.3 (14)–(19): F is tried in EVERY reopened workspace.
   * Failed copies of F are undone; successful copies coexist. At least one must
   * succeed before Early Closure recombines the branches in their original order.
   * The callback keeps all unrelated workspaces visible during recursive rescue.
   */
  type Surround = (roots: NSNode[]) => NSNode[];
  const snapshot = (roots: NSNode[]) => new Map(roots.map((root, index) => ['workspace' + index, root]));
  function multipleMerge(i: number, template: NSNode, previous: NSNode, surround: Surround, depth: number): NSNode | null {
    if (limited || !previous.clb) return null;
    if (depth > 180) { limited = true; return null; }
    const branches = previous.children.filter((node) => !node.atom).map(clone);
    if (branches.length < 2) return null;
    log('backtrack', 'Multiple Merge: reopen all workspaces',
      'Return to Spec formation. Merge ' + feature(template) + ' independently in every reopened workspace (Caha 2019, §7.3, (14)–(15)).',
      i, snapshot(surround(branches)));
    let successes = 0;
    for (let index = 0; index < branches.length && !limited; index++) {
      const place: Surround = (roots) => surround([...branches.slice(0, index), ...roots, ...branches.slice(index + 1)]);
      const result = workspaceFeature(i, template, branches[index], place, depth + 1);
      if (result) { branches[index] = result; successes++; }
    }
    if (!successes || limited) {
      log('backtrack', 'Multiple Merge failed in every workspace',
        'Undo every failed copy of ' + feature(template) + '. A new auxiliary workspace is the remaining last resort.', i, snapshot(surround([previous])), 'failure');
      return null;
    }
    const result: NSNode = { key: 'mmjoined' + ++workspaceSerial, label: template.label, clb: true, auxOpen: settings.closure === 'late', children: branches };
    log('grow', result.auxOpen ? 'Keep the reopened AUX available' : 'Close the reopened workspaces',
      feature(template) + ' lexicalizes in ' + successes + ' of ' + branches.length + ' workspaces. Undo failed copies; recombine in the original order. ' + (settings.closure === 'early' ? 'The next external Merge targets the combined root (Early Closure).' : 'Late Closure may grow AUX again before the next main-spine cycle.'),
      i, snapshot(surround(result.auxOpen ? branches : [result])), 'success');
    return result;
  }
  function workspaceFeature(i: number, template: NSNode, previous: NSNode, surround: Surround, depth: number, start = 0): NSNode | null {
    if (limited || depth > 180) { limited = true; return null; }
    // Each occurrence of F has its own identity, including movement gap keys.
    const id = 'mm' + ++workspaceSerial + '_';
    const root: NSNode = { key: id + template.key, label: template.label, children: [
      ...template.children.filter((node) => node.atom).map((node) => ({ ...clone(node), key: id + node.key })), clone(previous),
    ] };
    const choices = options(root, algorithm);
    for (let index = start; index < choices.length; index++) {
      if (++attempts > maxAttempts || steps.length >= maxSteps - 2) { limited = true; return null; }
      const option = choices[index];
      const tree = clone(option.tree);
      const target = all(tree).find((node) => node.key === option.target.key)!;
      log(option.action, 'Multiple Merge: ' + option.title,
        'Apply the ordinary spellout procedure in this workspace; the other workspaces remain independent.',
        i, snapshot(surround([tree])), 'info', tree.moveGap);
      const found = matches(target, lex);
      if (!found.length) {
        target.spell = { expression: '∅', entry: '', failed: true };
        log('failure', 'No lexical match in this workspace', 'Undo this attempt before trying the next rescue operation.', i, snapshot(surround([tree])), 'failure');
        continue;
      }
      lexicalize(target, found[0]);
      tree.history = { template, before: previous, option: index };
      log('lexicalize', 'Multiple Merge: ⇒ ' + found[0].lex.entry.expression,
        'F is lexicalized in this workspace. Still try every other reopened workspace.', i, snapshot(surround([tree])), 'success');
      return tree;
    }
    // Backtrack within this independent workspace before reopening its Spec.
    // Recursive replay preserves earlier cyclic spellouts and their option order.
    if (previous.clb) return multipleMerge(i, template, previous, surround, depth + 1);
    const history = previous.history;
    if (!history) return null;
    log('backtrack', 'Multiple Merge: backtrack within a workspace',
      'Undo the preceding cycle and try its next option before replaying ' + feature(template) + '.',
      i, snapshot(surround([history.before])));
    const changed = workspaceFeature(i, history.template, history.before, surround, depth + 1, history.option + 1);
    return changed ? workspaceFeature(i, template, changed, surround, depth + 1) : null;
  }
  for (let i = 0; i < cycles.length; i++) {
    let before = forest;
    const grown = !limited && settings.closure === 'late' && grow(i, before);
    if (grown) { forest = advance(before, cycles[i], grown); frames[i] = { before, options: [], next: 0, locked: true, result: forest }; continue; }
    if (settings.closure === 'late') {
      const comp = cycles[i].children.find((node) => !node.atom);
      const previous = comp && before.get(comp.key);
      if (previous?.auxOpen) {
        const closed = { ...previous, auxOpen: false };
        before = new Map(before).set(comp!.key, closed);
        log('grow', 'Close AUX before continuing on the main spine', 'The next feature cannot be lexicalized in AUX. Merge AUX as a left branch and retry that feature on the combined root.', i, before, 'success');
      }
    }
    const frame = makeFrame(i, before);
    const next = limited ? null : tryNext(i, frame);
    if (next) { forest = next; frames[i] = frame; continue; }
    if (!limited && backtrack(i)) continue;
    // Prefixes are attempted only in the current failed cycle, after ALL backtracking.
    const prefix = !limited && spawn(i, before);
    if (prefix) { forest = advance(before, cycles[i], prefix); frames[i] = { before, options: [], next: 0, locked: true, result: forest }; continue; }
    const failed = realize(cycles[i], before);
    failed.spell = { expression: '∅', entry: '', failed: true };
    forest = advance(before, cycles[i], failed);
    frames[i] = { before, options: [], next: 0, locked: true };
    log('unresolved', 'Unresolved: ' + feature(failed), limited ? 'Search limit reached. Remaining layers are assembled and coverage is checked; completion is not claimed.' : 'No direct match, rescue movement, backtracking or cyclically buildable left branch succeeded. Continue to find every remaining lexicalisation.', i, forest, 'failure');
  }
  const final = forest.get(input.key)!;
  if (final.auxOpen) {
    final.auxOpen = false;
    log('grow', 'Close AUX at the end of the input', 'No external features remain. Merge the independently lexicalized AUX and main spine in their original order.', cycles.length - 1, forest, 'success');
  }
  const { missing, surface } = coverage(final);
  if (limited) warnings.push('Search limit reached; some alternatives have not been explored.');
  const marked = new Set(missing.map((n) => n.key));
  for (const node of missing) if (!node.spell || node.spell.failed) node.spell = { expression: '∅', entry: '', failed: true };
  const finalSource = sourceOf([final], marked);
  const complete = !missing.length && !limited;
  const detail = complete ? 'Every live feature is covered by a lexical entry. Surface: ' + surface.join(' · ') : 'Unlexicalised domains: ' + missing.map((n) => n.label).join(', ') + (limited ? '. Search was limited.' : '');
  // Completion is a property of the actual last operation, never another
  // copy of the already completed tree. Retain a final snapshot only when
  // coverage marking or a search limit produces a genuinely different tree.
  const last = steps.at(-1);
  if (last && (complete || last.source === finalSource)) {
    last.source = finalSource;
    last.title = (complete ? 'Fully lexicalised · ' : 'Partial lexicalisation · ') + last.title;
    last.detail += ' ' + detail;
    last.status = complete ? 'success' : 'failure';
  } else {
    steps.push({ action: 'unresolved', title: 'Partial lexicalisation', detail, cycle: cycles.length, source: finalSource, status: 'failure' });
  }
  return { steps, source: finalSource, complete, unresolved: missing.map((n) => n.label), warnings, surface, limited };
}

/** For the panel: inspect labels without exposing the private derivation representation. */
export function nanosyntaxInputError(source: string): string | null {
  try { read(source, 's'); return null; } catch (e) { return (e as Error).message; }
}
