/** Legacy outline metadata remains readable while shape tools are unavailable. */
export type OutlineKind = 'circle' | 'square' | 'oval';
export interface Outline {
  id: string;
  kind: OutlineKind;
  scope: 'node' | 'branch';
  color?: string;
  width?: number;
  line?: 'solid' | 'dashed' | 'dotted';
  padding?: number;
}

/** ;outline="s1 oval branch red 2 dashed 8|s2 circle node".
 * A dash leaves a field inherited from Customize. */
export function parseOutlines(value = ''): Outline[] {
  return value.split('|').flatMap((entry) => {
    const [id, kind, scope = 'node', color, width, line, padding] = entry.trim().split(/\s+/);
    if (!id || !['circle', 'square', 'oval'].includes(kind) || !['node', 'branch'].includes(scope)) return [];
    return [{ id, kind: kind as OutlineKind, scope: scope as Outline['scope'],
      color: color && color !== '-' ? color : undefined,
      width: width && width !== '-' && Number.isFinite(+width) ? Math.max(0, +width) : undefined,
      line: line === 'solid' || line === 'dashed' || line === 'dotted' ? line : undefined,
      padding: padding && padding !== '-' && Number.isFinite(+padding) ? Math.max(0, +padding) : undefined,
    }];
  });
}
export function outlineSource(outlines: Outline[]): string {
  return outlines.map((s) => [s.id, s.kind, s.scope, s.color ?? '-', s.width ?? '-', s.line ?? '-', s.padding ?? '-'].join(' ').replace(/(?: -)+$/, '')).join('|');
}
