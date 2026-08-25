import { Node } from './node';
import { Jack } from './jack'; // Ensure Jack is imported if we check types

/**
 * Plug represents a movable terminal of a cable.
 * Can be dragged and snapped to Jack elements.
 */
export class Plug extends HTMLElement {
  private _node: Node | null = null;
  private _jack: Jack | null = null;
  private _dragging: boolean = false;
  private _snapDistance: number = 20;
  private _activePointerId: number | null = null;
  private _magnetJack: Jack | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Bind methods
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
  }

  private _type: string = '';
  private _magnetClass: string = 'cavi-magnet-active';
  private _freezeOnDrop: boolean = false;

  static get observedAttributes() {
    return ['plugged', 'magnet-class', 'freeze-on-drop'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === 'plugged') {
      this.render();
    }
    if (name === 'magnet-class') {
      this._magnetClass = newValue || 'cavi-magnet-active';
    }
    if (name === 'freeze-on-drop') {
      this._freezeOnDrop = newValue !== null;
    }
  }

  /**
   * Sets the connection type of this Plug. Not settable via markup —
   * always propagated by the owning <cavi-wire> from its own `type` attribute.
   */
  public setType(type: string): void {
    this._type = type;
  }

  /**
   * Toggles the configurable "magnet" highlight class on this Plug's host
   * element, used to preview an in-range compatible connection during drag.
   */
  public setMagnetActive(active: boolean): void {
    this.classList.toggle(this._magnetClass, active);
  }

  connectedCallback() {
    this.render();
    this.addEventListener('pointerdown', this.handlePointerDown);
  }

  disconnectedCallback() {
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('pointermove', this.handlePointerMove);
    this.removeEventListener('pointerup', this.handlePointerUp);
    this.removeEventListener('pointercancel', this.handlePointerCancel);
    this.detach();
  }

  public setNode(node: Node) {
    this._node = node;
    this.updatePosition();
  }

  public update() {
    if (!this._dragging) {
      this.updatePosition();
    }
  }

  private updatePosition() {
    if (this._node) {
      const x = this._node.x;
      const y = this._node.y;
      this.style.left = `${x}px`;
      this.style.top = `${y}px`;
    }
  }

  /**
   * Finds the nearest compatible Jack (matching type, with room for another
   * Plug) within snapping distance, using the Jack registry.
   */
  private _findSnapTarget(): Jack | null {
    const rect = this.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let bestJack: Jack | null = null;
    let bestDist = this._snapDistance;

    for (const jack of Jack.registry) {
      if (!jack.canAcceptMore()) continue;
      if (!jack.canAccept(this._type)) continue;

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
    this.setMagnetActive(jack !== null);
  }

  private handlePointerDown(e: PointerEvent) {
    if (!this._node) return;
    if (e.button !== undefined && e.button !== 0) return;

    e.preventDefault();
    this._dragging = true;
    this._activePointerId = e.pointerId;

    // Starting a drag always unplugs from the current Jack, if any,
    // so the plug immediately reflects its "unplugged" state.
    this.detach();
    this.removeAttribute('plugged');

    // Interaction usually fixes the node temporarily while dragging
    this._node.fixed = true;

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

    this.style.zIndex = '1000';
  }

  private handlePointerMove(e: PointerEvent) {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._dragging || !this._node) return;

    // Calculate position relative to the offset parent (the container)
    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();

    const x = e.clientX - parentRect.left;
    const y = e.clientY - parentRect.top;

    this._node.setPosition(x, y);
    //always update mouse position in the world for physics interaction with other nodes/wires
    this._node.setMousePosition(x, y);
    this.updatePosition();

    this._setMagnetTarget(this._findSnapTarget());
  }

  private _endDrag(pointerId: number): void {
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
    this.style.zIndex = '';
    this._activePointerId = null;
  }

  private handlePointerUp(e: PointerEvent) {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._dragging || !this._node) return;

    this._dragging = false;
    // Recompute rather than trusting the last pointermove's magnet target:
    // a drop can happen with no intervening move (e.g. a tap-release), and
    // the snap decision must reflect the plug's actual final position.
    const bestJack = this._findSnapTarget();
    this._setMagnetTarget(null);
    this._endDrag(e.pointerId);

    if (bestJack) {
      // Snap! Calculate position relative to offsetParent
      const offsetParent = this.offsetParent || document.body;
      const parentRect = offsetParent.getBoundingClientRect();
      const c = bestJack.getCenter();

      this._node.setPosition(c.x - parentRect.left, c.y - parentRect.top);
      this._node.fixed = true;
      this.updatePosition();
      this.attach(bestJack);
      this.setAttribute('plugged', 'true');
    } else {
      // Not dropped on any compatible Jack: stays unplugged. Unless
      // freeze-on-drop is set, unfix the node so it falls/moves freely
      // with physics; with freeze-on-drop it stays fixed right where it
      // was dropped, so it never becomes a moving target to re-grab.
      this.detach();
      this._node.fixed = this._freezeOnDrop;
      this.removeAttribute('plugged');
    }
  }

  private handlePointerCancel(e: PointerEvent) {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._dragging || !this._node) return;

    this._dragging = false;
    this._setMagnetTarget(null);
    this._endDrag(e.pointerId);

    // A cancelled gesture (e.g. interrupted by the OS/browser) is treated
    // like a drop away from any Jack: same freeze-on-drop handling applies.
    this.detach();
    this._node.fixed = this._freezeOnDrop;
    this.removeAttribute('plugged');
  }

  /**
   * Attaches this Plug to a Jack, going through the Jack's own attach
   * bookkeeping so plugCount/max-plugs stay accurate.
   */
  public attach(jack: Jack): void {
    if (this._jack === jack) return;
    if (this._jack) this._jack.detach(this);
    this._jack = jack;
    jack.attach(this);
  }

  public detach(): void {
    if (this._jack) {
      this._jack.detach(this);
      this._jack = null;
    }
  }

  private render() {
    const style = `
            :host {
                display: block;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background-color: #eee;
                border: 2px solid #333;
                position: absolute;
                box-sizing: border-box;
                z-index: 20; /* Over everything */
                transform: translate(-50%, -50%); /* Center on position */
                cursor: grab;
                touch-action: none; /* Prevent the browser from scrolling while dragging on touch */
            }
            :host(:active) {
                cursor: grabbing;
                border-color: #007bff;
            }
            :host([plugged]) {
                background-color: #007bff;
                border-color: #0056b3;
            }
        `;

    if (this.children.length > 0) {
      this.shadowRoot!.innerHTML = `<style>${style}</style><slot></slot>`;
    } else {
      this.shadowRoot!.innerHTML = `<style>${style}</style>`;
    }
  }
}

customElements.define('cavi-plug', Plug);
