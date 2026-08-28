import { Node } from './node';
import { Jack } from './jack'; // Ensure Jack is imported if we check types

/**
 * Plug represents a movable terminal of a cable. Can be attached/detached
 * to/from Jack elements and dragged via its public API.
 *
 * Plug is a pure domain/data element: it exposes public methods to
 * manipulate it and to drive a drag gesture (beginDrag/updateDragPosition/
 * endDrag/cancelDrag) plus a public `jack` accessor, but it never listens
 * for pointer or keyboard events itself and does not decide *how* a user
 * interacts with it. That is the job of whatever IInteractionController is
 * attached to the page — see StandardInteractionController
 * (src/interaction.ts) for the default mouse/touch/click implementation,
 * and <cavi-interaction> (src/interactionwc.ts) for how it's wired up
 * declaratively.
 */
export class Plug extends HTMLElement {
  private _node: Node | null = null;
  private _jack: Jack | null = null;
  private _dragging: boolean = false;
  private _magnetJack: Jack | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
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
  }

  disconnectedCallback() {
    this.detach();
  }

  /**
   * The Jack this Plug is currently attached to, or null if unplugged.
   */
  public get jack(): Jack | null {
    return this._jack;
  }

  /**
   * Whether this Plug is currently spread out (fanned away from its
   * attached Jack's center by that Jack's hover-spread mechanic — see
   * Jack._refreshSpread), as opposed to sitting docked exactly on the
   * Jack's center. StandardInteractionController uses this to decide
   * whether a click on this Plug should relocate it or forward to its
   * Jack (a docked Plug occludes the Jack it sits on).
   */
  public isSpread(): boolean {
    return this._jack !== null && this._jack.isSpread();
  }

  /**
   * The on-screen center of this Plug's cable's *other* terminal (the
   * sibling <cavi-plug> inside the same <cavi-wire>), or null if it can't
   * be found (e.g. this Plug isn't currently inside a wire). Used by
   * Jack's hover-spread geometry to fan a Plug out toward its own cable's
   * direction.
   */
  public getOtherEndCenter(): { x: number; y: number } | null {
    const wireEl = this.parentElement;
    if (!wireEl) return null;
    for (const child of wireEl.children) {
      if (child !== this && child instanceof Plug) {
        const rect = child.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }

  /**
   * Moves this Plug (and its underlying node) to a new panel-local
   * position without starting/affecting a drag — used by Jack's
   * hover-spread mechanic to fan a docked Plug out from its Jack's center
   * (and back again on recompact). Unlike updateDragPosition, this doesn't
   * touch the magnet-highlight preview or the WASM mouse-interaction
   * position, since it isn't a user-driven drag.
   */
  public setSpreadPosition(localX: number, localY: number): void {
    if (!this._node || this._dragging) return;
    this._node.setPosition(localX, localY);
    this.updatePosition();
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
   * Re-syncs this Plug's fixed node to its attached Jack's current
   * on-screen center — called by Jack.updatePosition() whenever the Jack
   * itself moves (e.g. a responsive layout reflow changes its x/y), so a
   * plugged-in cable stays glued to the jack instead of the wire endpoint
   * being left stranded at the jack's old position. No-op mid-drag (the
   * drag itself owns the node's position) or if unplugged.
   */
  public snapToJack(): void {
    if (this._dragging || !this._node || !this._jack) return;

    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();
    const c = this._jack.getCenter();

    this._node.setPosition(c.x - parentRect.left, c.y - parentRect.top);
    this.updatePosition();
  }

  private _setMagnetTarget(jack: Jack | null): void {
    if (jack === this._magnetJack) return;
    this._magnetJack?.setMagnetActive(false);
    jack?.setMagnetActive(true);
    this._magnetJack = jack;
    this.setMagnetActive(jack !== null);
  }

  /**
   * Starts dragging this Plug: detaches from its current Jack (if any) and
   * fixes its node in place so physics doesn't fight the drag.
   */
  public beginDrag(): void {
    if (!this._node) return;
    this._dragging = true;
    this.detach();
    this.removeAttribute('plugged');
    this._node.fixed = true;
    this.style.zIndex = '1000';
  }

  /**
   * Moves this Plug (and its underlying node) to a new cursor position
   * (viewport coordinates) during a drag, and refreshes the magnet-highlight
   * preview against the nearest compatible in-range Jack.
   */
  public updateDragPosition(clientX: number, clientY: number): void {
    if (!this._node) return;

    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();

    const x = clientX - parentRect.left;
    const y = clientY - parentRect.top;

    this._node.setPosition(x, y);
    // always update mouse position in the world for physics interaction with other nodes/wires
    this._node.setMousePosition(x, y);
    this.updatePosition();

    this._setMagnetTarget(Jack.findSnapTarget(this, this._type));
  }

  /**
   * Attaches to the best jack under the plug right now, or — if none is in
   * range — drops it in place (falling under physics unless freeze-on-drop
   * is set).
   */
  private _settleDrag(bestJack: Jack | null): void {
    if (!this._node) return;

    if (bestJack) {
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

  /**
   * Ends a drag, snapping to the nearest compatible in-range Jack if any
   * (recomputed here rather than trusting the last updateDragPosition call,
   * since a drop can happen with no intervening move — e.g. a tap-release —
   * and the snap decision must reflect the plug's actual final position).
   */
  public endDrag(): void {
    if (!this._node) return;
    this._dragging = false;
    this.style.zIndex = '';
    const bestJack = Jack.findSnapTarget(this, this._type);
    this._setMagnetTarget(null);
    this._settleDrag(bestJack);
  }

  /**
   * Ends a drag that was interrupted (e.g. by the OS/browser): always
   * treated like a drop away from any Jack, regardless of what was under
   * the cursor — same freeze-on-drop handling as endDrag applies.
   */
  public cancelDrag(): void {
    if (!this._node) return;
    this._dragging = false;
    this.style.zIndex = '';
    this._setMagnetTarget(null);
    this._settleDrag(null);
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
