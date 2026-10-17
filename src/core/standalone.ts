import type { ADoc, ANode, Span } from './ast';
import { applyChanges } from './edits';
import type { TextChange } from './edits';
import { stripLinks } from './links';
import { walkAst } from './parser';

/**
 * A branch taken out of its tree (moved or copied into another tree) must stand on its own: a copy
 * inside it whose constituent stays outside becomes the constituent itself, pronounced in full;
 * head movement and arrows to what stays behind go. And what stays behind must still make sense:
 * a silent copy of a constituent that left becomes the constituent, pronounced.
 */

const esc = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const refRe = (id: string) => new RegExp(`(?<!\\\\)#${esc(id)}(?![\\p{L}\\p{N}_\\-.:])`, 'gu');

const inside = (s: Span, span: Span) => s.from >= span.from && s.to <= span.to;

/** ids defined within a span */
function idsWithin(d: ADoc, span: Span): Set<string> {
  const out = new Set<string>();
  for (const [id, n] of d.ids) if (inside(n.span, span)) out.add(id);
  return out;
}

/** a fresh name not in used */
function fresh(id: string, used: Set<string>): string {
  let name = id;
  for (let k = 2; used.has(name); k++) name = id + k;
  used.add(name);
  return name;
}

/**
 * The text of a constituent written out in full (for a copy that becomes it): its own id kept or
 * dropped, the ids inside it renamed where taken, no link markers.
 */
function writtenOut(src: string, def: ANode, keepId: boolean, used: Set<string>, words?: string): { text: string; ids: string[] } {
  if (words !== undefined) {
    const w = words.split(/\s*\|\s*/)[0];
    return { text: `[${def.label}${keepId && def.id ? '#' + def.id : ''} ${w}]`, ids: keepId && def.id ? [def.id] : [] };
  }
  let text = stripLinks(src.slice(def.span.from, def.span.to));
  if (!keepId) text = text.replace(/^(\[[^\s[\]#;@]*)#[\p{L}\p{N}_\-.:]+[!?]?/u, '$1');
  const ids: string[] = keepId && def.id ? [def.id] : [];
  walkAst(def, (n) => {
    if (n === def || !n.id) return;
    const name = used.has(n.id) ? fresh(n.id, used) : (used.add(n.id), n.id);
    if (name !== n.id) text = text.replace(refRe(n.id), '#' + name);
    ids.push(name);
  });
  return { text, ids };
}

/** strip ;to=x where x is not one of ids */
function stripHeadMoves(text: string, keep: Set<string>): string {
  return text.replace(/;to=([\p{L}\p{N}_\-.:]+)/gu, (m, id: string) => (keep.has(id) ? m : ''));
}

/**
 * The branch at span as a piece that stands on its own in another tree: its text, the ids defined
 * in it, and the lines (arrows, position styles) that belong to it alone.
 */
export function standalonePiece(src: string, d: ADoc, span: Span): { text: string; ids: string[]; lines: string[] } {
  const own = idsWithin(d, span);
  const used = new Set(own);
  const changes: TextChange[] = [];
  const added: string[] = [];
  if (d.root) {
    walkAst(d.root, (n) => {
      if (!inside(n.span, span) && !(n.span.from <= span.from && n.span.to >= span.to)) return;
      for (const c of n.children) {
        if (c.kind !== 'ref' || !inside(c.span, span) || own.has(c.id)) continue;
        // a copy of a constituent outside: the constituent, pronounced in full
        const def = d.ids.get(c.id);
        if (!def) continue;
        const w = writtenOut(src, def, false, used, c.text);
        added.push(...w.ids);
        changes.push({ from: c.span.from - span.from, to: c.span.to - span.from, insert: w.text });
      }
    });
  }
  let text = applyChanges(src.slice(span.from, span.to), changes);
  const ids = [...own, ...added];
  // head movement to a head that stays behind; positions of chains that stay behind
  text = stripHeadMoves(text, new Set(ids));
  // lines of the branch alone: arrows between its own nodes, styles of its own positions,
  // not for chains with positions outside it
  const outsideRefs = new Set<string>();
  if (d.root) walkAst(d.root, (n) => n.children.forEach((c) => c.kind === 'ref' && own.has(c.id) && !inside(c.span, span) && outsideRefs.add(c.id)));
  const ok = (id: string) => own.has(id) && !outsideRefs.has(id);
  const lines = [
    ...d.arrows.filter((a) => ok(a.from) && ok(a.to)).map((a) => src.slice(a.span.from, a.span.to)),
    ...d.posStyles.filter((p) => ok(p.id)).map((p) => src.slice(p.span.from, p.span.to)),
  ];
  return { text, ids, lines };
}

/** a whole line, with its line break */
function lineRange(src: string, s: Span): TextChange {
  let from = s.from;
  let to = s.to;
  while (to < src.length && src[to] !== '\n') to++;
  if (src[from - 1] === '\n') from--;
  return { from, to, insert: '' };
}

/**
 * The tree after the branch at span left it: the highest remaining copy of a constituent that left
 * becomes the constituent (pronounced); arrows and position styles of what left go; head movement
 * to what left goes.
 */
export function withoutBranch(src: string, d: ADoc, span: Span): string {
  const own = idsWithin(d, span);
  let f = span.from;
  while (f > 0 && (src[f - 1] === ' ' || src[f - 1] === '\t')) f--;
  if (src[f - 1] === '\n' && (src[span.to] === '\n' || span.to >= src.length)) f--;
  const changes: TextChange[] = [{ from: f, to: span.to, insert: '' }];
  const used = new Set(d.ids.keys());
  const done = new Set<string>();
  if (d.root) {
    walkAst(d.root, (n) => {
      if (inside(n.span, span)) return;
      for (const c of n.children) {
        if (c.kind !== 'ref' || !own.has(c.id) || inside(c.span, span) || done.has(c.id)) continue;
        // the highest copy left behind (document order) becomes the constituent, with its id
        done.add(c.id);
        const def = d.ids.get(c.id)!;
        const w = writtenOut(src, def, true, used, c.text);
        changes.push({ from: c.span.from, to: c.span.to, insert: w.text });
      }
      // head movement to a head that left
      if (n.opts?.to && own.has(n.opts.to)) {
        const k = src.indexOf(';to=' + n.opts.to, n.headerSpan.from);
        if (k >= 0 && k < n.headerSpan.to) changes.push({ from: k, to: k + 4 + n.opts.to.length, insert: '' });
      }
    });
  }
  for (const a of d.arrows) if (own.has(a.from) || own.has(a.to)) changes.push(lineRange(src, a.span));
  for (const p of d.posStyles) if (own.has(p.id)) changes.push(lineRange(src, p.span));
  const sorted = changes.sort((a, b) => a.from - b.from);
  const out: TextChange[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.from < last.to) continue;
    out.push(c);
  }
  return applyChanges(src, out);
}
