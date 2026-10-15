import { describe, expect, test } from 'vitest';
import { compose, parseMeaning, parseTerm, reduce, show, showTy, typeOf, SemError } from '../src/core/semantics';

const m = (s: string) => parseMeaning(s);
const c = (a: string, b: string) => {
  const r = compose(m(a), m(b));
  return `${r.rule}: ${show(r.term)} : ${showTy(r.ty)}`;
};

describe('parsing and typing', () => {
  test('λ-terms with typed and default variables', () => {
    const t = parseTerm('λx_e.λe_s. agent(e)(x)');
    expect(showTy(typeOf(t))).toBe('⟨e,⟨s,t⟩⟩');
    expect(showTy(typeOf(parseTerm('λx. cat(x)')))).toBe('⟨e,t⟩');
    expect(showTy(typeOf(parseTerm('λe. run(e)')))).toBe('⟨s,t⟩');
    expect(showTy(typeOf(parseTerm('\\lambda P. \\exists x. P(x)')))).toBe('⟨⟨e,t⟩,t⟩');
  });
  test('declared types', () => {
    expect(showTy(m('mary : e').ty)).toBe('e');
    expect(showTy(m('dog : <e,t>').ty)).toBe('⟨e,t⟩');
    expect(() => m('λx. cat(x) : <e,<e,t>>')).toThrow(SemError);
  });
  test('β-reduction is capture-avoiding', () => {
    const t = reduce(parseTerm('(λy. λx. like(x, y))(x)'));
    expect(show(t)).toBe('λx′. like(x′, x)');
  });
});

describe('composition rules', () => {
  test('Functional Application (either order)', () => {
    expect(c('λx. sleep(x) : <e,t>', 'mary : e')).toBe('FA: sleep(mary) : t');
    expect(c('mary : e', 'λx. sleep(x)')).toBe('FA: sleep(mary) : t');
    expect(c('λP. λQ. ∀x. P(x) → Q(x)', 'λx. dog(x)')).toBe('FA: λQ. ∀x. dog(x) → Q(x) : ⟨⟨e,t⟩,t⟩');
  });
  test('Predicate Conjunction', () => {
    expect(c('λx. gray(x)', 'λx. cat(x)')).toBe('PC: λx. gray(x) ∧ cat(x) : ⟨e,t⟩');
    expect(c('λx. λy. love(x)(y) : <e,<e,t>>', 'λx. λy. know(x)(y)')).toBe('PC: λx. λy. love(x)(y) ∧ know(x)(y) : ⟨e,⟨e,t⟩⟩');
  });
  test('Event Identification (Kratzer 1996)', () => {
    expect(c('λx_e.λe_s. agent(e)(x)', 'λe_s. feed(e) ∧ theme(e)(dog)')).toBe('EI: λx. λe. agent(e)(x) ∧ feed(e) ∧ theme(e)(dog) : ⟨e,⟨s,t⟩⟩');
  });
  test('Event Identification only for ⟨e,⟨s,t⟩⟩ + ⟨s,t⟩', () => {
    expect(() => compose(m('λx. λy. love(x)(y)'), m('λe. run(e)'))).toThrow(/No composition rule/);
  });
  test('Function Composition', () => {
    expect(c('λp_t. ¬p', 'λx. sleep(x)')).toBe('FC: λx. ¬sleep(x) : ⟨e,t⟩');
  });
  test('type mismatch error', () => {
    expect(() => compose(m('mary : e'), m('john : e'))).toThrow(/No composition rule applies to e and e/);
  });
});
