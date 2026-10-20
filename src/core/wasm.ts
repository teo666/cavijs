import init, { type InitInput, type InitOutput } from 'cavi';

/** The loaded module, once initWasm has resolved. */
let output: InitOutput | null = null;
/** The load in progress or done, shared by every caller; forgotten if it fails. */
let loading: Promise<InitOutput> | null = null;

/**
 * Loads the cavi WASM module — once per page: every later call, with or
 * without `source`, gets the same load. Everything that builds a World
 * needs it first; <cavi-world> calls it by itself.
 *
 * `source` says where the `.wasm` comes from — a URL, a Response, its bytes
 * or a compiled module — for when the bundler doesn't serve it next to the
 * `cavi` package's JS (a CDN, a CSP, a bundler other than Vite). Without it,
 * `cavi` resolves its own file. To use a `source` on a page with
 * <cavi-world>s, call this before they connect. A failed load is
 * forgotten, so the next call tries again.
 */
export function initWasm(source?: InitInput | Promise<InitInput>): Promise<InitOutput> {
  if (!loading) {
    const attempt = init(source === undefined ? undefined : { module_or_path: source }).then(
      (loaded) => (output = loaded)
    );
    loading = attempt;
    attempt.catch(() => {
      if (loading === attempt) loading = null;
    });
  }
  return loading;
}

/** Whether initWasm has finished loading the module. */
export function isWasmReady(): boolean {
  return output !== null;
}

/** The loaded module (its memory holds the render buffer). Throws before initWasm resolved. */
export function getWasm(): InitOutput {
  if (!output)
    throw new Error('cavijs: the cavi WASM module is not loaded yet; await initWasm() first');
  return output;
}

/**
 * Internal: records a module loaded some other way — the `cavi` package's
 * own init called directly (tests), or a stand-in (Cavi.wasm's setter).
 */
export function _setWasm(loaded: InitOutput | null): void {
  output = loaded;
}
