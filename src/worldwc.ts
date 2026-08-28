import { Cavi } from './cavi';
import { Renderer } from './renderer';
import type { IResizeController } from './types';
import { StandardResizeController } from './resize';
import './jack'; // registers cavi-jack, and transitively cavi-wire (wirewc) + cavi-plug
import './interactionwc'; // registers cavi-interaction

/**
 * WASM init is process-wide and not safe to run twice (Cavi.initWasm calls
 * initSync() from the `cavi` package) — cached here at module scope so
 * multiple <cavi-world> instances, or one reconnecting after a DOM move,
 * still only trigger it once.
 */
let wasmInit: Promise<void> | null = null;

/**
 * <cavi-world> wraps the Cavi/World/Renderer setup every example previously
 * hand-wrote in a page's own main() (see src/example2.ts pre-migration) into
 * a drop-in container: give it a size via CSS, drop <cavi-jack>/<cavi-wire>
 * children in it, and it initializes WASM, creates the canvas, wires up
 * Cavi.shared + the `caviready` event those other elements already listen
 * for, and starts the render loop — all with sensible defaults.
 *
 * Only one <cavi-world> is meaningfully supported per page today: Cavi.shared
 * is a single global singleton (pre-existing design, see cavi.ts), so a
 * second instance would just overwrite the first's registration.
 */
export class CaviWorldElement extends HTMLElement {
  private _cavi: Cavi | null = null;

  /**
   * Keeps the canvas backing store sized to this element and announces
   * layout changes via `cavi-resize` — pluggable the same way
   * <cavi-interaction>'s `.controller` is: overridable before this element
   * connects for a custom resize strategy, defaults to watching this
   * element with a ResizeObserver (see StandardResizeController).
   */
  public resizeController: IResizeController = new StandardResizeController();

  connectedCallback(): void {
    if (this._cavi) return; // already initialized (e.g. reconnect after a DOM move)

    // Custom elements default to `display: inline`, so an author's CSS
    // width/height (as previously written for the plain <div> this element
    // replaces) would silently no-op without this — only applied when
    // unset so an author's own display/position wins.
    const computed = getComputedStyle(this);
    if (computed.display === 'inline') this.style.display = 'block';
    if (computed.position === 'static') this.style.position = 'relative';

    let canvas = this.querySelector<HTMLCanvasElement>('#wireCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wireCanvas';
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      this.insertBefore(canvas, this.firstChild);
    }
    this.resizeController.attach(this, canvas);

    if (!wasmInit) wasmInit = Cavi.initWasm();
    wasmInit.then(() => this._setup(canvas!));
  }

  private _setup(canvas: HTMLCanvasElement): void {
    if (!this.isConnected) return; // removed while WASM init was in flight

    const cavi = new Cavi();
    const renderer = new Renderer(this, cavi.getWorld());
    cavi.setRenderer(renderer);
    cavi.setAcceleration(
      parseFloat(this.getAttribute('gravity-x') ?? '0'),
      parseFloat(this.getAttribute('gravity-y') ?? '5'),
    );
    cavi.setDebugDrawNodes(this.hasAttribute('debug-nodes'));
    const dragMode = this.getAttribute('drag-mode');
    if (dragMode === 'hold' || dragMode === 'click') cavi.setDragMode(dragMode);

    this._cavi = cavi;
    Cavi.shared = cavi;
    document.dispatchEvent(new CustomEvent('caviready', { detail: { cavi } }));

    // Jack/Plug install no listeners of their own — without some
    // <cavi-interaction>, nothing here would be interactive. An author can
    // drop one in manually (e.g. with a custom `.controller`); otherwise
    // this provides the standard mouse/touch drag-and-drop for free, same
    // as the auto-created canvas above.
    if (!this.querySelector('cavi-interaction')) {
      this.appendChild(document.createElement('cavi-interaction'));
    }

    // Parity with the manual controlsElement.setCavi(cavi) call in main.ts.
    const controls = this.querySelector('cavi-controls') as
      | (HTMLElement & { setCavi(c: Cavi): void })
      | null;
    controls?.setCavi(cavi);

    renderer.render();
  }

  disconnectedCallback(): void {
    this.resizeController.detach();
    this._cavi?.getRenderer()?.stop();
  }

  public getCavi(): Cavi | null {
    return this._cavi;
  }
}

customElements.define('cavi-world', CaviWorldElement);
