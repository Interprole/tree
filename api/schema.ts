import type { BuildOptions } from '../src/core/build';
import { defaultBuildOptions } from '../src/core/build';
import type { NSAlgorithm, NSAlgorithmSettings } from '../src/core/nanosyntax';
import { resolveNSAlgorithm } from '../src/core/nanosyntax';
import { defaultStyle, FONT_FAMILIES } from '../src/core/style';
import type { TreeStyle } from '../src/core/style';

export const LIMITS = { bodyBytes: 1_048_576, sourceLength: 50_000, sourceDepth: 96, displayNodes: 400, lexiconEntries: 128, imagePixels: 16_777_216, imageSide: 16_384, maxAttempts: 1800, maxSteps: 700 };
export type Operation = 'analyze' | 'render' | 'derive';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export interface Schema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: false;
  items?: Schema; enum?: readonly (string | number | boolean)[]; anyOf?: Schema[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; default?: unknown; description?: string;
}
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
const number = (minimum: number, maximum: number): Schema => ({ type: 'number', minimum, maximum });
const bool: Schema = { type: 'boolean' };
const sourceSchema: Schema = { type: 'string', minLength: 1, maxLength: LIMITS.sourceLength };
export const buildSchema = object({
  mode: choice('manual', 'xbar'), chains: choice('copies', 'traces', 'multidominance'),
  xbar: object({ bar: choice('always', 'auto', 'never'), headLabel: choice('X', 'X0'), emptySpecs: bool, barStyle: choice('prime', 'bar'), expandWords: bool }),
  chainArrows: bool, chainIndices: bool, headArrows: bool, showEmpty: bool, lexicalTree: bool,
  semantics: object({ show: bool, compute: bool, types: bool, rules: bool }),
});
const styleProperties: Record<string, Schema> = {};
for (const [key, value] of Object.entries(defaultStyle)) {
  styleProperties[key] = typeof value === 'boolean' ? bool : typeof value === 'number' ? number(0, 240) : { type: 'string', minLength: 1, maxLength: 64 };
}
Object.assign(styleProperties, {
  font: choice(...Object.keys(FONT_FAMILIES)), fontSize: number(6, 96), padding: number(0, 160),
  lineWidth: number(0, 20), arrowWidth: number(0, 20), sheetWidth: number(0, 8192), sheetHeight: number(0, 8192),
  linePattern: choice('solid', 'dashed', 'dotted'), arrowPattern: choice('solid', 'dashed', 'dotted'), copyStyle: choice('regular', 'gray', 'strike', 'angle'),
});
export const styleSchema = object(styleProperties);
export const algorithmSchema: Schema = { anyOf: [
  choice('starke2018', 'caha2019', 'caha2019mm', 'caha2025'),
  object({ movement: choice('starke2018', 'caha2025'), closure: choice('late', 'early'), backtracking: choice('aux-only', 'multiple-merge') }),
] };
const common = { source: sourceSchema, build: buildSchema, style: styleSchema };
export const requestSchemas: Record<Operation, Schema> = {
  analyze: object(common, ['source']),
  render: object({ ...common, format: { ...choice('svg', 'png', 'pdf', 'latex'), default: 'svg' }, scale: { ...number(1, 6), default: 2 }, transparent: bool, embedFonts: { ...bool, default: true },
    latex: object({ format: { ...choice('forest', 'qtree', 'tikz'), default: 'forest' }, standalone: { ...bool, default: true } }),
  }, ['source']),
  derive: object({ source: sourceSchema, lexicon: { type: 'array', minItems: 1, maxItems: LIMITS.lexiconEntries, items: object({ id: { type: 'string', minLength: 1, maxLength: 100 }, expression: { type: 'string', minLength: 1, maxLength: 1000 }, source: sourceSchema }, ['source']) },
    algorithm: { ...algorithmSchema, default: 'caha2025' }, options: object({ maxAttempts: { type: 'integer', minimum: 1, maximum: LIMITS.maxAttempts }, maxSteps: { type: 'integer', minimum: 3, maximum: LIMITS.maxSteps } }),
  }, ['source', 'lexicon']),
};

