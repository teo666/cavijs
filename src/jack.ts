import type { Plug } from './plug';
import type { Wire } from './wire';
import type { Node } from './node';
import type { CaviWireElement } from './wirewc';
import { Cavi } from './cavi';
import './wirewc';

/** Node count/distance growth used while dragging a cable out of a Jack. */
const CABLE_MIN_NODES = 4;
const CABLE_NODES_PER_PX = 1 / 30;
const CABLE_MAX_NODES = 60;
/** Same snap threshold used by Plug's own drag-to-jack magnet effect. */
const CABLE_SNAP_DISTANCE = 20;

/**
 * Jack represents a fixed connection point.
 * Plug elements can be dropped onto Jack elements. A Jack can also be used
 * as a drag source to create a brand new cable (right-click, or left-click
 * + Shift) — see handlePointerDown below.
 */
export class Jack extends HTMLElement {
  private static readonly _registry = new Set<Jack>();

  /**
   * All Jack elements currently connected to the document.
   */
  public static get registry(): ReadonlySet<Jack> {
    return Jack._registry;
  }

  private _type: string = '';
  private _magnetClass: string = 'cavi-magnet-target';
  private _fullClass: string = 'cavi-jack-full';
  private _atCapacityClass: string = 'cavi-jack-at-capacity';
  private _plugs = new Set<Plug>();
  private _maxPlugs: number = Infinity;

  private _activePointerId: number | null = null;
  private _magnetJack: Jack | null = null;
  private _creatingWire: Wire | null = null;
  private _creatingFollowPlug: Plug | null = null;
  private _creatingFollowNode: Node | null = null;

  /**
   * Whether Shift is currently held, tracked globally across all jacks.
   * This is a raw modifier preview, independent of any drag actually being
   * in progress — it already applies on a plain hover before any drag
   * starts, so it's kept separate from _activeDragCount below.
   */
  private static _shiftHeld: boolean = false;
  /**
   * How many drags that could try to connect a plug to a jack are
   * currently in progress, tracked globally via Jack.setDragActive — a
   * count rather than a boolean so overlapping/concurrent drags (e.g.
   * multi-touch, or a plug drag and a cable-creation drag happening at
   * once) don't clear each other's state early. Covers two distinct
   * gestures: Plug relocating an existing connection (Plug.handlePointerDown/
   * _endDrag), and Jack's own cable-creation drag (handlePointerDown/
   * _endCableDrag below) — the latter needs this because Shift/right-click
   * is only required to *start* that drag, not to keep it going, so
   * _shiftHeld alone would stop reflecting an in-progress cable-creation
   * drag the moment Shift is released mid-drag.
   */
  private static _activeDragCount: number = 0;
  private static get _dragActive(): boolean {
    return Jack._activeDragCount > 0;
  }
  /**
   * Last known pointer position (viewport coordinates), tracked globally so
   * "is the cursor over this Jack" can be recomputed by distance rather than
   * native hover events — a Jack that already has a Plug attached has that
   * Plug sitting exactly on top of it (higher z-index), which would
   * otherwise swallow pointerenter/pointerleave before they ever reach it.
   */
  private static _pointerX: number | null = null;
  private static _pointerY: number | null = null;
  private static _listenersInstalled: boolean = false;

  static get observedAttributes() {
    return ['color', 'x', 'y', 'type', 'max-plugs', 'magnet-class', 'full-class', 'at-capacity-class'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
  }

  connectedCallback() {
    Jack._registry.add(this);
    Jack._installGlobalListeners();
    this.render();
    this.updatePosition();
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('contextmenu', this.handleContextMenu);
  }

  disconnectedCallback() {
    Jack._registry.delete(this);
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('contextmenu', this.handleContextMenu);
    this.removeEventListener('pointermove', this.handlePointerMove);
    this.removeEventListener('pointerup', this.handlePointerUp);
    this.removeEventListener('pointercancel', this.handlePointerCancel);
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === 'color') {
      this.render();
    }
    if (name === 'x' || name === 'y') {
      this.updatePosition();
    }
    if (name === 'type') {
      this._type = newValue ?? '';
    }
    if (name === 'max-plugs') {
      const n = newValue ? parseInt(newValue, 10) : NaN;
      this._maxPlugs = Number.isFinite(n) && n > 0 ? n : Infinity;
      this._refreshFullState();
    }
    if (name === 'magnet-class') {
      this._magnetClass = newValue || 'cavi-magnet-target';
    }
    if (name === 'full-class') {
      this._fullClass = newValue || 'cavi-jack-full';
    }
    if (name === 'at-capacity-class') {
      this._atCapacityClass = newValue || 'cavi-jack-at-capacity';
    }
  }

