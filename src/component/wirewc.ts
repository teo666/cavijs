import { Cavi } from '../core/cavi';
import type { Wire } from '../core/wire';
import type { Plug } from './plug';
import type { Jack } from './jack';
import './plug';

/** Simple axis-aligned bounding-box overlap test (touching edges don't count). */
function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export class CaviWireElement extends HTMLElement {
  /**
   * ~0.5s at 60fps — long enough that no single-frame layout reflow glitch
   * (see _framesOutside) can be mistaken for a cable that has genuinely
   * drifted away under gravity/tension.
   */
  private static readonly OUTSIDE_FRAMES_BEFORE_CLEANUP = 30;

  private _wire: Wire | null = null;
  private _plugs: Plug[] = [];
  private _rafId: number | null = null;
  private _cavi: Cavi | null = null;
  private _container: HTMLElement | null = null;
  /**
   * Consecutive frames this wire's plugs have been found entirely outside
   * the container — a layout reflow (e.g. a responsive container resizing,
   * see worldwc.ts's ResizeObserver) can leave a jack's DOM position stale
   * for a frame or two before it's re-measured, which would otherwise read
   * as a false "drifted away" positive on a single frame. Cleanup only
   * fires once this holds for OUTSIDE_FRAMES_BEFORE_CLEANUP consecutive
   * frames, so a transient reflow glitch can never delete a cable.
   */
  private _framesOutside: number = 0;

  static get observedAttributes() {
    return ['length', 'tension', 'size', 'renderType', 'color', 'type'];
  }

  connectedCallback() {
    // Transparent to layout — child plugs position relative to the container
    this.style.display = 'contents';

    // Reconnected after a DOM move (disconnect + connect in the same task):
    // the WASM wire is still alive (see disconnectedCallback), so just
    // resume the per-frame sync instead of creating a duplicate wire.
    if (this._wire) {
      this._startUpdateLoop();
      return;
    }

    Cavi.whenReady(this, (cavi) => this._setup(cavi));
  }

  /**
   * Removing a <cavi-wire> from the DOM (e.g. Jack's 'cancel' drop
   * behavior, or any consumer calling `.remove()`) also deletes its WASM
   * wire — otherwise it would keep being simulated and drawn on the canvas
   * with no plugs attached. Deferred to a microtask so a plain DOM move
   * (disconnect immediately followed by connect) keeps the live wire.
   */
  disconnectedCallback() {
    this._stopUpdateLoop();
    queueMicrotask(() => {
      if (!this.isConnected) this._releaseWire();
    });
  }

  /** Deletes this element's WASM wire, if it still owns one. Idempotent. */
  private _releaseWire(): void {
    const wire = this._wire;
    this._wire = null;
    if (!wire || !this._cavi) return;
    const index = wire.getIndex();
    if (index >= 0) this._cavi.deleteWire(index);
  }

  private _setup(cavi: Cavi): void {
    // Removed (or already set up) while waiting for 'caviready'.
    if (!this.isConnected || this._wire) return;
    const nodeCount = parseInt(this.getAttribute('length') ?? '10');
    const tension = parseFloat(this.getAttribute('tension') ?? '20');
    const radius = parseFloat(this.getAttribute('size') ?? '5');
    // Bezier by default; explicit renderType="segments" opts back into
    // straight-segment rendering.
    const renderType = this.getAttribute('renderType') === 'segments' ? 0 : 1;
    const color = this.getAttribute('color') ?? '#ffffff';
    const type = this.getAttribute('type') ?? '';

    this._cavi = cavi;
    this._container = cavi.getContainer();

    const plugEls = Array.from(this.children).filter(
      (el) => el.tagName.toLowerCase() === 'cavi-plug'
    ) as HTMLElement[];

    // Only terminal nodes (first/last) are supported for now — plugs
    // bound to intermediate node indices are skipped with a warning.
    const validPlugs = plugEls.reduce<
      { plugEl: HTMLElement; nodeIdx: number; jackId: string | null }[]
    >((acc, plugEl) => {
      const nodeIdx = parseInt(plugEl.getAttribute('node') ?? '0');
      const isTerminal = nodeIdx === 0 || nodeIdx === nodeCount - 1;
      if (!isTerminal) {
        console.warn(
          `<cavi-wire>: <cavi-plug node="${nodeIdx}"> is not a terminal node ` +
            `(expected 0 or ${nodeCount - 1}); intermediate-node plugs are not ` +
            `supported yet and this plug will be ignored.`
        );
        return acc;
      }
      acc.push({ plugEl, nodeIdx, jackId: plugEl.getAttribute('jack') });
      return acc;
    }, []);

    // Determine wire start/end from jack-bound plugs
    let x1 = 100,
      y1 = 100,
      x2 = 300,
      y2 = 300;
    for (const { nodeIdx, jackId } of validPlugs) {
      if (!jackId) continue;
      const jack = document.getElementById(jackId) as unknown as Jack | null;
      if (!jack) continue;
      const { x: jx, y: jy } = jack.getWorldPosition();
      if (nodeIdx === 0) {
        x1 = jx;
        y1 = jy;
      } else if (nodeIdx === nodeCount - 1) {
        x2 = jx;
        y2 = jy;
      }
    }

    const wire = cavi.addWire(x1, y1, x2, y2, nodeCount, tension, radius, renderType);
    wire.setColor(color);
    this._wire = wire;

    for (const { plugEl, nodeIdx, jackId } of validPlugs) {
      const node = wire.getNode(nodeIdx);
      if (!node) continue;

      const plug = plugEl as unknown as Plug;
      plug.setType(type);
      plug.setNode(node);
      this._plugs.push(plug);

      if (jackId) {
        const jackEl = document.getElementById(jackId) as unknown as Jack | null;
        if (jackEl) {
          const { x: jx, y: jy } = jackEl.getWorldPosition();
          node.setPosition(jx, jy);
          node.fixed = true;

          if (jackEl.type !== type) {
            console.warn(
              `<cavi-wire>: <cavi-plug node="${nodeIdx}"> (type="${type}") is ` +
                `declaratively wired to jack #${jackId} (type="${jackEl.type}") — ` +
                `types do not match.`
            );
          }

          plug.attach(jackEl);
          plugEl.setAttribute('plugged', 'true');
        }
      }
    }

    this._startUpdateLoop();
  }

  /**
   * Keeps each Plug's DOM position in sync with its physics node every
   * frame. Without this, a Plug dropped away from any Jack freezes at the
   * drop point while its underlying node keeps moving under gravity/tension
   * — visually detaching the plug icon from the wire it's still bound to.
   */
  private _startUpdateLoop(): void {
    this._stopUpdateLoop();
    const tick = () => {
      for (const plug of this._plugs) {
        plug.update();
      }
      this._cleanupIfOutsideContainer();
      // _cleanupIfOutsideContainer may have synchronously disconnected this
      // element (via _destroy -> remove()) — don't reschedule if it did.
      if (this.isConnected) {
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _stopUpdateLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Auto-cleanup entry point (opt-in via the `auto-cleanup` attribute — see
   * grep for "auto-cleanup" to find every place this feature touches; Jack
   * sets it on a new cable dropped with the 'detach' behavior). Called
   * unconditionally once per frame from the update loop above, and reads
   * the attribute live, so it can be added or removed at any time: a no-op
   * unless it's set, otherwise once every plug of this cable has drifted
   * entirely outside both the world container and the renderer's surface
   * (see RendererOptions.surface — so a cable still visible in a
   * zoomed-out view is never deleted), the cable is no longer visible or
   * reachable, so it is deleted — freeing its WASM-side wire, its DOM
   * (which cascades disconnectedCallback on every child <cavi-plug>), and
   * this element's own RAF loop.
   *
   * Checked via real bounding-box overlap (not the physics node's raw x/y)
   * so it stays correct regardless of where in the DOM a <cavi-wire> lives
   * relative to the container.
   */
  private _cleanupIfOutsideContainer(): void {
    if (!this.hasAttribute('auto-cleanup') || !this._container || this._plugs.length === 0) {
      return;
    }

    const bounds = [this._container.getBoundingClientRect()];
    const surface = this._cavi?.getSurface?.();
    if (surface && surface !== this._container) bounds.push(surface.getBoundingClientRect());
    const allOutside = this._plugs.every((plug) => {
      const r = plug.getBoundingClientRect();
      return bounds.every((b) => !rectsOverlap(r, b));
    });

    if (!allOutside) {
      this._framesOutside = 0;
      return;
    }
    this._framesOutside++;
    if (this._framesOutside >= CaviWireElement.OUTSIDE_FRAMES_BEFORE_CLEANUP) {
      this._destroy();
    }
  }

  /**
   * Deletes this cable's WASM-side wire and removes it from the DOM. The
   * wire is released synchronously here (not left to disconnectedCallback's
   * deferred cleanup) so the physics world never simulates it for one more
   * frame. Sibling wires need no rebinding: World.deleteWire() shifts their
   * Wire handles' indices in place (see Wire._setIndex).
   */
  private _destroy(): void {
    this._releaseWire();
    // Plugs defer their own detach to a microtask (so a DOM move keeps them
    // plugged — see Plug.disconnectedCallback); a deletion is final, so
    // free the jacks right away.
    for (const plug of this._plugs) plug.detach();
    this.remove();
  }

  public getWire(): Wire | null {
    return this._wire;
  }
}

customElements.define('cavi-wire', CaviWireElement);
