import { effect, signal } from '@preact/signals';

/**
 * When a setting for many (all trees, a whole tree, all copies) changes and some items have a
 * value of their own, the user decides: replace those too, or keep them. The answer can be
 * remembered ("don't ask again"), and changed later in the settings.
 */
export type OverridePolicy = 'ask' | 'replace' | 'keep';

function load(): OverridePolicy {
  try {
    const v = localStorage.getItem('nanotrees:override');
    return v === 'replace' || v === 'keep' ? v : 'ask';
  } catch {
    return 'ask';
  }
}

export const overridePolicy = signal<OverridePolicy>(typeof localStorage === 'undefined' ? 'ask' : load());
effect(() => {
  try {
    localStorage.setItem('nanotrees:override', overridePolicy.value);
  } catch {
    /* storage disabled */
  }
});

/** the question on screen */
export const question = signal<null | { message: string; answer: (replace: boolean, remember: boolean) => void }>(null);

/** a slider asks once while it is being dragged: answers stay for a moment per setting */
const recent = new Map<string, { replace: boolean; at: number }>();
const pending = new Map<string, Promise<boolean>>();

/** Replace the values of their own (true) or keep them (false)? */
export function askOverride(key: string, message: string): Promise<boolean> {
  const p = overridePolicy.value;
  if (p !== 'ask') return Promise.resolve(p === 'replace');
  // while a slider is being dragged the answer holds (each change keeps it a moment longer)
  const r = recent.get(key);
  if (r && performance.now() - r.at < 1200) {
    r.at = performance.now();
    return Promise.resolve(r.replace);
  }
  const waiting = pending.get(key);
  if (waiting) return waiting;
  const promise = new Promise<boolean>((resolve) => {
    question.value = {
      message,
      answer: (replace, remember) => {
        question.value = null;
        pending.delete(key);
        recent.set(key, { replace, at: performance.now() });
        if (remember) overridePolicy.value = replace ? 'replace' : 'keep';
        resolve(replace);
      },
    };
  });
  pending.set(key, promise);
  return promise;
}
