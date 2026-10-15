import { Cavi } from '../core/cavi';
import type { Wire } from '../core/wire';
import { emitCaviEvent } from '../core/events';
import { rectContains, type FrameContext, type FrameTask } from '../core/frame';
import type { Plug } from './plug';
import type { Jack } from './jack';
import './plug';

/**
 * How far (world units) outside the view a node must be to count as out of
 * view — a plug is 24px across, so a terminal just past the edge is still
 * partly visible.
 */
const OUT_OF_VIEW_MARGIN = 32;

export class CaviWireElement extends HTMLElement {
  /**
   * ~0.5s at 60fps — long enough that no momentary state (see
   * _framesOutside) can be mistaken for a cable that has genuinely drifted
   * away under gravity/tension.
   */
  private static readonly OUTSIDE_FRAMES_BEFORE_CLEANUP = 30;

  private _wire: Wire | null = null;
  private _plugs: Plug[] = [];
  private _cavi: Cavi | null = null;
  /** Unregisters _frameTask from the world (see _startFrameSync). */
  private _stopFrameTask: (() => void) | null = null;
  /**
   * Consecutive frames this wire has been found orphaned and entirely out
   * of view. Cleanup only fires once this holds for
   * OUTSIDE_FRAMES_BEFORE_CLEANUP consecutive frames, so a cable that is
   * out of view only for a moment (e.g. a plug dropped near the edge, or a
   * quick pan) is never deleted.
   */
  private _framesOutside: number = 0;
  /** Set by _frameTask.read when this frame's write must delete the cable. */
  private _destroyPending: boolean = false;

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
      this._startFrameSync();
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
    this._stopFrameSync();
    queueMicrotask(() => {
      if (!this.isConnected) this._releaseWire();
    });
  }

  /** Deletes this element's WASM wire, if it still owns one. Idempotent. */
  private _releaseWire(reason: 'cleanup' | 'removed' = 'removed'): void {
    const wire = this._wire;
    this._wire = null;
    if (!wire || !this._cavi) return;
    const index = wire.getIndex();
    if (index < 0) return;
    this._cavi.deleteWire(index);
    emitCaviEvent(this._cavi, this, 'cavi-wire-remove', { wire, element: this, index, reason });
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
    emitCaviEvent(cavi, this, 'cavi-wire-add', { wire, element: this });

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

    this._startFrameSync();
  }

  /**
   * Keeps each Plug's DOM position in sync with its physics node every
   * frame, and runs the orphan cleanup — as a FrameTask of its world rather
   * than a requestAnimationFrame loop of its own, so a world with N cables
   * still measures the page once per frame (see World.runFrameTasks).
   * Without it, a Plug dropped away from any Jack would freeze at the drop
   * point while its underlying node keeps moving under gravity/tension.
   */
  private _startFrameSync(): void {
    this._stopFrameSync();
    this._stopFrameTask = this._cavi?.getWorld?.().addFrameTask?.(this._frameTask) ?? null;
  }

  private _stopFrameSync(): void {
    this._stopFrameTask?.();
    this._stopFrameTask = null;
  }

  private _frameTask: FrameTask = {
    read: (ctx) => {
      this._destroyPending = false;
      if (!this._isOrphanOutOfView(ctx)) {
        this._framesOutside = 0;
        return;
      }
      this._framesOutside++;
      this._destroyPending = this._framesOutside >= CaviWireElement.OUTSIDE_FRAMES_BEFORE_CLEANUP;
    },
    write: () => {
      if (this._destroyPending) {
        this._destroy();
        return;
      }
      for (const plug of this._plugs) plug.update();
    },
  };

  /**
   * Whether this cable is orphaned: neither terminal node is fixed — not
   * plugged into a Jack, not held by a drag, not frozen in place by
   * freeze-on-drop — so nothing anchors it any more and it moves freely
   * under physics. Derived live from the physics state, never stored.
   */
  public isOrphan(): boolean {
    const wire = this._wire;
    if (!wire) return false;
    const last = wire.getNodeCount() - 1;
    if (last < 0) return false;
    return !wire.getNode(0)?.fixed && !wire.getNode(last)?.fixed;
  }

  /**
   * Orphan cleanup check, run once per frame by _frameTask: whether this
   * cable is orphaned (see isOrphan) and every node of it lies outside both
   * the world container and the renderer's surface (FrameContext.viewBounds
   * — see RendererOptions.surface, so a cable still visible in a zoomed-out
   * view is never deleted). Once that has held for
   * OUTSIDE_FRAMES_BEFORE_CLEANUP consecutive frames the cable is deleted,
   * freeing its WASM-side wire and its DOM (which cascades
   * disconnectedCallback on every child <cavi-plug>). Applies to every
   * cable however it was created, unless its world turned it off
   * (Cavi.setOrphanCleanup / <cavi-world orphan-cleanup="off">) — both the
   * policy and the orphan state are read live, so plugging a falling cable
   * back in (or toggling the policy) takes effect on the next frame.
   *
   * Works on the physics nodes' world positions, compared against view
   * bounds measured once per frame for the whole world — no layout read
   * per cable. Cheapest test first: the two terminals; then the orphan
   * state (reading a node's fixed state allocates a temporary WASM copy,
   * see Node.fixed); then every node, so a cable hanging back into view
   * between two out-of-view ends is kept.
   */
  private _isOrphanOutOfView(ctx: FrameContext): boolean {
    const wire = this._wire;
    if (!wire || this._cavi?.getOrphanCleanup?.() === false) return false;
    const count = wire.getNodeCount();
    if (count === 0) return false;
    const bounds = ctx.viewBounds;
    if (bounds.length === 0) return false; // nothing measured: no renderer
    const outside = (i: number) => {
      const x = wire.getNodeX(i);
      const y = wire.getNodeY(i);
      return bounds.every((b) => !rectContains(b, x, y, OUT_OF_VIEW_MARGIN));
    };
    if (!outside(0) || !outside(count - 1)) return false;
    if (!this.isOrphan()) return false;
    for (let i = 1; i < count - 1; i++) {
      if (!outside(i)) return false;
    }
    return true;
  }

  /**
   * Deletes this cable's WASM-side wire and removes it from the DOM. The
   * wire is released synchronously here (not left to disconnectedCallback's
   * deferred cleanup) so the physics world never simulates it for one more
   * frame. Sibling wires need no rebinding: World.deleteWire() shifts their
   * Wire handles' indices in place (see Wire._setIndex).
   */
  private _destroy(): void {
    this._releaseWire('cleanup');
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
