/**
 * The members `K` of `T`, with any return type — for the hand-written fakes
 * the tests use in place of Cavi, World or Wire: a fake declared as
 * `class FakeCavi implements Fake<Cavi, 'addWire' | ...>` stops compiling
 * when one of those members is renamed or removed in the real class, or
 * its parameters change type, instead of silently testing against an API
 * that no longer exists. Return types are left free, since fakes return
 * other fakes.
 */
export type Fake<T, K extends keyof T> = {
  [P in K]: T[P] extends (...args: infer A) => unknown ? (...args: A) => unknown : T[P];
};
