import { Cavi } from './cavi';
import type { Wire } from './wire';
import type { Plug } from './plug';
import type { Jack } from './jack';
import './plug';

/** Simple axis-aligned bounding-box overlap test (touching edges don't count). */
function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export class CaviWireElement extends HTMLElement {
  /**
   * Every connected <cavi-wire>, used only to rebind survivors after one of
   * them deletes itself (see _destroy) — deleting a wire shifts the WASM
   * index of every wire created after it, which would otherwise leave
   * other CaviWireElements/Plugs reading through a stale index forever.
   */
  private static readonly _registry = new Set<CaviWireElement>();

  private _wire: Wire | null = null;
  private _plugs: Plug[] = [];
  /** Parallel to _plugs: the terminal node index (0 or nodeCount-1) each plug is bound to. */
  private _plugNodeIndices: number[] = [];
  private _rafId: number | null = null;
  private _cavi: Cavi | null = null;
  private _container: HTMLElement | null = null;
  private _autoCleanup: boolean = false;

  static get observedAttributes() {
    return ['length', 'tension', 'size', 'renderType', 'color', 'type'];
  }

  connectedCallback() {
    // Transparent to layout — child plugs position relative to the container
    this.style.display = 'contents';
    CaviWireElement._registry.add(this);

    if (Cavi.shared) {
      this._setup(Cavi.shared);
    } else {
      document.addEventListener(
        'caviready',
        (e: Event) => this._setup((e as CustomEvent<{ cavi: Cavi }>).detail.cavi),
        { once: true }
      );
    }
  }

  disconnectedCallback() {
    CaviWireElement._registry.delete(this);
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  private _setup(cavi: Cavi): void {
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
    this._autoCleanup =  true; //this.hasAttribute('auto-cleanup');

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
      const jack = document.getElementById(jackId);
      if (!jack) continue;
      const jx = parseFloat(jack.getAttribute('x') ?? '0');
      const jy = parseFloat(jack.getAttribute('y') ?? '0');
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
      this._plugNodeIndices.push(nodeIdx);

      if (jackId) {
        const jackEl = document.getElementById(jackId) as unknown as Jack | null;
        if (jackEl) {
          const jx = parseFloat(jackEl.getAttribute('x') ?? '0');
          const jy = parseFloat(jackEl.getAttribute('y') ?? '0');
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

  /**
   * Auto-cleanup entry point (opt-in via the `auto-cleanup` attribute — see
   * grep for "auto-cleanup" to find every place this feature touches).
   * Self-contained and called unconditionally once per frame from the
   * update loop above: a no-op unless `auto-cleanup` is set, otherwise once
   * every plug of this cable has drifted entirely outside the container the
   * world was initialized with, the cable is no longer visible or
   * reachable, so it is deleted — freeing its WASM-side wire, its DOM
   * (which cascades disconnectedCallback on every child <cavi-plug>, in
   * turn detaching each from its Jack and dropping its own pointer
   * listeners), and this element's own RAF loop.
   *
   * Checked via real bounding-box overlap (not the physics node's raw x/y)
   * so it stays correct regardless of where in the DOM a <cavi-wire> lives
   * relative to the container.
   */
  private _cleanupIfOutsideContainer(): void {
    if (!this._autoCleanup || !this._container || this._plugs.length === 0) return;

    const containerRect = this._container.getBoundingClientRect();
    const allOutside = this._plugs.every(
      (plug) => !rectsOverlap(plug.getBoundingClientRect(), containerRect)
    );
    if (allOutside) {
      this._destroy();
    }
  }

  /**
   * Deletes this cable's WASM-side wire and removes it from the DOM.
   *
   * World.deleteWire() shifts the index of every wire created after this
   * one down by one, but every other CaviWireElement (and each of its
   * Plugs' Node objects) cached its own Wire at the index it had when
   * created — left alone, they'd silently keep reading/writing through a
   * now-wrong index forever. Rebind every survivor whose index just shifted
   * to the fresh Wire object World.deleteWire() already created for it.
   */
  private _destroy(): void {
    const cavi = this._cavi;
    const wire = this._wire;
    if (wire && cavi) {
      const deletedIndex = wire.getIndex();
      cavi.deleteWire(deletedIndex);

      for (const other of CaviWireElement._registry) {
        if (other === this) continue;
        const oldIndex = other._wire?.getIndex() ?? -1;
        if (oldIndex > deletedIndex) {
          const freshWire = cavi.getWireByIndex(oldIndex - 1);
          if (freshWire) other._rebindAfterIndexShift(freshWire);
        }
      }
    }
    this.remove();
  }

  /** Rebinds this element's Wire and every Plug's Node after a sibling deletion shifted our index — see _destroy. */
  private _rebindAfterIndexShift(newWire: Wire): void {
    this._wire = newWire;
    for (let i = 0; i < this._plugs.length; i++) {
      const node = newWire.getNode(this._plugNodeIndices[i]);
      if (node) this._plugs[i].setNode(node);
    }
  }

  public getWire(): Wire | null {
    return this._wire;
  }
}

customElements.define('cavi-wire', CaviWireElement);
