import { Cavi } from '../core/cavi';
import type { Wire } from '../core/wire';
import { emitCaviEvent } from '../core/events';
import { rectContains, type FrameContext, type FrameTask } from '../core/frame';
import type { Plug } from './plug';
import { Jack } from './jack';
import './plug';

/**
 * How far (world units) outside the view a node must be to count as out of
 * view — a plug is 24px across, so a terminal just past the edge is still
 * partly visible.
 */
const OUT_OF_VIEW_MARGIN = 32;

/** Wires given an id so far on this page — see newWireId. */
let wireIdCount = 0;

/**
 * An id for a <cavi-wire> that has none. The time keeps it from matching an
 * id saved in an earlier visit and restored into this one (applyCables);
 * the counter, from another id given in the same millisecond.
 */
function newWireId(): string {
  return `cavi-wire-${Date.now().toString(36)}-${(wireIdCount++).toString(36)}`;
}

export class CaviWireElement extends HTMLElement {
  /**
   * ~0.5s at 60fps — long enough that no momentary state (see
   * _framesOutside) can be mistaken for a cable that has genuinely drifted
   * away under gravity/tension.
   */
  /** How many consecutive frames an orphaned cable stays out of view before it is deleted. */
  public static readonly OUTSIDE_FRAMES_BEFORE_CLEANUP = 30;

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
  /**
   * Plugs whose `jack="id"` named no jack of this world at setup — retried
   * every frame (see _plugPending), so a jack inserted after its cable
   * still gets it.
   */
  private _pending: { plug: Plug; jackId: string; nodeIdx: number }[] = [];

  /**
   * All live: changing one later updates the running cable (see
   * attributeChangedCallback). `rendertype` is the legacy `renderType`
   * spelling (HTML lowercases attribute names); prefer `render-type`.
   */
  static get observedAttributes() {
    return ['length', 'tension', 'size', 'render-type', 'rendertype', 'color', 'type'];
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    const wire = this._wire;
    if (!wire || oldValue === value) return; // read by _setup otherwise
    switch (name) {
      case 'color':
        wire.setColor(value ?? '#ffffff');
        break;
      case 'tension': {
        const distance = parseFloat(value ?? '20');
        if (Number.isFinite(distance) && distance > 0) wire.setLinkDistance(distance);
        break;
      }
      case 'size': {
        const radius = parseFloat(value ?? '5');
        if (Number.isFinite(radius) && radius > 0) wire.setRadius(radius);
        break;
      }
      case 'type':
        for (const plug of this._plugs) plug.setType(value ?? '');
        break;
      case 'render-type':
      case 'rendertype':
        wire.setRenderType(this._renderType());
        break;
      case 'length': {
        const count = parseInt(value ?? '10', 10);
        const current = wire.getNodeCount();
        if (!Number.isFinite(count) || count < 2 || count === current) return;
        wire.setNodeCount(count);
        // The plug on the last node moved with it (see Wire.getNode); keep
        // its `node` attribute telling the truth.
        for (const plug of this._plugs) {
          const el = plug as unknown as HTMLElement;
          if (el.getAttribute('node') === String(current - 1)) {
            el.setAttribute('node', String(count - 1));
          }
        }
        break;
      }
    }
  }

  /** 0 (segments) or 1 (bezier, the default) from `render-type` (or legacy `renderType`). */
  private _renderType(): number {
    const value = this.getAttribute('render-type') ?? this.getAttribute('renderType');
    return value === 'segments' ? 0 : 1;
  }

