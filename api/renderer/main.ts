import { buildTree } from '../../src/core/build';
import { colorHex, exportLatex } from '../../src/core/latex';
import { canvasMeasure } from '../../src/core/measure';
import { deriveNanosyntax, derivationDisplaySource } from '../../src/core/nanosyntax';
import { parse, lineCol } from '../../src/core/parser';
import { plain } from '../../src/core/richtext';
import { buildSheetScene } from '../../src/core/scene';
import { fontCss } from '../../src/core/style';
import { installFontFaces, loadFont } from '../../src/fonts';
import { svgString, pngBlob, pdfBlob } from '../../src/export';
import { ApiError, LIMITS } from '../schema';
import type { BackendResult, DeriveRequest, Operation, PreparedRequest, RenderRequest, TreeRequest } from '../schema';

installFontFaces();
function parsed(source: string) {
  const result = parse(source);
  if (!result.ok) throw new ApiError(422, 'INVALID_TREE', result.error.message, { ...result.error, ...lineCol(source, result.error.from) });
  if (!result.doc.root) throw new ApiError(422, 'INVALID_TREE', 'Enter a non-empty bracket tree.');
  return result.doc;
}
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
async function execute(operation: Operation, request: PreparedRequest): Promise<BackendResult> {
  try {
    if (operation === 'derive') {
      const input = request as DeriveRequest;
      parsed(input.source);
      const entries = input.lexicon.map(entry => {
        const doc = parsed(entry.source), expression = entry.expression ?? doc.root?.opts?.spell;
        if (!expression?.trim()) throw new ApiError(422, 'INVALID_LEXICON', `L-tree ${entry.id} needs an expression or ;spell="…" on its root.`);
        return { ...entry, expression };
      });
      let result;
      try { result = deriveNanosyntax(input.source, entries, input.algorithm, input.options); }
      catch (error) { throw new ApiError(422, 'INVALID_DERIVATION', (error as Error).message); }
      return { ok: true, kind: 'json', data: { ...result, source: derivationDisplaySource(result.source, 'done'), algorithm: input.algorithm, steps: result.steps.map(step => ({ ...step, source: derivationDisplaySource(step.source, step.action), ...(step.workspaces ? { workspaces: step.workspaces.map(source => derivationDisplaySource(source, step.action)) } : {}) })) } };
    }
    const input = request as TreeRequest;
    for (const key of ['lineColor', 'nodeColor', 'leafColor', 'arrowColor', 'semColor', 'semComputedColor', 'background'] as const) {
      const color = input.style[key];
      if (!(key === 'background' && color === 'transparent') && !colorHex(color)) throw new ApiError(400, 'INVALID_REQUEST', `style.${key}: use a supported named colour or #RGB/#RRGGBB.`);
    }
    // Analysis returns semantic metadata even when its visual labels are hidden.
    const build = operation === 'analyze' ? { ...input.build, semantics: { ...input.build.semantics, types: true, rules: true } } : input.build;
    const tree = buildTree(parsed(input.source), build)!;
    if (tree.nodes.length > LIMITS.displayNodes) throw new ApiError(422, 'INPUT_TOO_COMPLEX', `Use at most ${LIMITS.displayNodes} display nodes.`);
    if (operation === 'analyze') return { ok: true, kind: 'json', data: {
      root: tree.root.key,
      nodes: tree.nodes.map(n => ({ key: n.key, id: n.id, kind: n.kind, label: plain(n.label), runs: n.label, children: n.children.map(c => c.key), parents: n.parents.map(p => p.key), copy: !!n.copy, trace: !!n.trace, synthetic: !!n.synthetic, chain: n.chainRef,
        features: n.features?.map(plain), gloss: n.gloss?.map(plain), spellout: n.spellout ? { ...n.spellout, expression: plain(n.spellout.runs) } : undefined,
        meaning: n.sem ? { ...n.sem, text: plain(n.sem.runs) } : undefined,
      })),
      arrows: tree.arrows.map(a => ({ from: a.from.key, to: a.to.key, head: a.head, line: a.line, automatic: !!a.auto, plain: !!a.plain, chain: a.chain, headMovement: a.headMove })),
      warnings: tree.nodes.filter(n => n.sem?.error).map(n => ({ node: n.key, message: n.sem!.error })),
      build,
    } };
    const render = input as RenderRequest;
    await loadFont(input.style.font);
    await Promise.all(['', 'italic ', '700 '].map(prefix => document.fonts.load(`${prefix}20px ${fontCss(input.style.font)}`, input.source)));
    await document.fonts.load('20px "NanoTrees Symbols"', input.source);
    const scene = buildSheetScene(tree, input.style, canvasMeasure(fontCss));
    const scale = render.format === 'png' ? render.scale : 1;
    if (![scene.width, scene.height].every(v => Number.isFinite(v) && v > 0 && v * scale <= LIMITS.imageSide) || scene.width * scene.height * scale * scale > LIMITS.imagePixels) throw new ApiError(422, 'IMAGE_TOO_LARGE', 'Reduce the tree size, sheet dimensions, or PNG scale.');
    const common = { ok: true as const, kind: 'file' as const, width: scene.width, height: scene.height };
    if (render.format === 'svg') return { ...common, encoding: 'utf8', data: await svgString(scene, { embedFonts: render.embedFonts, transparent: render.transparent }), mime: 'image/svg+xml', extension: 'svg' };
    if (render.format === 'latex') return { ...common, encoding: 'utf8', data: exportLatex(tree, scene, input.style, render.latex), mime: 'application/x-tex', extension: 'tex' };
    const blob = render.format === 'png' ? await pngBlob(scene, render.scale, render.transparent) : await pdfBlob(scene, render.transparent);
    return { ...common, encoding: 'base64', data: await base64(blob), mime: blob.type, extension: render.format };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, status: error.status, error: { code: error.code, message: error.message, details: error.details } };
    return { ok: false, status: 500, error: { code: 'RENDER_FAILED', message: (error as Error).message || 'Could not process the tree.' } };
  }
}
Object.assign(window, { nanotreesApi: { execute } });
