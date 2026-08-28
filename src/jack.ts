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
 * A cable-creation drag in progress, returned by Jack.createCable() and
 * threaded through Jack.updateCableSession/finishCableSession/
 * cancelCableSession by whoever drives the gesture (by default,
 * StandardInteractionController — see src/interaction.ts). Plain data, not
 * owned by any Jack instance, so the gesture's state can live entirely
 * outside the domain classes.
 */
export interface CableSession {
  wireEl: CaviWireElement;
  wire: Wire;
  /** The Jack this cable was created from — origin terminal, excluded from its own snap search. */
  jack: Jack;
  originPlug: Plug;
  followPlug: Plug;
  followNode: Node;
  /** Which Jack (if any) the follow end is currently magnet-highlighted over. */
  magnetJack: Jack | null;
}

/**
 * Jack represents a fixed connection point. Plug elements can be dropped
 * onto Jack elements, and a Jack can be used as a drag source to create a
 * brand new cable — see createCable/updateCableSession/finishCableSession/
 * cancelCableSession below.
 *
 * Jack is a pure domain/data element: it exposes public methods to
 * manipulate it and to drive a cable-creation gesture, and static setters
 * that accept external interaction state (setShiftHeld/
 * setPointerHoverPosition/setDragActive, used to decide its own visual
 * feedback — see _refreshFullState), but it never listens for pointer or
 * keyboard events itself and does not decide *how* a user interacts with
 * it. That is the job of whatever IInteractionController is attached to
 * the page — see StandardInteractionController (src/interaction.ts) for
 * the default mouse/touch/click implementation, and <cavi-interaction>
 * (src/interactionwc.ts) for how it's wired up declaratively.
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

  /**
   * Whether Shift is currently held, tracked globally across all jacks —
   * fed externally via Jack.setShiftHeld. This is a raw modifier preview,
   * independent of any drag actually being in progress — it already
   * applies on a plain hover before any drag starts, so it's kept separate
   * from _activeDragCount below.
   */
  private static _shiftHeld: boolean = false;
  /**
   * How many drags that could try to connect a plug to a jack are
   * currently in progress, fed externally via Jack.setDragActive — a count
   * rather than a boolean so overlapping/concurrent drags (e.g.
   * multi-touch, or a plug drag and a cable-creation drag happening at
   * once) don't clear each other's state early.
   */
  private static _activeDragCount: number = 0;
  private static get _dragActive(): boolean {
    return Jack._activeDragCount > 0;
  }
  /**
   * Last known pointer position (viewport coordinates), fed externally via
   * Jack.setPointerHoverPosition, so "is the cursor over this Jack" can be
   * recomputed by distance rather than native hover events — a Jack that
   * already has a Plug attached has that Plug sitting exactly on top of it
   * (higher z-index), which would otherwise swallow pointerenter/
   * pointerleave before they ever reach it.
   */
  private static _pointerX: number | null = null;
  private static _pointerY: number | null = null;

  static get observedAttributes() {
    return ['color', 'x', 'y', 'type', 'max-plugs', 'magnet-class', 'full-class', 'at-capacity-class'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    Jack._registry.add(this);
    this.render();
    this.updatePosition();
  }

  disconnectedCallback() {
    Jack._registry.delete(this);
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

  private static _refreshAll(): void {
    for (const jack of Jack._registry) {
      jack._refreshFullState();
    }
  }

  /**
   * Public entry point for "Shift is held" — whoever drives interaction
   * (by default StandardInteractionController) calls this in response to
   * keydown/keyup/blur.
   */
  public static setShiftHeld(held: boolean): void {
    if (held === Jack._shiftHeld) return;
    Jack._shiftHeld = held;
    Jack._refreshAll();
  }

  /**
   * Public entry point for "the pointer is now at this viewport position" —
   * whoever drives interaction calls this on every pointermove. Pass
   * null/null to clear (e.g. pointer left the window, or no controller is
   * currently attached).
   */
  public static setPointerHoverPosition(x: number | null, y: number | null): void {
    Jack._pointerX = x;
    Jack._pointerY = y;
    Jack._refreshAll();
  }

  /**
   * Called whenever a drag that could try to connect a plug to a jack
   * starts/stops — by whoever drives interaction, for both Plug relocating
   * an existing connection and a Jack cable-creation drag — so a full jack
   * previews itself as forbidden on hover for the whole duration of either
   * gesture, not just while Shift happens to be held.
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
   *   an active drag that could try to connect here.
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
   * Finds the nearest Jack compatible with `type` and with room for another
   * Plug, within snapping distance of `plug`'s current on-screen position.
   * Pass `exclude` to skip a particular Jack (e.g. the one a cable is being
   * dragged out of, which should never snap to itself). Shared by both a
   * Plug's own drag-to-jack magnet effect and this class's cable-creation
   * drag.
   */
  public static findSnapTarget(plug: Plug, type: string, exclude?: Jack): Jack | null {
    const rect = plug.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let bestJack: Jack | null = null;
    let bestDist = CABLE_SNAP_DISTANCE;

    for (const jack of Jack.registry) {
      if (exclude && jack === exclude) continue;
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

  /**
   * Starts creating a brand new cable from this Jack, with the free
   * terminal initially placed at (clientX, clientY) (viewport coordinates).
   * Builds a <cavi-wire> with two <cavi-plug> terminals — one attached
   * here, the other free — and returns a CableSession describing it, to be
   * driven onward via updateCableSession/finishCableSession/
   * cancelCableSession. Returns null (no-op) if Cavi isn't ready yet, or if
   * this Jack has no room for another Plug — the domain enforces its own
   * `max-plugs` invariant rather than trusting every caller to check
   * canAcceptMore() first.
   */
  public createCable(clientX: number, clientY: number): CableSession | null {
    if (!this.canAcceptMore()) return null;
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
    followNode.setPosition(clientX - parentRect.left, clientY - parentRect.top);
    followNode.fixed = true;
    followPlug.update();

    return { wireEl, wire, jack: this, originPlug, followPlug, followNode, magnetJack: null };
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
  public growCable(wire: Wire, desired: number): Node {
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

  /**
   * Toggles the magnet-highlight pairing (candidate Jack + the session's
   * follow Plug) for an in-progress cable-creation session, mirroring
   * Plug's own private _setMagnetTarget but keyed off session state instead
   * of an instance field, since a Jack doesn't own any particular
   * cable-creation session the way a Plug owns its own drag.
   */
  private static _setSessionMagnetTarget(session: CableSession, jack: Jack | null): void {
    if (jack === session.magnetJack) return;
    session.magnetJack?.setMagnetActive(false);
    jack?.setMagnetActive(true);
    session.magnetJack = jack;
    session.followPlug.setMagnetActive(jack !== null);
  }

  /**
   * Advances an in-progress cable-creation session to a new cursor
   * position (viewport coordinates): moves the free terminal, feeds the
   * WASM mouse-interaction position, grows the cable if the cursor is far
   * enough from the origin (never shrinks back down — see growCable), and
   * refreshes the magnet-highlight preview.
   */
  public static updateCableSession(session: CableSession, clientX: number, clientY: number): void {
    const offsetParent = session.jack.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();
    const x = clientX - parentRect.left;
    const y = clientY - parentRect.top;

    // Anchor the free terminal at the cursor before any growth below: it's
    // the interpolation target used for newly-inserted nodes (see growCable).
    session.followNode.setPosition(x, y);
    // Mirrors Plug's own drag: keep feeding the world-mouse physics
    // interaction (repulsion of other cables) while this gesture is in
    // progress.
    session.followNode.setMousePosition(x, y);

    const center = session.jack.getCenter();
    const distance = Math.hypot(clientX - center.x, clientY - center.y);
    const desired = Math.min(
      CABLE_MAX_NODES,
      Math.max(CABLE_MIN_NODES, CABLE_MIN_NODES + Math.floor(distance * CABLE_NODES_PER_PX))
    );

    // Only ever grow the cable while dragging, never shorten it back down
    // as the cursor approaches again — once pulled out, it stays out.
    if (desired > session.wire.getNodeCount()) {
      // Inserting only the missing nodes (rather than Wire.setNodeCount,
      // which rebuilds and reinterpolates the whole vector) leaves every
      // already-settled node's physics state untouched — the terminal
      // index still shifts, so rebind the Plug to the real new last node.
      const newNode = session.jack.growCable(session.wire, desired);
      session.followPlug.setNode(newNode);
      session.followNode = newNode;
      // Keep the DOM in sync with reality: CaviWireElement treats a
      // <cavi-plug node="N"> attribute as the ground truth for which node
      // index it's bound to (e.g. when re-deriving it after a sibling
      // wire's deletion shifts this wire's WASM index — see
      // _rebindAfterIndexShift in wirewc.ts). Leaving it at its
      // creation-time value here would make that later rebind snap the
      // plug back to a now-intermediate node instead of the real terminal.
      session.followPlug.setAttribute('node', String(desired - 1));
    } else {
      session.followPlug.update();
    }

    Jack._setSessionMagnetTarget(session, Jack.findSnapTarget(session.followPlug, session.jack.type, session.jack));
  }

  /**
   * Attaches the session's free terminal to the best jack under it right
   * now, or — if none is in range — leaves it dangling (falling under
   * physics).
   */
  public static finishCableSession(session: CableSession): void {
    const bestJack = Jack.findSnapTarget(session.followPlug, session.jack.type, session.jack);
    Jack._setSessionMagnetTarget(session, null);

    if (bestJack) {
      const offsetParent = session.jack.offsetParent || document.body;
      const parentRect = offsetParent.getBoundingClientRect();
      const c = bestJack.getCenter();

      session.followNode.setPosition(c.x - parentRect.left, c.y - parentRect.top);
      session.followNode.fixed = true;
      session.followPlug.update();
      session.followPlug.attach(bestJack);
      session.followPlug.setAttribute('plugged', 'true');
    } else {
      // Not dropped on any compatible Jack: the cable stays attached at
      // the origin with this end left dangling — same as a Plug dropped
      // away from every jack (free to fall/move under physics).
      session.followNode.fixed = false;
    }
  }

  /** Abandons an in-progress cable-creation session: free end left dangling. */
  public static cancelCableSession(session: CableSession): void {
    Jack._setSessionMagnetTarget(session, null);
    session.followNode.fixed = false;
  }
}

customElements.define('cavi-jack', Jack);
