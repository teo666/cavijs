// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * initWasm (src/core/wasm.ts): one load per page, shared by every caller,
 * forgotten when it fails. The `cavi` package is faked: its init is all
 * this is about.
 */
const init = vi.fn();
vi.mock('cavi', () => ({ default: init }));

/** A fresh copy of the module, with no load behind it. */
async function freshWasm() {
  vi.resetModules();
  return import('../core/wasm');
}

beforeEach(() => {
  init.mockReset();
});

describe('initWasm', () => {
  it('loads once, whoever asks and however often', async () => {
    const loaded = { memory: {} };
    init.mockResolvedValue(loaded);
    const { initWasm, getWasm, isWasmReady } = await freshWasm();

    expect(isWasmReady()).toBe(false);
    expect(() => getWasm()).toThrow(/initWasm/);
    const [a, b] = await Promise.all([initWasm(), initWasm('ignored.wasm')]);

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(undefined);
    expect(a).toBe(loaded);
    expect(b).toBe(loaded);
    expect(getWasm()).toBe(loaded);
  });

  it('hands cavi the source to load the .wasm from', async () => {
    init.mockResolvedValue({ memory: {} });
    const { initWasm } = await freshWasm();

    await initWasm('https://cdn.example/cavi_bg.wasm');

    expect(init).toHaveBeenCalledWith({ module_or_path: 'https://cdn.example/cavi_bg.wasm' });
  });

  it('tries again after a failed load', async () => {
    const failure = new Error('offline');
    init.mockRejectedValueOnce(failure).mockResolvedValueOnce({ memory: {} });
    const { initWasm, isWasmReady } = await freshWasm();

    await expect(initWasm()).rejects.toBe(failure);
    expect(isWasmReady()).toBe(false);
    await initWasm();

    expect(init).toHaveBeenCalledTimes(2);
    expect(isWasmReady()).toBe(true);
  });
});