export function validate(schema: Schema, input: unknown, path = 'request'): void {
  const fail = (expected: string): never => { throw new ApiError(400, 'INVALID_REQUEST', `${path}: ${expected}`); };
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { validate(s, input, path); return true; } catch { return false; } })) fail('does not match any supported value or object');
    return;
  }
  if (schema.enum && !schema.enum.includes(input as string)) fail(`expected one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected an object');
    const record = input as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) fail(`missing ${key}`);
    for (const [key, value] of Object.entries(record)) {
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : undefined;
      if (!child && schema.additionalProperties === false) fail(`unknown field ${key}`);
      if (child) validate(child, value, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(input)) fail('expected an array');
    const array = input as unknown[];
    if (array.length < (schema.minItems ?? 0) || array.length > (schema.maxItems ?? Infinity)) fail(`expected ${schema.minItems ?? 0}–${schema.maxItems ?? 'unlimited'} items`);
    if (schema.items) array.forEach((value, index) => validate(schema.items!, value, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof input !== 'string') fail('expected a string');
    const length = (input as string).length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) fail(`expected ${schema.minLength ?? 0}–${schema.maxLength ?? 'unlimited'} characters`);
  } else if (schema.type === 'boolean') {
    if (typeof input !== 'boolean') fail('expected a boolean');
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof input !== 'number' || !Number.isFinite(input) || (schema.type === 'integer' && !Number.isInteger(input))) fail(`expected a finite ${schema.type}`);
    if ((input as number) < (schema.minimum ?? -Infinity) || (input as number) > (schema.maximum ?? Infinity)) fail(`expected ${schema.minimum}–${schema.maximum}`);
  }
}
export interface TreeRequest { source: string; build: BuildOptions; style: TreeStyle }
export interface RenderRequest extends TreeRequest { format: 'svg' | 'png' | 'pdf' | 'latex'; scale: number; transparent: boolean; embedFonts: boolean; latex: { format: 'forest' | 'qtree' | 'tikz'; standalone: boolean } }
export interface DeriveRequest { source: string; lexicon: { id: string; expression?: string; source: string }[]; algorithm: NSAlgorithmSettings; options: { maxAttempts?: number; maxSteps?: number } }
export type PreparedRequest = TreeRequest | RenderRequest | DeriveRequest;
function checkDepth(source: string): void {
  let depth = 0, quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c === '%') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (!quoted && c === '[' && ++depth > LIMITS.sourceDepth) throw new ApiError(422, 'INPUT_TOO_COMPLEX', `Use at most ${LIMITS.sourceDepth} bracket levels.`);
    if (!quoted && c === ']') depth--;
  }
}
export function prepare(operation: Operation, input: unknown): PreparedRequest {
  validate(requestSchemas[operation], input);
  const body = input as Record<string, unknown>;
  const source = body.source as string;
  checkDepth(source);
  if (operation === 'derive') {
    const entries = body.lexicon as { id?: string; expression?: string; source: string }[];
    const lexicon = entries.map((entry, i) => { checkDepth(entry.source); return { ...entry, id: entry.id ?? `l${i + 1}` }; });
    if (new Set(lexicon.map(e => e.id)).size !== lexicon.length) throw new ApiError(400, 'INVALID_REQUEST', 'Lexical entry ids must be unique.');
    return { source, lexicon, algorithm: { ...resolveNSAlgorithm('caha2025'), ...(typeof body.algorithm === 'object' ? body.algorithm as Partial<NSAlgorithmSettings> : resolveNSAlgorithm((body.algorithm ?? 'caha2025') as NSAlgorithm)) }, options: body.options ?? {} } as DeriveRequest;
  }
  const b = (body.build ?? {}) as Partial<BuildOptions>, s = (body.style ?? {}) as Partial<TreeStyle>;
  const tree = { source, build: { ...defaultBuildOptions, ...b, xbar: { ...defaultBuildOptions.xbar, ...b.xbar }, semantics: { ...defaultBuildOptions.semantics, ...b.semantics } }, style: { ...defaultStyle, ...s } };
  return operation === 'analyze' ? tree : { ...tree, format: body.format ?? 'svg', scale: body.scale ?? 2, transparent: body.transparent ?? false, embedFonts: body.embedFonts ?? true, latex: { format: 'forest', standalone: true, ...(body.latex as object ?? {}) } } as RenderRequest;
}
export type BackendResult =
  | { ok: true; kind: 'json'; data: unknown }
  | { ok: true; kind: 'file'; data: string; encoding: 'utf8' | 'base64'; mime: string; extension: string; width: number; height: number }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };
export interface Backend { run(operation: Operation, request: PreparedRequest): Promise<BackendResult>; close(): Promise<void> }
