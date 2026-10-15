/** Source-level syntax tree produced by the parser. Every element keeps its source span. */

export interface Span {
  from: number;
  to: number;
}

export interface ANode {
  kind: 'node';
  /** label text with inline markup, modifiers removed */
  label: string;
  /** span of the label text (zero-width right after "[" when the label is empty) */
  labelSpan: Span;
  /** span of the whole header token: label + modifiers (#id, *, @color) */
  headerSpan: Span;
  id?: string;
  color?: string;
  branchColor?: string;
  triangle?: boolean;
  /** span of the "^" triangle marker */
  triangleSpan?: Span;
  features?: string[];
  featureSpan?: Span;
  /** pronunciation of this occurrence of a chain: true = overt (!), false = silent (?) */
  pronounce?: boolean;
  /** semantic value: "formula : type" between $…$ */
  sem?: string;
  semSpan?: Span;
  /** header options ;key=value: edge, width, len, spread, sem */
  opts?: Record<string, string>;
  /** notes next to the node: &right"text"@dx,dy */
  notes?: ALabel[];
  /** gloss lines attached to the node itself (when there is no terminal) */
  gloss?: string[];
  children: AChild[];
  /** "[" ... "]" inclusive */
  span: Span;
}

export interface ALeaf {
  kind: 'leaf';
  text: string;
  span: Span;
  gloss: string[];
  /** span covering text and glosses */
  fullSpan: Span;
}

export interface ARef {
  kind: 'ref';
  id: string;
  /** true = pronounced (#id!), false = silent (#id?) */
  pronounce?: boolean;
  /** pronounced with other words: #wh!"whom" */
  text?: string;
  /** meaning of this position: #wh$x : e$ */
  sem?: string;
  span: Span;
}

export type LabelSide = 'auto' | 'left' | 'right' | 'above' | 'below';

/** a label of an arrow or a note of a node: side"text"@dx,dy */
export interface ALabel {
  text: string;
  side: LabelSide;
  off?: [number, number];
  span: Span;
}

export type AChild = ANode | ALeaf | ARef;

export type ArrowHead = 'end' | 'start' | 'both' | 'none';
export type ArrowLine = 'solid' | 'dashed' | 'dotted';
export type ArrowRoute = 'under' | 'curve';

export interface AArrow {
  from: string;
  to: string;
  /** a particular position of a chain: #wh/2 (1 = highest) */
  fromOcc?: number;
  toOcc?: number;
  /** "hide": suppresses the automatic arrow between these positions */
  hidden?: boolean;
  head: ArrowHead;
  line: ArrowLine;
  route: ArrowRoute;
  labels: ALabel[];
  color?: string;
  /** user offset of the control handle */
  bend?: [number, number];
  span: Span;
}

export interface ADoc {
  root: ANode | null;
  arrows: AArrow[];
  /** id -> defining node */
  ids: Map<string, ANode>;
}

export interface ParseError {
  message: string;
  from: number;
  to: number;
  /** optional secondary location (e.g. the unclosed bracket) */
  related?: Span;
}

export type ParseResult = { ok: true; doc: ADoc } | { ok: false; error: ParseError };
