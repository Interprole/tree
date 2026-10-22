import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { addToTreeGroup, assignLexicalTree, createTreeGroup, groupAssignment, groupTrees, lexicalAssignment, treeGroups, treeTargetPick, trees, unassignLexicalTree, visibleTrees } from '../state';

export function TreeAssignmentDialogs() {
  const lexical = lexicalAssignment.value;
  const grouping = groupAssignment.value;
  if (lexical) return <LexicalDialog key={lexical} id={lexical} />;
  if (grouping) return <GroupDialog key={grouping} id={grouping} />;
  return null;
}

function LexicalDialog({ id }: { id: string }) {
  const entry = trees.value.find((tree) => tree.id === id)!;
  const target = useSignal(entry.lexical?.owner ?? 'canvas');
  const close = () => lexicalAssignment.value = null;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  return <div class="modal-backdrop"><div class="modal ask" role="dialog" aria-modal="true" aria-label="Lexical assignment"><div class="modal-body">
    <h3>{entry.lexical ? 'Change L-tree scope' : 'Use as an L-tree'} · {entry.name}</h3>
    <label class="insp-field"><span>Lexicon</span><select aria-label="L-tree scope" value={target.value} onChange={(event) => target.value = event.currentTarget.value}>
      <option value="canvas">Whole canvas</option>{trees.value.filter((tree) => tree.id !== id && !tree.lexical && !tree.derivation).map((tree) => <option key={tree.id} value={tree.id}>{tree.name}</option>)}
    </select></label>
    <button class="btn" onClick={() => { treeTargetPick.value = { kind: 'lexical', id }; close(); }}>Pick an S-tree on the canvas</button>
    <div class="row wrap"><button class="btn primary" onClick={() => { assignLexicalTree(id, target.value === 'canvas' ? 'canvas' : 'tree', target.value === 'canvas' ? undefined : target.value); close(); }}>Apply</button>
      {entry.lexical && <button class="btn" onClick={() => { unassignLexicalTree(id); close(); }}>Stop using as an L-tree</button>}
      <button class="btn ghost" onClick={close}>Cancel</button></div>
  </div></div></div>;
}

function GroupDialog({ id }: { id: string }) {
  const target = useSignal('');
  const close = () => groupAssignment.value = null;
  return <div class="modal-backdrop"><div class="modal ask" role="dialog" aria-modal="true" aria-label="Group trees"><div class="modal-body">
    <h3>Add tree to a group</h3>
    <label class="insp-field"><span>Group or tree</span><select aria-label="Group or tree" value={target.value} onChange={(event) => target.value = event.currentTarget.value}>
      <option value="">New group</option>
      {treeGroups.value.filter((group) => !group.nanosyntax).map((group) => <option key={group.id} value={'group:' + group.id}>{group.name}</option>)}
      {visibleTrees.value.filter((tree) => tree.id !== id).map((tree) => <option key={tree.id} value={'tree:' + tree.id}>Group with {tree.name}</option>)}
    </select></label>
    <button class="btn" onClick={() => { treeTargetPick.value = { kind: 'group', id }; close(); }}>Pick another tree or group on the canvas</button>
    <div class="row"><button class="btn primary" onClick={() => {
      if (target.value.startsWith('group:')) addToTreeGroup(id, target.value.slice(6));
      else if (target.value.startsWith('tree:')) groupTrees(id, target.value.slice(5));
      else createTreeGroup([id]);
      close();
    }}>Apply</button><button class="btn ghost" onClick={close}>Cancel</button></div>
  </div></div></div>;
}
