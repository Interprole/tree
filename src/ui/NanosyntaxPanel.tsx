import { activeTree, appearanceScope, canvasNanosyntaxOptions, effectiveNanosyntaxOptions, nanosyntaxOwner, setNanosyntaxOptions } from '../state';
import type { NSAlgorithmSettings } from '../core/nanosyntax';
import { resolveNSAlgorithm } from '../core/nanosyntax';
import { applyNanosyntaxRules, derivationError } from '../nanosyntax';

const starke = 'https://doi.org/10.1093/oso/9780190876746.003.0009';
const caha = 'https://ling.auf.net/lingbuzz/004875';
const revised = 'https://doi.org/10.1093/9780198947158.003.0001';
function Steps({ items }: { items: string[] }) {
  return <ol class="ns-algorithm-description">{items.map((item) => <li key={item}>{item}</li>)}</ol>;
}
function Source({ url, children }: { url: string; children: string }) {
  return <a href={url} target="_blank" rel="noreferrer">{children}</a>;
}

export function NanosyntaxPanel() {
  const scope = appearanceScope;
  const owner = nanosyntaxOwner(activeTree.value);
  const settings = resolveNSAlgorithm((scope.value === 'canvas' ? canvasNanosyntaxOptions.value : effectiveNanosyntaxOptions(owner)).algorithm);
  const update = (patch: Partial<NSAlgorithmSettings>) => void applyNanosyntaxRules(scope.value, patch, owner.id);
  const own = !!owner.nanosyntax?.algorithm || !!Object.keys(owner.nanosyntax?.rules ?? {}).length;
  return <div class="nanosyntax-panel" data-testid="nanosyntax-panel">
    <div class="scope ns-settings-scope">
      <div class="seg small" role="group" aria-label="Nanosyntax settings scope">
        <button class={scope.value === 'tree' ? 'on' : ''} onClick={() => scope.value = 'tree'}>This tree</button>
        <button class={scope.value === 'canvas' ? 'on' : ''} onClick={() => scope.value = 'canvas'}>Whole canvas</button>
      </div>
      {own && <button class="btn small" onClick={() => setNanosyntaxOptions('tree', { algorithm: undefined, rules: undefined }, owner.id)}>Use canvas settings for this tree</button>}
      {scope.value === 'canvas' && own && <p class="hint">This tree has its own settings. Canvas changes use Customize’s Ask / Replace / Keep policy.</p>}
    </div>
    <section class="insp-group" data-testid="movement-rules">
      <label class="insp-field"><span>1. Spellout-driven movement</span><select aria-label="Spellout-driven movement" value={settings.movement} onChange={(event) => update({ movement: event.currentTarget.value as NSAlgorithmSettings['movement'] })}>
        <option value="starke2018">Starke 2018 · spec-to-spec, then complement</option>
        <option value="caha2025">Caha et al. 2025 · non-remnant evacuation</option>
      </select></label>
      <Steps items={settings.movement === 'starke2018' ? [
        'Merge the next feature F and try direct lexicalization of FP.',
        'If spellout fails, try spec-to-spec movement: evacuate the specifier introduced in the preceding cycle. Retry spellout of the remnant FP.',
        'If that fails, undo that attempt and move the whole complement of F (snowball movement). Retry spellout of the remnant FP.',
        'If both movements fail, backtrack to an earlier cycle and try its next option. Only after backtracking fails, build a new auxiliary workspace providing F and merge it as a complex left branch.',
      ] : [
        'Merge the next feature F and try direct lexicalization of FP.',
        'If spellout fails, evacuate the closest labelled non-remnant constituent and retry spellout. A remnant is a constituent from which material has already been extracted; an unlabelled Merge node cannot be the initial target.',
        'If that fails, undo the attempt and evacuate the immediately dominating constituent instead (pied-piping). Repeat with successively larger containing constituents, retrying spellout each time.',
        'This derives the order of spec and complement movement and also permits subextraction from inside a complex specifier. After evacuation fails, try backtracking, then a new auxiliary workspace as the last resort.',
      ]} />
      {settings.movement === 'starke2018'
        ? <Source url={starke}>Starke 2018 · §9.2, (1)–(2), pp. 245–246</Source>
        : <Source url={revised}>De Clercq, Caha, Starke & Vanden Wyngaerd 2025 · §1.6, (45), pp. 33–37</Source>}
    </section>
    <section class="insp-group" data-testid="closure-rules">
      <label class="insp-field"><span>2. Auxiliary workspace closure</span><select aria-label="Auxiliary workspace closure" value={settings.closure} onChange={(event) => update({ closure: event.currentTarget.value as NSAlgorithmSettings['closure'] })}>
        <option value="late">Starke 2018 · Late Closure</option>
        <option value="early">Caha 2019 · Early Closure</option>
      </select></label>
      <Steps items={settings.closure === 'late' ? [
        'After building a lexicalizable auxiliary phrase (AUX), keep its workspace open.',
        'Try the next feature in AUX first, using the selected movement and spellout procedure. Keep growing AUX while this succeeds.',
        'When AUX cannot grow further, close it, merge it before the main spine, and try the next feature on the combined tree.',
      ] : [
        'Close AUX as soon as its phrase can lexicalize. Immediately merge it as a left branch of the main tree.',
        'Merge the next external feature on the combined root. Try direct spellout and the selected movement options there first.',
        'Reopen AUX only if later failure triggers backtracking to its Spec-formation stage. What receives F at that point is controlled by choice 3.',
      ]} />
      {settings.closure === 'late'
        ? <Source url={starke}>Starke 2018 · tentative proposal in §9.3, pp. 248–249</Source>
        : <Source url={caha}>Caha 2019 · §6.4, (36); §6.5, (73), pp. 168–181</Source>}
      <p class="hint">The 2025 revision of evacuation in chapter 1 does not impose a single closure policy. Chapter 7 of the same book (Demonie) discusses Late Closure, Early Closure and Multiple Merge, including its rule in §7.5, (39), pp. 240–243.</p>
      <Source url="https://doi.org/10.1093/9780198947158.003.0007">Demonie 2025 · chapter 7, §7.5 and footnote 10</Source>
    </section>
    <section class="insp-group" data-testid="backtracking-rules">
      <label class="insp-field"><span>3. Merge F after workspace reopening</span><select aria-label="Merge F after workspace reopening" value={settings.backtracking} onChange={(event) => update({ backtracking: event.currentTarget.value as NSAlgorithmSettings['backtracking'] })}>
        <option value="aux-only">AUX only · Caha 2019, chapter 6</option>
        <option value="multiple-merge">Every reopened workspace · Multiple Merge</option>
      </select></label>
      <Steps items={settings.backtracking === 'aux-only' ? [
        'When spellout and movement fail, return to the preceding cycle and try its next option. Replay later cycles after a successful alternative.',
        'If backtracking reaches the Spec-formation stage, separate AUX from the main spine and try F in AUX only, including movement rescue.',
        'F must co-spellout with material of the old Spec. If that fails, opening a new AUX for F is the last resort. If it succeeds, recombine the branches under the selected closure policy.',
      ] : [
        'Backtrack to the preceding cycle and try its next option. If this fails at the Spec stage, reopen the auxiliary workspace and the main spine.',
        'Merge F independently in EVERY reopened workspace. Apply the same spellout, movement and backtracking procedure in each. Reopening a deeper Spec repeats Multiple Merge recursively.',
        'F must lexicalize in at least one workspace. Keep all successful occurrences of F; undo the failed occurrences. F can survive in one workspace or several.',
        'If F fails in every workspace, undo the attempts and open a new AUX for F as the last resort. Otherwise recombine the workspaces in their original order; the selected closure policy governs the next cycle.',
      ]} />
      <Source url={caha}>{settings.backtracking === 'aux-only' ? 'Caha 2019 · §6.5, (73), (104), pp. 180–195' : 'Caha 2019 · §7.3, (14)–(19), pp. 204–206'}</Source>
      <p class="hint">Multiple Merge is also discussed in chapter 7 of Nanosyntax and the Lexicalization Algorithm (2025), §7.5, (39), pp. 240–243.</p>
      <Source url="https://doi.org/10.1093/9780198947158.003.0007">Demonie 2025 · chapter 7, §7.5: Multiple Merge</Source>
      {settings.backtracking === 'multiple-merge' && <p class="hint">Caha’s chapter 7 combines Multiple Merge with Early Closure. Combining it with Late Closure here is a selectable extension.</p>}
    </section>
    <section class="insp-group">
      <p class="hint">At each spellout attempt, the entire constituent must match a constituent of an L-tree (Superset Principle). The match with the fewest unused features wins (Elsewhere Condition).</p>
      {derivationError.value && <p class="pop-error" role="alert">{derivationError.value}</p>}
    </section>
  </div>;
}
