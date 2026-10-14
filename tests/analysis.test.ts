import { describe, expect, test } from 'vitest';
import { cCommandDomain, checkBinding, dominated } from '../src/core/analysis';
import { plain } from '../src/core/richtext';
import { tree } from './helpers';

const labels = (s: Set<{ label: { text: string }[] }>) => [...s].map((n) => plain(n.label as never)).sort();

describe('c-command and dominance', () => {
  const t = tree('[S [NP John] [VP [V saw] [NP Mary]]]');
  const find = (l: string) => t.nodes.find((n) => plain(n.label) === l)!;
  test('subject c-commands the VP and everything in it', () => {
    expect(labels(cCommandDomain(find('NP')) as never)).toEqual(['Mary', 'NP', 'V', 'VP', 'saw']);
  });
  test('verb c-commands only its complement', () => {
    expect(labels(cCommandDomain(find('V')) as never)).toEqual(['Mary', 'NP']);
  });
  test('dominance', () => {
    expect(labels(dominated(find('VP')) as never)).toEqual(['Mary', 'NP', 'V', 'saw']);
  });
  test('multidominated node c-commands from every position', () => {
    const md = tree('[CP [DP#1 what] [C′ [C did] [TP you [VP [V see] #1]]]]');
    const wh = md.nodes.find((n) => n.id === '1')!;
    const dom = cCommandDomain(wh);
    expect([...dom].some((n) => plain(n.label) === 'did')).toBe(true);
    expect([...dom].some((n) => plain(n.label) === 'see')).toBe(true);
  });
});

describe('binding principles', () => {
  const res = (src: string) => checkBinding(tree(src)).map((r) => `${r.principle}:${r.ok ? 'ok' : 'violated'}`);
  test('Principle A satisfied locally', () => {
    expect(res('[TP [DP_i John] [VP [V likes] [DP himself_i]]]')).toContain('A:ok');
  });
  test('Principle A violated across a clause boundary', () => {
    expect(res('[TP [DP_i John] [VP thinks [CP that [TP [DP Bill] [VP likes [DP himself_i]]]]]]')).toContain('A:violated');
  });
  test('Principle B', () => {
    expect(res('[TP [DP_i John] [VP [V likes] [DP him_i]]]')).toContain('B:violated');
    expect(res('[TP [DP_i John] [VP thinks [CP that [TP [DP Mary] [VP likes [DP him_i]]]]]]')).toContain('B:ok');
  });
  test('Principle C', () => {
    expect(res('[TP [DP_i He] [VP [V likes] [DP John_i]]]')).toContain('C:violated');
    expect(res('[TP [DP [D His_i] [N mother]] [VP [V likes] [DP John_i]]]')).toContain('C:ok');
  });
  test('Russian anaphor', () => {
    expect(res('[TP [DP_i Ваня] [VP [V любит] [DP себя_i]]]')).toContain('A:ok');
  });
  test('traces are ignored', () => {
    expect(checkBinding(tree('[CP [DP_i who] [TP you [VP saw [DP t_i]]]]')).every((r) => plain(r.node.label) !== 'ti')).toBe(true);
  });
});
