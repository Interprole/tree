import { effect } from '@preact/signals';
import { getEditorBridge } from './actions';
import { diffChange } from './core/format';
import { syncLinks } from './core/links';
import { activeTree, source, sources, trees } from './state';

/**
 * Keeps linked branches in line: after every change of the code being edited, a changed linked
 * branch is repeated in its other copies (in this tree and in the other trees on the canvas).
 * The repeat is not an undo step of its own: undoing the edit brings the copies back with it.
 */

const known = new Map<string, string>();
let scheduled = false;

function run() {
  scheduled = false;
  const act = activeTree.peek();
  const src = sources.peek();
  const docs = [...new Set(trees.peek().map((e) => e.srcId))].map((k) => ({ key: k, text: k === act.srcId ? source.peek() : src[k] ?? '' }));
  if (!docs.some((d) => /;link=/.test(d.text))) return;
  const changed = syncLinks(docs, act.srcId, known);
  if (!changed.size) return;
  const others: Record<string, string> = {};
  for (const [k, text] of changed) {
    if (k === act.srcId) {
      const c = diffChange(source.peek(), text);
      const bridge = getEditorBridge();
      if (c && bridge) bridge.applySilent([c]);
      else if (c) source.value = text;
    } else others[k] = text;
  }
  if (Object.keys(others).length) sources.value = { ...sources.peek(), ...others };
}

export function startLinkSync() {
  effect(() => {
    void source.value;
    void activeTree.value.srcId;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  });
}
