import { Cavi } from '../core/cavi';
import { Renderer } from '../renderer/renderer';
import type { IResizeController } from '../core/types';
import type { CoordinateTransform } from '../core/coords';
import { StandardResizeController } from '../renderer/resize';
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
 * hand-wrote in a page's own main() into a drop-in container: give it a
 * size via CSS, drop <cavi-jack>/<cavi-wire> children in it, and it
 * initializes WASM, creates the canvas, registers its Cavi (see Cavi.for),
 * dispatches `caviready` (bubbling from this element up to document), and
 * starts the render loop — all with sensible defaults.
 *
 * Several <cavi-world>s can coexist on one page: every Jack/Plug/Wire
 * resolves its own world through Cavi.for(element). `Cavi.shared` still
 * points at the most recently initialized one, for backward compatibility.
 *
 * Pan/zoom: set `surface="<css selector>"` to an untransformed ancestor
 * (e.g. the frame a d3-zoom listens on) and the canvas is placed in and
 * sized to that element instead, with the zoom applied by the renderer —
 * see RendererOptions.surface.
 *
 * Own canvas: set `canvas="<css selector>"` (or the `.canvas` property,
 * before this element connects) to draw into a canvas of your own instead
 * of the one created here — placed and stacked however you like (e.g.
 * `z-index` above the jacks, `pointer-events: none`). Its position is
 * measured every frame, so it can sit anywhere on the page; cavi-world
 * only keeps its size matched to this element (or its surface) and never
 * removes it.
 */
export class CaviWorldElement extends HTMLElement {
  private _cavi: Cavi | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  /** Whether _canvas was created here (and is therefore ours to remove). */
  private _ownsCanvas: boolean = false;
  private _surface: HTMLElement | null = null;
  /** A provider passed to setCoordinateTransform before this world was ready — applied at setup. */
  private _pendingTransform: (() => CoordinateTransform) | null = null;

  /**
   * Keeps the canvas backing store sized to this element (or its surface)
   * and announces layout changes via `cavi-resize` — pluggable the same way
   * <cavi-interaction>'s `.controller` is: overridable before this element
   * connects for a custom resize strategy, defaults to watching this
   * element with a ResizeObserver (see StandardResizeController).
   */
  public resizeController: IResizeController = new StandardResizeController();

  /**
   * A canvas of your own to draw into — alternative to the `canvas`
   * attribute for an element you already hold a reference to. Read once,
   * when this element connects.
   */
  public canvas: HTMLCanvasElement | null = null;

  connectedCallback(): void {
    if (this._cavi) {
      // Reconnected after a DOM move: disconnectedCallback stopped the
      // render loop and the resize watcher — resume both instead of
      // leaving a frozen canvas behind.
      if (this._canvas) {
        if (this._ownsCanvas && !this._canvas.isConnected) {
          const host = this._surface ?? this;
          host.insertBefore(this._canvas, host.firstChild);
        }
        this.resizeController.attach(this, this._canvas, this._surface ?? undefined);
      }
      const renderer = this._cavi.getRenderer();
      renderer?.stop();
      renderer?.render();
      return;
    }

    // Custom elements default to `display: inline`, so an author's CSS
    // width/height (as previously written for the plain <div> this element
    // replaces) would silently no-op without this — only applied when
    // unset so an author's own display/position wins.
    const computed = getComputedStyle(this);
    if (computed.display === 'inline') this.style.display = 'block';
    if (computed.position === 'static') this.style.position = 'relative';

    const surface = this._resolveSurface();
    if (surface && getComputedStyle(surface).position === 'static') {
      surface.style.position = 'relative';
    }
    const host = surface ?? this;
    let canvas =
      this.canvas ??
      this._resolveCanvas() ??
      (surface
        ? surface.querySelector<HTMLCanvasElement>(':scope > #wireCanvas')
        : this.querySelector<HTMLCanvasElement>('#wireCanvas'));
    // A canvas found or given by the page is the page's; only one created
    // here is removed again when this world goes away.
    this._ownsCanvas = !canvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wireCanvas';
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      host.insertBefore(canvas, host.firstChild);
    }
    this._canvas = canvas;
    this._surface = surface;
    this.resizeController.attach(this, canvas, surface ?? undefined);

