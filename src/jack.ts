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
  private _plugs = new Set<Plug>();
  private _maxPlugs: number = Infinity;

  private _activePointerId: number | null = null;
  private _magnetJack: Jack | null = null;
  private _creatingWire: Wire | null = null;
  private _creatingFollowPlug: Plug | null = null;
  private _creatingFollowNode: Node | null = null;

  static get observedAttributes() {
    return ['color', 'x', 'y', 'type', 'max-plugs', 'magnet-class'];
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
    }
    if (name === 'magnet-class') {
      this._magnetClass = newValue || 'cavi-magnet-target';
    }
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
  }

  /**
   * Unregisters a Plug from this Jack.
   */
  public detach(plug: Plug): void {
    this._plugs.delete(plug);
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
   */
  private handlePointerDown(e: PointerEvent): void {
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

  private handlePointerMove(e: PointerEvent): void {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._creatingWire || !this._creatingFollowPlug || !this._creatingFollowNode) return;

    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();
    const x = e.clientX - parentRect.left;
    const y = e.clientY - parentRect.top;

    // Anchor the free terminal at the cursor before any resize below: a
    // node-count change interpolates intermediates from this position.
    this._creatingFollowNode.setPosition(x, y);

    const center = this.getCenter();
    const distance = Math.hypot(e.clientX - center.x, e.clientY - center.y);
    const desired = Math.min(
      CABLE_MAX_NODES,
      Math.max(CABLE_MIN_NODES, CABLE_MIN_NODES + Math.floor(distance * CABLE_NODES_PER_PX))
    );

    // Only ever grow the cable while dragging, never shorten it back down
    // as the cursor approaches again — once pulled out, it stays out.
    if (desired > this._creatingWire.getNodeCount()) {
      this._creatingWire.setNodeCount(desired);
      // set_node_count rebuilds the node vector, so the terminal index
      // shifts — rebind the Plug to the real new last node.
      const newNode = this._creatingWire.getNode(desired - 1)!;
      this._creatingFollowPlug.setNode(newNode);
      this._creatingFollowNode = newNode;
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