  connectedCallback() {
    // Transparent to layout — child plugs position relative to the container
    this.style.display = 'contents';
    // A stable identity, so a saved state can tell this cable apart from the
    // others (see captureCables/applyCables). An author's own id wins.
    if (!this.id) this.id = newWireId();

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
    // Set up again after its world was torn down and rebuilt: start from
    // the plugs in the markup, not on top of the previous list.
    this._plugs = [];
    const nodeCount = parseInt(this.getAttribute('length') ?? '10');
    const tension = parseFloat(this.getAttribute('tension') ?? '20');
    const radius = parseFloat(this.getAttribute('size') ?? '5');
    // Bezier by default; render-type="segments" opts into straight segments.
    const renderType = this._renderType();
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

    // Unplugged ends of a cable set up again (its world was removed and
    // inserted back) come back where they were — see Plug.takeRestoreState.
    const restored = new Map<HTMLElement, { x: number; y: number; fixed: boolean }>();
    for (const { plugEl, jackId } of validPlugs) {
      const state = (plugEl as unknown as Plug).takeRestoreState?.();
      const plugged = jackId !== null && this._findJack(jackId) !== null;
      if (state && !plugged) restored.set(plugEl, state);
    }

    // Determine wire start/end from jack-bound plugs, else restored ends
    let start: { x: number; y: number } | null = null;
    let end: { x: number; y: number } | null = null;
    for (const { plugEl, nodeIdx, jackId } of validPlugs) {
      const jack = jackId ? this._findJack(jackId) : null;
      const position = jack?.canAcceptMore() ? jack.getWorldPosition() : restored.get(plugEl);
      if (!position) continue;
      if (nodeIdx === 0) start = position;
      else if (nodeIdx === nodeCount - 1) end = position;
    }
    // An end with nowhere to be while the other has a place (a cable
    // restored with one end plugged in — see applyCables) hangs straight
    // down from it, about the shape it settles into under the default
    // gravity, instead of starting across the world from it.
    const span = (nodeCount - 1) * tension;
    if (start && !end) end = { x: start.x, y: start.y + span };
    else if (end && !start) start = { x: end.x, y: end.y + span };
    const { x: x1, y: y1 } = start ?? { x: 100, y: 100 };
    const { x: x2, y: y2 } = end ?? { x: 300, y: 300 };

    const wire = cavi.addWire(x1, y1, x2, y2, nodeCount, tension, radius, renderType);
    wire.setColor(color);
    this._wire = wire;
    emitCaviEvent(cavi, this, 'cavi-wire-add', { wire, element: this });

    this._pending = [];
    for (const { plugEl, nodeIdx, jackId } of validPlugs) {
      const node = wire.getNode(nodeIdx);
      if (!node) continue;

      const plug = plugEl as unknown as Plug;
      plug.setType(type);
      plug.setNode(node);
      this._plugs.push(plug);
      const state = restored.get(plugEl);
      if (state) node.fixed = state.fixed;

      if (jackId) {
        const jack = this._findJack(jackId);
        if (jack) this._plugInto(plug, jack, jackId, nodeIdx);
        else this._pending.push({ plug, jackId, nodeIdx });
      }
    }

    this._startFrameSync();
  }

  /**
   * The jack with id `id` among this cable's own world's jacks — looked up
   * in the jack registry rather than with document.getElementById, so it
   * also works inside shadow roots, and an id repeated in another world
   * never picks that world's jack.
   */
  private _findJack(id: string): Jack | null {
    for (const jack of Jack.registry) {
      if (jack.id === id && Cavi.for(jack) === this._cavi) return jack;
    }
    return null;
  }

  /**
   * Declaratively plugs `plug` into `jack`: pins its node on the jack and
   * attaches it — unless the jack is already at `max-plugs`, in which case
   * the plug stays unplugged (with a warning) rather than overfilling it. A
   * type mismatch only warns: the markup takes precedence.
   */
  private _plugInto(plug: Plug, jack: Jack, jackId: string, nodeIdx: number): void {
    const plugEl = plug as unknown as HTMLElement;
    if (!jack.canAcceptMore()) {
      console.warn(
        `<cavi-wire>: <cavi-plug node="${nodeIdx}"> is declaratively wired to jack ` +
          `#${jackId}, which is already full (max-plugs); left unplugged.`
      );
      return;
    }
    const node = plug.node;
    if (node) {
      const { x, y } = jack.getWorldPosition();
      node.setPosition(x, y);
      node.fixed = true;
    }
    const type = this.getAttribute('type') ?? '';
    if (!jack.canAccept(type)) {
      console.warn(
        `<cavi-wire>: <cavi-plug node="${nodeIdx}"> (type="${type}") is ` +
          `declaratively wired to jack #${jackId} (type="${jack.type}") — ` +
          `types do not match.`
      );
    }
    plug.attach(jack);
    plugEl.setAttribute('plugged', 'true');
  }

  /** Retries the plugs whose jack wasn't there at setup (see _pending). */
  private _plugPending(): void {
    this._pending = this._pending.filter(({ plug, jackId, nodeIdx }) => {
      if (plug.jack) return false; // plugged in some other way meanwhile
      const jack = this._findJack(jackId);
      if (!jack) return true;
      this._plugInto(plug, jack, jackId, nodeIdx);
      return false;
    });
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
      if (this._pending.length > 0) this._plugPending();
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
   * state; then every node, so a cable hanging back into view between two
   * out-of-view ends is kept.
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
  private _destroy(reason: 'cleanup' | 'removed' = 'cleanup'): void {
    this._releaseWire(reason);
    // Plugs defer their own detach to a microtask (so a DOM move keeps them
    // plugged — see Plug.disconnectedCallback); a deletion is final, so
    // free the jacks right away.
    for (const plug of this._plugs) plug.detach();
    this.remove();
  }

  /**
   * Deletes this cable for good, right away: frees its jacks and its WASM
   * wire, then removes the element. Unlike a plain `.remove()` — which
   * waits a microtask, in case the element is only being moved — a jack it
   * leaves at `max-plugs` can take another plug immediately afterwards.
   * Emits `cavi-wire-remove` with reason 'removed'.
   */
  public delete(): void {
    this._destroy('removed');
  }

  public getWire(): Wire | null {
    return this._wire;
  }
}

customElements.define('cavi-wire', CaviWireElement);