  /**
   * Installs the document-level Shift + pointer-position tracking used to
   * preview a "full jack" as forbidden while hovering it with the
   * cable-creation modifier held — installed once, shared by every Jack
   * instance via the static registry.
   */
  private static _installGlobalListeners(): void {
    if (Jack._listenersInstalled) return;
    Jack._listenersInstalled = true;

    const setShiftHeld = (held: boolean) => {
      if (held === Jack._shiftHeld) return;
      Jack._shiftHeld = held;
      Jack._refreshAll();
    };

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') setShiftHeld(true);
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') setShiftHeld(false);
    });
    // A keyup can be missed if focus leaves the page while Shift is held
    // (e.g. alt-tab) — clear the stuck state once focus returns elsewhere.
    window.addEventListener('blur', () => setShiftHeld(false));

    // Tracked by distance rather than pointerenter/pointerleave: a Jack
    // that already has a Plug attached has that Plug sitting exactly on
    // top of it (same position, higher z-index), which would otherwise
    // swallow hover events before they ever reach the jack underneath.
    // This also fires while an existing Plug is being dragged (its own
    // pointermove still bubbles up to document even under pointer
    // capture), which is what lets the plug-drag forbidden-hover preview
    // below track the drag position without any extra wiring.
    document.addEventListener('pointermove', (e) => {
      Jack._pointerX = e.clientX;
      Jack._pointerY = e.clientY;
      Jack._refreshAll();
    });
  }

  private static _refreshAll(): void {
    for (const jack of Jack._registry) {
      jack._refreshFullState();
    }
  }

  /**
   * Called whenever a drag that could try to connect a plug to a jack
   * starts/stops — by Plug (relocating an existing connection) and by
   * this class itself (a cable-creation drag, see handlePointerDown/
   * _endCableDrag below) — so a full jack previews itself as forbidden on
   * hover for the whole duration of either gesture, not just while Shift
   * happens to be held.
   */
  public static setDragActive(active: boolean): void {
    const before = Jack._dragActive;
    Jack._activeDragCount += active ? 1 : -1;
    if (Jack._dragActive !== before) Jack._refreshAll();
  }

  /**
   * Refreshes two independent, capacity-driven visual states on every
   * pointer move, Shift change, drag start/end, and whenever this Jack's
   * own capacity changes (attach/detach/max-plugs), so all stay correct
   * without needing the pointer to move again:
   * - `at-capacity-class`: unconditional — on for as long as this Jack has
   *   reached `max-plugs`, regardless of hover, Shift, or dragging.
   * - `full-class` + "not-allowed" cursor: a hover-only preview, shown
   *   while the cursor is over an at-capacity Jack during either Shift
   *   being held (previewing before a cable-creation drag even starts) or
   *   an active drag that could try to connect here — relocating an
   *   existing Plug, or an in-progress cable-creation drag (which, once
   *   started, no longer needs Shift held to keep going — see
   *   handlePointerDown).
   */
  private _refreshFullState(): void {
    const atCapacity = !this.canAcceptMore();
    this.classList.toggle(this._atCapacityClass, atCapacity);

    const c = this.getCenter();
    const hovering =
      Jack._pointerX !== null &&
      Jack._pointerY !== null &&
      Math.hypot(Jack._pointerX - c.x, Jack._pointerY - c.y) <= CABLE_SNAP_DISTANCE;
    const blocked = hovering && (Jack._shiftHeld || Jack._dragActive) && atCapacity;
    this.classList.toggle(this._fullClass, blocked);
    this.style.cursor = blocked ? 'not-allowed' : '';
  }

  private updatePosition() {
    const x = this.getAttribute('x') || '0';
    const y = this.getAttribute('y') || '0';
    this.style.left = `${x}px`;
    this.style.top = `${y}px`;
  }

  private render() {
    const color = this.getAttribute('color') || '#333';
    // Basic default style
    const style = `
            :host {
                display: block;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background-color: ${color};
                border: 2px solid #555;
                position: absolute;
                box-sizing: border-box;
                z-index: 10; /* Jack under Plug */
                transform: translate(-50%, -50%); /* Centered on coordinates */
                cursor: crosshair; /* Hints that dragging from here creates a cable */
                touch-action: none; /* Prevent the browser from scrolling while dragging on touch */
            }
            .inner {
                width: 8px;
                height: 8px;
                background-color: #000;
                border-radius: 50%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }
        `;

    if (this.children.length > 0) {
      // If user provided content, just add style and slot
      this.shadowRoot!.innerHTML = `<style>${style}</style><slot></slot>`;
    } else {
      // Default appearance
      this.shadowRoot!.innerHTML = `
                <style>${style}</style>
                <div class="inner"></div>
             `;
    }
  }

  public canAccept(type: string): boolean {
    return this._type !== '' && this._type === type;
  }

  public get type(): string {
    return this._type;
  }

  /**
   * Toggles the configurable "magnet" highlight class on this Jack's host
   * element, used to preview an in-range compatible connection during drag.
   */
  public setMagnetActive(active: boolean): void {
    this.classList.toggle(this._magnetClass, active);
  }

  /**
   * Whether this Jack can accept an additional Plug, based on `max-plugs`.
   */
  public canAcceptMore(): boolean {
    return this._plugs.size < this._maxPlugs;
  }

  /**
   * Registers a Plug as connected to this Jack.
   */
  public attach(plug: Plug): void {
    this._plugs.add(plug);
    this._refreshFullState();
  }

  /**
   * Unregisters a Plug from this Jack.
   */
  public detach(plug: Plug): void {
    this._plugs.delete(plug);
    this._refreshFullState();
  }

  public get plugCount(): number {
    return this._plugs.size;
  }

  public getCenter(): { x: number; y: number } {
    const rect = this.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  /**
   * This Jack is a permanent cable-creation drag source, so its native
   * context menu would otherwise interrupt a right-click drag every time.
   */
  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  /**
   * Starts creating a brand new cable from this Jack: right-click, or
   * left-click + Shift. Immediately builds a <cavi-wire> with two
   * <cavi-plug> terminals — one attached here, the other following the
   * cursor — then drives that free end exactly like Plug drives its own
   * drag (magnet preview, snap-to-jack on release).
   *
   * Public because Plug forwards to it directly: once a Plug is attached
   * to this Jack, it's fixed exactly at the Jack's center with a higher
   * z-index (see the occlusion notes on _pointerX/_pointerY above), so a
   * real click meant to start a new cable here physically lands on that
   * Plug instead — Plug.handlePointerDown detects that case and calls
   * this method directly rather than the event ever reaching this Jack's
   * own listener. Works correctly even then: setPointerCapture doesn't
   * require the original event target, and the listeners added below are
   * on this Jack, which receives every subsequent pointer event for this
   * pointerId once it holds capture.
   */
  public handlePointerDown(e: PointerEvent): void {
    const isRightClick = e.button === 2;
    const isModifiedLeftClick = e.button === 0 && e.shiftKey;
    if (!isRightClick && !isModifiedLeftClick) return;
    if (!this.canAcceptMore()) return;

    const cable = this._createCable(e);
    if (!cable) return;

    e.preventDefault();
    this._activePointerId = e.pointerId;
    this._creatingWire = cable.wire;
    this._creatingFollowPlug = cable.followPlug;
    this._creatingFollowNode = cable.followNode;
    // Shift/right-click is only needed to *start* this drag, not to keep
    // it going — this keeps the full-jack forbidden-hover preview correct
    // for the whole drag even if Shift is released partway through.
    Jack.setDragActive(true);

    if (typeof this.setPointerCapture === 'function') {
      try {
        this.setPointerCapture(e.pointerId);
      } catch {
        // Not supported in this environment (e.g. jsdom) — the drag
        // still works via the listeners added below.
      }
    }

    this.addEventListener('pointermove', this.handlePointerMove);
    this.addEventListener('pointerup', this.handlePointerUp);
    this.addEventListener('pointercancel', this.handlePointerCancel);
  }

  /**
   * Builds the <cavi-wire> + two <cavi-plug> DOM subtree for a new cable,
   * attaches the origin terminal to this Jack, and places the free terminal
   * at the initial cursor position. Returns null (no-op) if Cavi isn't
   * ready yet — can't happen in normal interactive use.
   */
  private _createCable(e: PointerEvent): {
    wireEl: CaviWireElement;
    wire: Wire;
    originPlug: Plug;
    followPlug: Plug;
    followNode: Node;
  } | null {
    const cavi = Cavi.shared;
    if (!cavi) return null;

    const wireEl = document.createElement('cavi-wire') as CaviWireElement;
    wireEl.setAttribute('type', this.type);
    wireEl.setAttribute('length', String(CABLE_MIN_NODES));

    // Cable style is opt-in per Jack — omitted attributes fall back to
    // <cavi-wire>'s own fixed defaults, unchanged from before.
    const cableTension = this.getAttribute('cable-tension');
    if (cableTension !== null) wireEl.setAttribute('tension', cableTension);
    const cableSize = this.getAttribute('cable-size');
    if (cableSize !== null) wireEl.setAttribute('size', cableSize);
    const cableColor = this.getAttribute('cable-color');
    if (cableColor !== null) wireEl.setAttribute('color', cableColor);

    // Children must exist before the wire is inserted: _setup() reads
    // this.children synchronously at connectedCallback time.
    const originPlugEl = document.createElement('cavi-plug');
    originPlugEl.setAttribute('node', '0');
    const followPlugEl = document.createElement('cavi-plug');
    followPlugEl.setAttribute('node', String(CABLE_MIN_NODES - 1));
    wireEl.appendChild(originPlugEl);
    wireEl.appendChild(followPlugEl);

    // Inserted as a sibling of this Jack so it shares the same offsetParent
    // (and therefore coordinate space) already used by Plug's own drag math.
    (this.parentElement ?? document.body).appendChild(wireEl);

    const wire = wireEl.getWire();
    if (!wire) {
      wireEl.remove();
      return null;
    }

    const originPlug = originPlugEl as unknown as Plug;
    const followPlug = followPlugEl as unknown as Plug;

    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();

    const originNode = wire.getNode(0)!;
    const center = this.getCenter();
    originNode.setPosition(center.x - parentRect.left, center.y - parentRect.top);
    originNode.fixed = true;
    originPlug.attach(this);
    originPlug.setAttribute('plugged', 'true');
    originPlug.update();

    const followNode = wire.getNode(CABLE_MIN_NODES - 1)!;
    followNode.setPosition(e.clientX - parentRect.left, e.clientY - parentRect.top);
    followNode.fixed = true;
    followPlug.update();

    return { wireEl, wire, originPlug, followPlug, followNode };
  }

  /**
   * Grows `wire` from its current node count up to `desired`, inserting only
   * the missing nodes (Wire.addNodeAt) one at a time rather than rebuilding
   * the whole vector — every already-settled node keeps its live physics
   * state (position/velocity), unlike Wire.setNodeCount which reinterpolates
   * everything from scratch and visibly snaps the cable straight on every
   * growth step during a drag.
   *
   * Each new node is inserted right before the current free terminal. Where
   * it initially spawns is controlled by the `cable-node-spawn` attribute on
   * this Jack:
   * - "interpolate" (default): placed on the straight line between the last
   *   already-settled node and the cursor (the free terminal's current
   *   position) — smooth immediately, without touching the settled part.
   * - "stack": placed exactly on top of the last already-settled node, then
   *   left for the constraint solver to spread out over following frames
   *   (same pattern used by WasmWire::new_wire for a freshly created cable).
   *
   * Returns the new last node, so the caller can rebind the free Plug to it.
   */
  private _growCable(wire: Wire, desired: number): Node {
    const stack = this.getAttribute('cable-node-spawn') === 'stack';
    let count = wire.getNodeCount();
    const remaining = desired - count;
    const anchor = wire.getNode(count - 2)!;
    const target = wire.getNode(count - 1)!;
    const targetX = target.x;
    const targetY = target.y;

    for (let i = 1; i <= remaining; i++) {
      const insertIndex = count - 1;
      let nx: number;
      let ny: number;
      if (stack) {
        nx = anchor.x;
        ny = anchor.y;
      } else {
        const t = i / (remaining + 1);
        nx = anchor.x + (targetX - anchor.x) * t;
        ny = anchor.y + (targetY - anchor.y) * t;
      }
      wire.addNodeAt(insertIndex, nx, ny, false);
      count++;
    }

    return wire.getNode(count - 1)!;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._creatingWire || !this._creatingFollowPlug || !this._creatingFollowNode) return;

    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();
    const x = e.clientX - parentRect.left;
    const y = e.clientY - parentRect.top;

    // Anchor the free terminal at the cursor before any growth below: it's
    // the interpolation target used for newly-inserted nodes (see _growCable).
    this._creatingFollowNode.setPosition(x, y);
    // Mirrors Plug.handlePointerMove: keep feeding the world-mouse physics
    // interaction (repulsion of other cables) while this pointer is
    // captured by the Jack — preventDefault() on pointerdown (see
    // handlePointerDown) suppresses the native mousemove that Renderer
    // would otherwise use to drive it, freezing it for the drag's duration.
    this._creatingFollowNode.setMousePosition(x, y);

    const center = this.getCenter();
    const distance = Math.hypot(e.clientX - center.x, e.clientY - center.y);
    const desired = Math.min(
      CABLE_MAX_NODES,
      Math.max(CABLE_MIN_NODES, CABLE_MIN_NODES + Math.floor(distance * CABLE_NODES_PER_PX))
    );

    // Only ever grow the cable while dragging, never shorten it back down
    // as the cursor approaches again — once pulled out, it stays out.
    if (desired > this._creatingWire.getNodeCount()) {
      // Inserting only the missing nodes (rather than Wire.setNodeCount,
      // which rebuilds and reinterpolates the whole vector) leaves every
      // already-settled node's physics state untouched — the terminal
      // index still shifts, so rebind the Plug to the real new last node.
      const newNode = this._growCable(this._creatingWire, desired);
      this._creatingFollowPlug.setNode(newNode);
      this._creatingFollowNode = newNode;
      // Keep the DOM in sync with reality: CaviWireElement treats a
      // <cavi-plug node="N"> attribute as the ground truth for which node
      // index it's bound to (e.g. when re-deriving it after a sibling
      // wire's deletion shifts this wire's WASM index — see
      // _rebindAfterIndexShift in wirewc.ts). Leaving it at its
      // creation-time value here would make that later rebind snap the
      // plug back to a now-intermediate node instead of the real terminal.
      this._creatingFollowPlug.setAttribute('node', String(desired - 1));
    } else {
      this._creatingFollowPlug.update();
    }

    this._setMagnetTarget(this._findSnapTarget(this._creatingFollowPlug, this.type));
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.pointerId !== this._activePointerId) return;

    const followPlug = this._creatingFollowPlug;
    const followNode = this._creatingFollowNode;
    if (!followPlug || !followNode) {
      this._endCableDrag(e.pointerId);
      return;
    }

    const bestJack = this._findSnapTarget(followPlug, this.type);
    this._setMagnetTarget(null);

    if (bestJack) {
      const offsetParent = this.offsetParent || document.body;
      const parentRect = offsetParent.getBoundingClientRect();
      const c = bestJack.getCenter();

      followNode.setPosition(c.x - parentRect.left, c.y - parentRect.top);
      followNode.fixed = true;
      followPlug.update();
      followPlug.attach(bestJack);
      followPlug.setAttribute('plugged', 'true');
    } else {
      // Not dropped on any compatible Jack: the cable stays attached at
      // the origin with this end left dangling — same as a Plug dropped
      // away from every jack today (free to fall/move under physics).
      followNode.fixed = false;
    }

    this._endCableDrag(e.pointerId);
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (e.pointerId !== this._activePointerId) return;

    this._setMagnetTarget(null);
    if (this._creatingFollowNode) {
      this._creatingFollowNode.fixed = false;
    }
    this._endCableDrag(e.pointerId);
  }

  private _endCableDrag(pointerId: number): void {
    this.removeEventListener('pointermove', this.handlePointerMove);
    this.removeEventListener('pointerup', this.handlePointerUp);
    this.removeEventListener('pointercancel', this.handlePointerCancel);
    if (typeof this.releasePointerCapture === 'function') {
      try {
        this.releasePointerCapture(pointerId);
      } catch {
        // Not supported / not captured — safe to ignore.
      }
    }
    this._activePointerId = null;
    this._creatingWire = null;
    this._creatingFollowPlug = null;
    this._creatingFollowNode = null;
    Jack.setDragActive(false);
  }

  /**
   * Finds the nearest Jack (other than this one) compatible with `type`
   * and with room for another Plug, within snapping distance of `plug`'s
   * current on-screen position — same math as Plug's own _findSnapTarget.
   */
  private _findSnapTarget(plug: Plug, type: string): Jack | null {
    const rect = plug.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let bestJack: Jack | null = null;
    let bestDist = CABLE_SNAP_DISTANCE;

    for (const jack of Jack.registry) {
      if (jack === this) continue;
      if (!jack.canAcceptMore()) continue;
      if (!jack.canAccept(type)) continue;

      const c = jack.getCenter();
      const dist = Math.hypot(centerX - c.x, centerY - c.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestJack = jack;
      }
    }

    return bestJack;
  }

  private _setMagnetTarget(jack: Jack | null): void {
    if (jack === this._magnetJack) return;
    this._magnetJack?.setMagnetActive(false);
    jack?.setMagnetActive(true);
    this._magnetJack = jack;
    this._creatingFollowPlug?.setMagnetActive(jack !== null);
  }
}

customElements.define('cavi-jack', Jack);
