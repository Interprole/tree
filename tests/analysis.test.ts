import { describe, expect, test } from 'vitest';
import { cCommandDomain, dominated } from '../src/core/analysis';
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
    const md = tree('[CP [DP#1 what] [C′ [C did] [TP you [VP [V see] #1]]]]', { chains: 'multidominance' });
    const wh = md.nodes.find((n) => n.id === '1')!;
    const dom = cCommandDomain(wh);
    expect([...dom].some((n) => plain(n.label) === 'did')).toBe(true);
    expect([...dom].some((n) => plain(n.label) === 'see')).toBe(true);
  });
});