    if (!wasmInit) wasmInit = Cavi.initWasm();
    wasmInit.then(() => this._setup());
  }

  /** The <canvas> named by the `canvas` attribute, if any. */
  private _resolveCanvas(): HTMLCanvasElement | null {
    const selector = this.getAttribute('canvas');
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (el instanceof HTMLCanvasElement) return el;
    console.warn(`<cavi-world>: canvas "${selector}" not found or not a <canvas>; creating one.`);
    return null;
  }

  /** The element named by the `surface` attribute (nearest matching ancestor first), if any. */
  private _resolveSurface(): HTMLElement | null {
    const selector = this.getAttribute('surface');
    if (!selector) return null;
    const el = (this.parentElement?.closest(selector) ??
      document.querySelector(selector)) as HTMLElement | null;
    if (!el) console.warn(`<cavi-world>: surface "${selector}" not found; drawing in place.`);
    return el;
  }

  private _setup(): void {
    if (!this.isConnected) return; // removed while WASM init was in flight
    if (this._cavi) return; // reconnected during WASM init: an earlier .then() already ran

    const cavi = new Cavi();
    const renderer = new Renderer(this, cavi.getWorld(), {
      canvas: this._canvas ?? undefined,
      surface: this._surface ?? undefined,
    });
    cavi.setRenderer(renderer);
    if (this._pendingTransform) {
      cavi.setCoordinateTransformProvider(this._pendingTransform);
      this._pendingTransform = null;
    }
    cavi.setAcceleration(
      parseFloat(this.getAttribute('gravity-x') ?? '0'),
      parseFloat(this.getAttribute('gravity-y') ?? '5')
    );
    cavi.setDebugDrawNodes(this.hasAttribute('debug-nodes'));
    cavi.setWireShadows(this.hasAttribute('wire-shadows'));

    const cableDropBehavior = this.getAttribute('cable-drop-behavior');
    if (
      cableDropBehavior === 'cancel' ||
      cableDropBehavior === 'dangle' ||
      cableDropBehavior === 'detach'
    ) {
      cavi.setCableDropBehavior(cableDropBehavior);
    }
    const plugSpreadMode = this.getAttribute('plug-spread-mode');
    if (plugSpreadMode === 'towardOther' || plugSpreadMode === 'radial') {
      cavi.setPlugSpreadMode(plugSpreadMode);
    }
    const plugSpreadRadius = this.getAttribute('plug-spread-radius');
    if (plugSpreadRadius !== null && Number.isFinite(parseFloat(plugSpreadRadius))) {
      cavi.setPlugSpreadRadiusMultiplier(parseFloat(plugSpreadRadius));
    }
    const plugSpreadTimeout = this.getAttribute('plug-spread-timeout');
    if (plugSpreadTimeout !== null && Number.isFinite(parseFloat(plugSpreadTimeout))) {
      cavi.setPlugSpreadRecompactDelayMs(parseFloat(plugSpreadTimeout));
    }

    this._cavi = cavi;
    Cavi.shared = cavi;
    // Bubbles, so both elements waiting on this world (Cavi.whenReady) and
    // page code listening on document receive it.
    this.dispatchEvent(new CustomEvent('caviready', { detail: { cavi }, bubbles: true }));

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
      (HTMLElement & { setCavi(c: Cavi): void }) | null;
    controls?.setCavi(cavi);

    renderer.render();
  }

  disconnectedCallback(): void {
    this.resizeController.detach();
    this._cavi?.getRenderer()?.stop();
    // A surface canvas we created lives outside this element, so it isn't
    // removed along with it — drop it too unless this was just a DOM move
    // (reconnected within the same task; see connectedCallback's reconnect
    // branch). A canvas the page provided is never removed.
    if (this._surface && this._ownsCanvas) {
      queueMicrotask(() => {
        if (!this.isConnected) this._canvas?.remove();
      });
    }
  }

  public getCavi(): Cavi | null {
    return this._cavi;
  }

  /**
   * Ergonomic passthrough to Cavi.setCoordinateTransformProvider — see
   * there for why cavijs requires this to be registered explicitly rather
   * than auto-detecting a pan/zoom transform itself. If called before this
   * element's Cavi instance exists, the provider is kept and applied as
   * soon as it does.
   */
  public setCoordinateTransform(fn: (() => CoordinateTransform) | null): void {
    if (this._cavi) this._cavi.setCoordinateTransformProvider(fn);
    else this._pendingTransform = fn;
  }

  /** Ergonomic passthrough to Cavi.notifyCoordinateTransformChanged. */
  public notifyCoordinateTransformChanged(): void {
    this._cavi?.notifyCoordinateTransformChanged();
  }
}

customElements.define('cavi-world', CaviWorldElement);
