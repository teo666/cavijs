import type { Plug } from './plug';
import type { Wire } from '../core/wire';
import type { Node } from '../core/node';
import type { CaviWireElement } from './wirewc';
import { Cavi } from '../core/cavi';
import { clientToWorld, IDENTITY_TRANSFORM, type CoordinateTransform } from '../core/coords';
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
 * that accept external interaction state (setPointerHoverPosition/
 * setDragActive, used to decide its own visual
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
   * Whether this Jack's attached Plugs are currently spread out (see
   * _refreshSpread) — fanned away from the Jack's center so each can be
   * individually clicked to relocate it, while the Jack's own center
   * becomes clickable again to start a new cable. Read by Plug.isSpread()
   * to decide whether a click on it should relocate that Plug or forward
   * to this Jack (see StandardInteractionController).
   */
  private _spread: boolean = false;
  private _recompactTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Watches this Jack's own rendered box for changes (a responsive
   * flex/grid reflow, window resize, content/font load, ...) so a Jack with
   * no explicit `x`/`y` (see _hasExplicitPosition/getWorldPosition) keeps
   * any already-plugged cable glued to it as its CSS-driven position moves.
   * Only created for a Jack in auto-position mode — see
   * connectedCallback/disconnectedCallback.
   */
  private _resizeObserver: ResizeObserver | null = null;
  /**
   * The <cavi-world>/renderer container this Jack listens to for
   * 'cavi-transform-change' (see Cavi.notifyCoordinateTransformChanged) —
   * a pure CSS-transform pan/zoom step changes this Jack's rendered
   * position without changing its own box size, so it never fires
   * _resizeObserver on its own and needs this separate signal instead.
   * Tracked so disconnectedCallback can remove the exact same listener.
   */
  private _transformChangeContainer: HTMLElement | null = null;
  private _onTransformChange = (): void => this._syncAutoPosition();

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
    return [
      'color',
      'x',
      'y',
      'type',
      'max-plugs',
      'magnet-class',
      'full-class',
      'at-capacity-class',
    ];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    Jack._registry.add(this);
    this.render();
    this.updatePosition();
    this._setupAutoPositionWatchers();
    // <cavi-world>'s Cavi instance is created asynchronously (after WASM
    // init) — if it isn't ready yet, the container-based
    // 'cavi-transform-change' listener above attached to nothing. Re-run
    // once this Jack's own world is ready.
    if (!Cavi.for(this)) {
      Cavi.whenReady(this, () => {
        if (this.isConnected) this._setupAutoPositionWatchers();
      });
    }
  }

  disconnectedCallback() {
    Jack._registry.delete(this);
    this._cancelRecompactTimer();
    this._teardownAutoPositionWatchers();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === 'color') {
      this.render();
    }
    if (name === 'x' || name === 'y') {
      // Adding/removing x or y can flip _hasExplicitPosition() and
      // therefore the positioning mode itself (see render()'s :host
      // position/transform), not just the coordinate values.
      this.render();
      this.updatePosition();
      this._setupAutoPositionWatchers();
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
   * Runs on every pointer move. All layout reads (bounding rects) happen in
   * a first pass and all DOM writes (classes, cursor, spread positions) in a
   * second: interleaving them per jack forced the browser into one
   * synchronous layout per jack on every pointermove, which gets expensive
   * with a large patchbay.
   */
  private static _refreshAll(): void {
    const measured = Array.from(Jack._registry, (jack) => ({
      jack,
      blocked: jack._computeBlocked(),
      hovering: jack._plugs.size > 0 && !Jack._dragActive && jack._hoveringExpandedArea(),
    }));
    for (const { jack, blocked, hovering } of measured) {
      jack._applyFullState(blocked);
      jack._refreshSpread(hovering);
    }
  }

  /**
   * Whether this Jack's attached Plugs are currently spread out — see
   * `_spread` above.
   */
  public isSpread(): boolean {
    return this._spread;
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
   * previews itself as forbidden on hover for the whole duration of the
   * gesture, and so the hover-spread mechanic (_refreshSpread) stays out
   * of the way while a drag is in progress.
   */
  public static setDragActive(active: boolean): void {
    const before = Jack._dragActive;
    Jack._activeDragCount += active ? 1 : -1;
    if (Jack._dragActive !== before) Jack._refreshAll();
  }

  /**
   * Refreshes two independent, capacity-driven visual states on every
   * pointer move, drag start/end, and whenever this Jack's own capacity
   * changes (attach/detach/max-plugs), so all stay correct without needing
   * the pointer to move again:
   * - `at-capacity-class`: unconditional — on for as long as this Jack has
   *   reached `max-plugs`, regardless of hover or dragging.
   * - `full-class` + "not-allowed" cursor: a hover-only preview, shown
   *   while the cursor is over an at-capacity Jack during an active drag
   *   that could try to connect here.
   */
  private _refreshFullState(): void {
    this._applyFullState(this._computeBlocked());
  }

  /**
   * Read-only half of _refreshFullState: whether the "you can't drop here"
   * preview should show. Only measures anything while a drag is active over
   * an at-capacity jack — the common case costs no layout read at all.
   */
  private _computeBlocked(): boolean {
    if (!Jack._dragActive || this.canAcceptMore()) return false;
    if (Jack._pointerX === null || Jack._pointerY === null) return false;
    // Measured in world space against the same CABLE_SNAP_DISTANCE
    // findSnapTarget uses, so this preview lights up over exactly the ring
    // that would actually accept the drop — at any zoom level.
    const c = this.getWorldPosition();
    const p = this._clientToLocal(Jack._pointerX, Jack._pointerY);
    return Math.hypot(p.x - c.x, p.y - c.y) <= CABLE_SNAP_DISTANCE;
  }

  /** Write-only half of _refreshFullState. */
  private _applyFullState(blocked: boolean): void {
    this.classList.toggle(this._atCapacityClass, !this.canAcceptMore());
    this.classList.toggle(this._fullClass, blocked);
    const cursor = blocked ? 'not-allowed' : '';
    if (this.style.cursor !== cursor) this.style.cursor = cursor;
  }

  /** Distance (viewport px) from the pointer to a point, or Infinity if there's no known pointer position. */
  private static _pointerDistanceTo(x: number, y: number): number {
    if (Jack._pointerX === null || Jack._pointerY === null) return Infinity;
    return Math.hypot(Jack._pointerX - x, Jack._pointerY - y);
  }

  /**
   * The radius (viewport px) around this Jack's own center that counts as
   * "hovering" for spread purposes — its own rendered half-size, so bigger
   * jacks are easier to hover.
   */
  private _hoverRadius(): number {
    const rect = this.getBoundingClientRect();
    return Math.max(rect.width, rect.height) / 2;
  }

  /**
   * Whether the pointer currently counts as hovering this Jack's expanded
   * area: within its own hover radius, or within any of its (possibly
   * already spread-out) Plugs' own hover radius — so moving from the
   * center out to a spread Plug, or between two spread Plugs, counts as
   * staying inside the area instead of triggering a recompact.
   */
  private _hoveringExpandedArea(): boolean {
    const c = this.getCenter();
    if (Jack._pointerDistanceTo(c.x, c.y) <= this._hoverRadius()) return true;
    for (const plug of this._plugs) {
      const pc = plug.getBoundingClientRect();
      const px = pc.left + pc.width / 2;
      const py = pc.top + pc.height / 2;
      const pr = Math.max(pc.width, pc.height) / 2;
      if (Jack._pointerDistanceTo(px, py) <= pr) return true;
    }
    return false;
  }

  /**
   * Hover-spread state machine, run alongside _refreshFullState on every
   * pointer move (see _refreshAll): fans this Jack's attached Plugs out on
   * hover so each can be clicked individually, and recompacts them back to
   * center after a timeout once the pointer leaves the expanded area — the
   * timeout resets, rather than continuing to count down, if the pointer
   * re-enters before it fires. No-op for a Jack with no Plugs, or while
   * some other drag is in progress (so the spread animation doesn't fight
   * an unrelated active gesture). `hovering` is measured up front by
   * _refreshAll's read pass.
   */
  private _refreshSpread(hovering: boolean): void {
    if (this._plugs.size === 0) {
      this._cancelRecompactTimer();
      this._spread = false;
      return;
    }
    if (Jack._dragActive) return;

    if (hovering) {
      this._cancelRecompactTimer();
      if (!this._spread) {
        this._spread = true;
        this._applySpreadPositions();
      }
      return;
    }

    if (this._spread && this._recompactTimer === null) {
      const cavi = Cavi.for(this);
      const delay = cavi?.getPlugSpreadRecompactDelayMs?.() ?? 500;
      this._recompactTimer = setTimeout(() => {
        this._recompactTimer = null;
        if (this._hoveringExpandedArea()) return;
        this._spread = false;
        for (const plug of this._plugs) plug.snapToJack();
      }, delay);
    }
  }

  private _cancelRecompactTimer(): void {
    if (this._recompactTimer !== null) {
      clearTimeout(this._recompactTimer);
      this._recompactTimer = null;
    }
  }

  /**
   * Computes and applies a spread-out position for every attached Plug,
   * per Cavi's configured plugSpreadMode:
   * - 'towardOther' (default): each Plug spreads toward its own cable's
   *   far end, with a pairwise angular-separation pass so near-parallel
   *   cables never visually overlap once spread.
   * - 'radial': Plugs are evenly distributed around the Jack, ignoring
   *   cable direction.
   * Moves each Plug's underlying physics node (kept `fixed`), so the cable
   * visibly bends toward the spread position rather than just moving a
   * disconnected hit-target.
   */
  private _applySpreadPositions(): void {
    const cavi = Cavi.for(this);
    const plugs = Array.from(this._plugs);
    const screenCenter = this.getCenter();
    const mode = cavi?.getPlugSpreadMode?.() ?? 'towardOther';

    // Angles are computed from on-screen geometry (a direction is
    // scale-invariant, so no conversion is needed for them)...
    let angles: number[];
    if (mode === 'radial' || plugs.length === 1) {
      angles = plugs.map((_, i) => (i * 2 * Math.PI) / plugs.length);
    } else {
      angles = plugs.map((plug) => this._towardOtherEndAngle(plug, screenCenter));
      angles = Jack._resolveAngularCollisions(
        angles,
        this._hoverRadius(),
        plugs[0]?.getBoundingClientRect().width / 2 || this._hoverRadius() / 4
      );
    }

    // ...but the positions handed to setSpreadPosition are *world* values
    // (they become physics node coordinates), so both the center and the
    // spread radius have to be world lengths too. _hoverRadius() is
    // measured from a client rect and therefore already multiplied by the
    // current zoom — leaving it unscaled here fanned the plugs out `scale`
    // times too far on every zoom step, the most visible symptom of the
    // screen/world mix-up this whole file used to have.
    const center = this.getWorldPosition();
    const radius =
      (this._hoverRadius() / this._worldTransform().scale) *
      (cavi?.getPlugSpreadRadiusMultiplier?.() ?? 1.8);

    plugs.forEach((plug, i) => {
      const angle = angles[i];
      plug.setSpreadPosition(
        center.x + radius * Math.cos(angle),
        center.y + radius * Math.sin(angle)
      );
    });
  }

  /** The angle (radians) from `center` toward `plug`'s cable's other terminal, or a stable fallback if it can't be found. */
  private _towardOtherEndAngle(plug: Plug, center: { x: number; y: number }): number {
    const other = plug.getOtherEndCenter();
    if (other) return Math.atan2(other.y - center.y, other.x - center.x);
    // No other end found (shouldn't normally happen for an attached Plug)
    // — spread it straight down rather than stacking it on the center.
    return Math.PI / 2;
  }

  /**
   * Pairwise angular-separation pass: sorts the given angles and pushes any
   * pair closer than `minGap` apart symmetrically around their midpoint,
   * repeating around the sorted ring until every neighboring gap (including
   * the wrap-around one) clears the minimum. `minGap` is derived from the
   * plug/spread-radius ratio so spread Plugs never visually overlap.
   */
  private static _resolveAngularCollisions(
    angles: number[],
    radius: number,
    plugRadius: number
  ): number[] {
    if (angles.length < 2 || radius <= 0) return angles;
    const ratio = Math.min(1, plugRadius / radius);
    const minGap = 2 * Math.asin(ratio);
    if (minGap <= 0) return angles;

    const order = angles.map((_, i) => i).sort((a, b) => angles[a] - angles[b]);
    const sorted = order.map((i) => angles[i]);

    // A handful of relaxation passes is enough to settle any reasonable
    // number of cables on one jack without needing a full solver.
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i < sorted.length; i++) {
        const j = (i + 1) % sorted.length;
        let gap = sorted[j] - sorted[i];
        if (j === 0) gap += 2 * Math.PI;
        if (gap < minGap) {
          const push = (minGap - gap) / 2;
          sorted[i] -= push;
          sorted[j] += push;
          moved = true;
        }
      }
      if (!moved) break;
    }

    const result: number[] = Array.from({ length: angles.length }, () => 0);
    order.forEach((originalIndex, sortedIndex) => {
      result[originalIndex] = sorted[sortedIndex];
    });
    return result;
  }

  /**
   * Whether this Jack has an explicit `x` and/or `y` attribute — the
   * positioning mode switch used throughout this class. When true, those
   * attributes remain the sole source of truth for this Jack's position,
   * exactly as before this feature existed. When false, this Jack's
   * position is left entirely to CSS (flexbox/grid/whatever the page
   * already does), and getWorldPosition() derives it from the actual
   * rendered box instead.
   */
  private _hasExplicitPosition(): boolean {
    return this.hasAttribute('x') || this.hasAttribute('y');
  }

  /**
   * This Jack's position in world/logical coordinates: the ground truth fed
   * to <cavi-wire>'s declarative jack-bound plugs (see wirewc.ts's
   * getWorldPosition() calls) and usable by any other consumer that needs
   * this Jack's position without caring whether it came from explicit
   * attributes or CSS layout.
   *
   * - Explicit mode (`x`/`y` set): reproduces the historical
   *   `parseFloat(getAttribute(...))` behavior exactly — unaffected by any
   *   registered coordinate transform, since an author who typed exact
   *   numbers presumably wants exactly those numbers.
   * - Auto mode (no `x`/`y`): measures this Jack's actual rendered center
   *   (getCenter(), viewport px) and converts it to world space through
   *   _clientToLocal below — anchored on the *renderer container*, so the
   *   result is the very same origin `<cavi-plug>`'s absolute `left`/`top`
   *   and the renderer's canvas resolve against, and is unaffected by the
   *   current on-screen zoom/pan.
   */
  public getWorldPosition(): { x: number; y: number } {
    if (this._hasExplicitPosition()) {
      return {
        x: parseFloat(this.getAttribute('x') ?? '0'),
        y: parseFloat(this.getAttribute('y') ?? '0'),
      };
    }

    const c = this.getCenter();
    return this._clientToLocal(c.x, c.y);
  }

  /**
   * The element world coordinate (0, 0) is anchored on: the renderer's own
   * container (<cavi-world>) of the world `el` belongs to (see Cavi.for),
   * never an individual element's `offsetParent`.
   *
   * Anchoring on `offsetParent` — as this class and Plug used to — silently
   * splits the coordinate space the moment the page nests any
   * `position: relative` wrapper between <cavi-world> and its jacks (a
   * CSS-Grid panel, a draggable module box, a card, ...): that wrapper
   * becomes the *jacks'* offsetParent, while a <cavi-plug> (child of a
   * `display: contents` <cavi-wire> hanging directly off <cavi-world>) and
   * the canvas keep resolving against the container. Every jack in such a
   * wrapper then reports a position short by the wrapper's own offset, and
   * its cables render visibly detached from it. One shared anchor removes
   * the whole class of bug — and the CSS contortions consumers otherwise
   * need to keep every wrapper unpositioned.
   */
  private static _worldContainerOf(el: Element): HTMLElement {
    return Cavi.for(el)?.getContainer?.() ?? document.body;
  }

  /** The registered screen<->world transform of `el`'s world, or identity if none/no Cavi. */
  private static _worldTransformOf(el: Element): CoordinateTransform {
    return Cavi.for(el)?.getCoordinateTransform?.() ?? IDENTITY_TRANSFORM;
  }

  private _worldTransform(): CoordinateTransform {
    return Jack._worldTransformOf(this);
  }

  /**
   * Converts a raw viewport point (e.g. PointerEvent.clientX/clientY) into
   * the container-relative world space of `el`'s world — used everywhere a
   * session/drag needs to place a node under the live cursor (createCable,
   * updateCableSession, ...), and by getWorldPosition() for a measured
   * element center.
   */
  private static _clientToLocalOf(
    el: Element,
    clientX: number,
    clientY: number
  ): { x: number; y: number } {
    return clientToWorld(clientX, clientY, Jack._worldContainerOf(el), Jack._worldTransformOf(el));
  }

  private _clientToLocal(clientX: number, clientY: number): { x: number; y: number } {
    return Jack._clientToLocalOf(this, clientX, clientY);
  }

  private updatePosition() {
    if (this._hasExplicitPosition()) {
      const x = this.getAttribute('x') || '0';
      const y = this.getAttribute('y') || '0';
      this.style.left = `${x}px`;
      this.style.top = `${y}px`;
    }
    // In auto mode, this Jack's position is left entirely to CSS — nothing
    // to set here, but already-plugged cables still need re-gluing below
    // whenever this runs (e.g. right after connecting).

    // Keep any already-plugged cables glued to this jack when it moves
    // (e.g. a responsive layout reflow recomputing x/y on resize) instead
    // of leaving their fixed endpoint stranded at the old position.
    for (const plug of this._plugs) plug.snapToJack();
  }

  /**
   * Re-measures and re-glues plugged cables — see
   * _resizeObserver/_onTransformChange. No-op in explicit-position mode.
   */
  private _syncAutoPosition(): void {
    if (this._hasExplicitPosition()) return;
    for (const plug of this._plugs) plug.snapToJack();
  }

  /**
   * Creates this Jack's auto-position watchers (ResizeObserver +
   * 'cavi-transform-change' listener) if it's in auto-position mode and
   * they don't already exist — idempotent, since attributeChangedCallback
   * can flip the mode after connectedCallback already ran, and a custom
   * element can also receive attributeChangedCallback before
   * connectedCallback during upgrade. In explicit-position mode, any
   * previously-created watchers (from before x/y were added) are torn down
   * instead, since they'd otherwise keep firing pointless re-syncs.
   */
  private _setupAutoPositionWatchers(): void {
    if (this._hasExplicitPosition()) {
      this._teardownAutoPositionWatchers();
      return;
    }
    if (!this._resizeObserver && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._syncAutoPosition());
      this._resizeObserver.observe(this);
    }
    const container = Cavi.for(this)?.getContainer() ?? null;
    if (container !== this._transformChangeContainer) {
      this._transformChangeContainer?.removeEventListener(
        'cavi-transform-change',
        this._onTransformChange
      );
      container?.addEventListener('cavi-transform-change', this._onTransformChange);
      this._transformChangeContainer = container;
    }
  }

  private _teardownAutoPositionWatchers(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._transformChangeContainer?.removeEventListener(
      'cavi-transform-change',
      this._onTransformChange
    );
    this._transformChangeContainer = null;
  }

  private render() {
    const color = this.getAttribute('color') || '#333';
    // Basic default style. The default appearance is a plain circle (the
    // `.base` layer, exactly as :host used to render on its own) — `:host`
    // itself carries no visuals now, just sizing/position/cursor, so a
    // consumer restyling `.base`/`.hex` (via `::part`, see below) never has
    // to fight a background/border already set at the host level.
    //
    // `.hex` is a second, smaller layer with a hexagonal clip-path baked
    // in, stacked on top of `.base` but with no background of its own by
    // default — invisible, adding nothing to the default look, until a
    // consumer styles it (e.g. `cavi-jack::part(hex) { background: ...; }`)
    // to get a hex nut sitting on a round base/flange (the visible ring
    // between the two), like a real 1/4" jack socket. `part="..."` on each
    // exposes them to page-level CSS despite Shadow DOM encapsulation,
    // without hardcoding any particular metal look into the library itself
    // — see demo-patchbay.html for a themed example.
    // Explicit x/y mode positions/centers this host itself via absolute
    // positioning (unchanged from before this attribute became optional).
    // In auto mode there is no x/y to position from — this host is left to
    // the page's own CSS layout (flexbox/grid/flow/...) entirely, and its
    // rendered position is instead measured back out via getWorldPosition().
    //
    // Auto mode still needs `position: relative` (not `static`) on :host,
    // even though it never sets top/left/transform itself: `:host`'s own
    // `position` is what makes it a containing block for this shadow
    // tree's `.base`/`.hex` (`position: absolute; inset: 0`) and `.inner`
    // (`position: absolute; top/left: 50%`) below. A `position: static`
    // host is not a containing block, so those absolutely-positioned
    // descendants escape the shadow boundary entirely and resolve against
    // the nearest *positioned ancestor in the light DOM* instead (e.g. a
    // CSS-Grid panel with `position: relative`) — silently stretching a
    // jack's visuals to fill that ancestor's whole box.
    const explicitPosition = this._hasExplicitPosition();
    const style = `
            :host {
                display: block;
                width: 24px;
                height: 24px;
                position: ${explicitPosition ? 'absolute' : 'relative'};
                box-sizing: border-box;
                z-index: 10; /* Jack under Plug */
                ${explicitPosition ? 'transform: translate(-50%, -50%); /* Centered on coordinates */' : ''}
                cursor: crosshair; /* Hints that dragging from here creates a cable */
                touch-action: none; /* Prevent the browser from scrolling while dragging on touch */
            }
            .base {
                position: absolute;
                inset: 0;
                box-sizing: border-box;
                border-radius: 50%;
                background-color: ${color};
                border: 2px solid #555;
            }
            .hex {
                position: absolute;
                inset: 7%;
                box-sizing: border-box;
                /* A true regular hexagon (flat top/bottom, pointed left/
                   right), not just a rough approximation: fills the box
                   left-to-right, so its height (width * sin(60deg)) leaves
                   6.7% padding top and bottom — a shape stretched to fill
                   the box vertically as well would read as round instead
                   of hexagonal. */
                clip-path: polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%);
            }
            .inner {
                width: 16px;
                height: 16px;
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
                <div class="base" part="base"></div>
                <div class="hex" part="hex"></div>
                <div class="inner" part="inner"></div>
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
    // Compared in *world* space, not raw screen px: jacks are drawn
    // `scale` times bigger/smaller under zoom, so a fixed screen-px
    // threshold silently shrinks the snap ring to a fraction of a jack when
    // zoomed in, and grows it over several neighboring jacks when zoomed
    // out — the snap stops matching what the user sees.
    const center = Jack._clientToLocalOf(
      plug,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    // Only jacks of the plug's own world: with several <cavi-world>s on a
    // page, a cable must never snap to a jack of another simulation.
    const world = Cavi.for(plug);

    let bestJack: Jack | null = null;
    let bestDist = CABLE_SNAP_DISTANCE;

    for (const jack of Jack.registry) {
      if (exclude && jack === exclude) continue;
      if (Cavi.for(jack) !== world) continue;
      if (!jack.canAcceptMore()) continue;
      if (!jack.canAccept(type)) continue;

      const c = jack.getWorldPosition();
      const dist = Math.hypot(center.x - c.x, center.y - c.y);
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
    const cavi = Cavi.for(this);
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

    // Inserted directly into the world container, never next to this Jack:
    // a <cavi-plug> is `position: absolute` with left/top in world
    // coordinates, so it must resolve against the container's padding box
    // (the same origin the canvas and every conversion use — see
    // _worldContainerOf). Next to the Jack, any positioned or transformed
    // wrapper in between (a CSS-Grid panel, a module box dragged with
    // `transform`, ...) would become the plugs' containing block instead,
    // and the plugs would render offset by that wrapper's own position.
    (cavi.getContainer() ?? this.parentElement ?? document.body).appendChild(wireEl);

    const wire = wireEl.getWire();
    if (!wire) {
      wireEl.remove();
      return null;
    }

    const originPlug = originPlugEl as unknown as Plug;
    const followPlug = followPlugEl as unknown as Plug;

    const originNode = wire.getNode(0)!;
    const originLocal = this.getWorldPosition();
    originNode.setPosition(originLocal.x, originLocal.y);
    originNode.fixed = true;
    originPlug.attach(this);
    originPlug.setAttribute('plugged', 'true');
    originPlug.update();

    const followNode = wire.getNode(CABLE_MIN_NODES - 1)!;
    const followLocal = this._clientToLocal(clientX, clientY);
    followNode.setPosition(followLocal.x, followLocal.y);
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
    const { x, y } = session.jack._clientToLocal(clientX, clientY);

    // Anchor the free terminal at the cursor before any growth below: it's
    // the interpolation target used for newly-inserted nodes (see growCable).
    session.followNode.setPosition(x, y);
    // Mirrors Plug's own drag: keep feeding the world-mouse physics
    // interaction (repulsion of other cables) while this gesture is in
    // progress.
    session.followNode.setMousePosition(x, y);

    // World-space distance, so a cable grows the same number of nodes for
    // the same logical reach regardless of the current zoom level.
    const center = session.jack.getWorldPosition();
    const distance = Math.hypot(x - center.x, y - center.y);
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
      // Keep the DOM in sync with reality: a <cavi-plug node="N"> attribute
      // is the declarative ground truth for which node index it's bound
      // to. Leaving it at its creation-time value here would make anything
      // that later re-derives the binding from markup snap the plug back to
      // a now-intermediate node instead of the real terminal.
      session.followPlug.setAttribute('node', String(desired - 1));
    } else {
      session.followPlug.update();
    }

    Jack._setSessionMagnetTarget(
      session,
      Jack.findSnapTarget(session.followPlug, session.jack.type, session.jack)
    );
  }

  /**
   * Attaches the session's free terminal to the best jack under it right
   * now, or — if none is in range — falls back to Cavi's configured
   * `cableDropBehavior` ('detach' by default): 'dangle' leaves just this
   * end unfixed (cable stays attached at the origin); 'detach' also unfixes
   * the origin end, so the whole cable falls away disconnected; 'cancel'
   * removes the in-progress <cavi-wire> outright.
   */
  public static finishCableSession(session: CableSession): void {
    const bestJack = Jack.findSnapTarget(session.followPlug, session.jack.type, session.jack);
    Jack._setSessionMagnetTarget(session, null);

    if (bestJack) {
      const local = bestJack.getWorldPosition();

      session.followNode.setPosition(local.x, local.y);
      session.followNode.fixed = true;
      session.followPlug.update();
      session.followPlug.attach(bestJack);
      session.followPlug.setAttribute('plugged', 'true');
      return;
    }

    const behavior = Cavi.for(session.jack)?.getCableDropBehavior?.() ?? 'detach';
    if (behavior === 'cancel') {
      session.originPlug.detach();
      session.followPlug.detach();
      session.wireEl.remove();
      return;
    }

    // Not dropped on any compatible Jack: this end is left dangling (free
    // to fall/move under physics) — same as a Plug dropped away from every
    // jack.
    session.followNode.fixed = false;
    if (behavior === 'detach') {
      // Also unfix the origin end so the whole cable falls away
      // disconnected, rather than staying tethered to its origin Jack.
      const originNode = session.wire.getNode(0);
      if (originNode) originNode.fixed = false;
      session.originPlug.detach();
      session.originPlug.removeAttribute('plugged');
      // A fully detached cable is attached to nothing: once it has drifted
      // out of view it is deleted, instead of being simulated forever.
      session.wireEl.setAttribute('auto-cleanup', '');
    }
  }

  /** Abandons an in-progress cable-creation session: free end left dangling. */
  public static cancelCableSession(session: CableSession): void {
    Jack._setSessionMagnetTarget(session, null);
    session.followNode.fixed = false;
  }
}

customElements.define('cavi-jack', Jack);
