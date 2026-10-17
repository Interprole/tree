import { describe, expect, test } from 'vitest';
import { syncLinks, stripLinks } from '../src/core/links';
import { parse } from '../src/core/parser';

/** one sync round from the given texts; a is the tree being edited */
function sync(texts: Record<string, string>, known = new Map<string, string>(), active = 'a') {
  const out = syncLinks(Object.entries(texts).map(([key, text]) => ({ key, text })), active, known);
  const res: Record<string, string> = { ...texts };
  for (const [k, v] of out) res[k] = v;
  return res;
}

describe('linked branches', () => {
  test('an edit inside one copy is repeated in the other, in the same tree; around it nothing moves', () => {
    const before = '[S [VP;link=g [V saw] [DP Mary]] [X [VP;link=g [V saw] [DP Mary]] [Y y]]]';
    const known = new Map<string, string>();
    sync({ a: before }, known);
    const edited = before.replace('[DP Mary]]', '[DP Mary] [PP here]]');
    const out = sync({ a: edited }, known).a;
    expect(out).toBe('[S [VP;link=g [V saw] [DP Mary] [PP here]] [X [VP;link=g [V saw] [DP Mary] [PP here]] [Y y]]]');
    expect(parse(out).ok).toBe(true);
  });
  test('across trees on the canvas', () => {
    const known = new Map<string, string>();
    const t1 = '[S [NP John] [VP;link=v [V runs]]]';
    const t2 = '[CP [C that] [VP;link=v [V runs]]]';
    sync({ a: t1, b: t2 }, known);
    const out = sync({ a: t1.replace('runs', 'walks'), b: t2 }, known);
    expect(out.b).toBe('[CP [C that] [VP;link=v [V walks]]]');
  });
  test('the root keeps its own #id: a re-merged branch is linked, its re-merge is not', () => {
    const known = new Map<string, string>();
    const t1 = '[S [VP;link=v [V runs]] [X x]]';
    const t2 = '[T [VP;link=v [V runs]]]';
    sync({ a: t1, b: t2 }, known);
    const remerged = '[S [VP#vp;link=v [V runs]] [X x #vp]]';
    const out = sync({ a: remerged, b: t2 }, known);
    expect(out.b).toBe(t2);
  });
  test('ids inside keep their own names in each copy; a new one gets a free name', () => {
    const known = new Map<string, string>();
    const src = '[S [CP;link=c [DP#wh what] [VP buy #wh]] [CP;link=c [DP#wh2 what] [VP buy #wh2]]]';
    sync({ a: src }, known);
    const edited = '[S [CP;link=c [DP#wh what] [VP#vp buy #wh]] [CP;link=c [DP#wh2 what] [VP buy #wh2]]]';
    const out = sync({ a: edited }, known).a;
    expect(out).toContain('[CP;link=c [DP#wh2 what] [VP#vp2 buy #wh2]]');
    expect(parse(out).ok).toBe(true);
  });
  test('a copy of its own: no link marker', () => {
    expect(stripLinks('[VP;link=g;edge=red [V x]]')).toBe('[VP;edge=red [V x]]');
  });
});
