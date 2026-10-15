import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * <cavi-world> when the WASM module fails to load: an error and a
 * `cavierror` event instead of an unhandled rejection, and a later world
 * tries again. A file of its own: the load is cached per module.
 */

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

vi.mock('../core/cavi', () => {
  class FakeCavi {
    static shared: unknown = null;
    static initWasm = vi.fn();
    constructor() {
      // Every setter <cavi-world> calls while setting up: a no-op.
      return new Proxy(this, {
        get: (target, key) => (key in target ? Reflect.get(target, key) : () => {}),
      });
    }
    getWorld() {
      return {};
    }
    isDestroyed() {
      return false;
    }
  }
  return { Cavi: FakeCavi };
});
vi.mock('../renderer/renderer', () => ({
  Renderer: class {
    render() {}
    stop() {}
  },
}));
vi.mock('../component/jack', () => ({}));
vi.mock('../component/interactionwc', () => ({
  CaviInteractionElement: { attachedTo: () => null },
}));

import { Cavi } from '../core/cavi';
import '../component/worldwc';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('<cavi-world> — WASM load failure', () => {
  it('logs it and dispatches cavierror, then retries for the next world', async () => {
    const initWasm = Cavi.initWasm as unknown as ReturnType<typeof vi.fn>;
    const failure = new Error('404 cavi_bg.wasm');
    initWasm.mockReturnValueOnce(Promise.reject(failure));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors: unknown[] = [];
    document.addEventListener('cavierror', (e) => errors.push((e as CustomEvent).detail.error));
    const ready = vi.fn();
    document.addEventListener('caviready', ready);

    document.body.appendChild(document.createElement('cavi-world'));
    await flush();

    expect(errors).toEqual([failure]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed to load'), failure);
    expect(ready).not.toHaveBeenCalled();

    initWasm.mockReturnValueOnce(Promise.resolve());
    document.body.appendChild(document.createElement('cavi-world'));
    await flush();

    expect(initWasm).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
