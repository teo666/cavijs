import { Node } from './node';
import { Jack } from './jack'; // Ensure Jack is imported if we check types
import { Cavi } from './cavi';

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
  /**
   * Which interaction mode the drag currently in progress is using — decided
   * once, when the drag starts, from Cavi's world-level dragMode (plus the
   * touch exception, see handlePointerDown). null while idle.
   */
  private _activeDragKind: 'hold' | 'click' | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Bind methods
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleCarryMove = this.handleCarryMove.bind(this);
    this.handleCarryFinish = this.handleCarryFinish.bind(this);
    this.handleCarryCancel = this.handleCarryCancel.bind(this);
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
    this.addEventListener('contextmenu', this.handleContextMenu);
  }

  disconnectedCallback() {
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('pointermove', this.handlePointerMove);
    this.removeEventListener('pointerup', this.handlePointerUp);
    this.removeEventListener('pointercancel', this.handlePointerCancel);
    this.removeEventListener('contextmenu', this.handleContextMenu);
    this.detach();
  }

  /**
   * While this Plug is attached to a Jack, it sits fixed exactly on that
   * Jack's center with a higher z-index, occluding it. A right-click meant
   * to start a new cable from that Jack (see Jack.handlePointerDown) would
   * otherwise trigger the browser's native context menu here instead of
   * Jack's own (occluded) contextmenu handler — suppress it the same way
   * Jack suppresses its own.
   */
  private handleContextMenu(e: MouseEvent): void {
    if (this._jack) e.preventDefault();
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
    // This plug sits fixed exactly on top of the jack it's attached to,
    // with a higher z-index (see handleContextMenu above) — a right-click
    // or Shift+left-click meant to start a NEW cable from that jack
    // physically lands here instead of on the (occluded) jack itself.
    // Forward it verbatim rather than silently swallowing the gesture.
    const isRightClick = e.button === 2;
    const isModifiedLeftClick = e.button === 0 && e.shiftKey;
    if ((isRightClick || isModifiedLeftClick) && this._jack) {
      this._jack.handlePointerDown(e);
      return;
    }

    if (!this._node) return;
    if (e.button !== undefined && e.button !== 0) return;
    // Shift is reserved for starting a new cable from a Jack — don't also
    // move this plug's own node while it's held.
    if (e.shiftKey) return;

    e.preventDefault();
    this._dragging = true;
    this._activePointerId = e.pointerId;
    // Lets a full jack preview itself as forbidden on hover while this
    // drag is in progress, even without Shift held — see
    // Jack.setDragActive.
    Jack.setDragActive(true);

    // Starting a drag always unplugs from the current Jack, if any,
    // so the plug immediately reflects its "unplugged" state.
    this.detach();
    this.removeAttribute('plugged');

    // Interaction usually fixes the node temporarily while dragging
    this._node.fixed = true;
    this.style.zIndex = '1000';

    // 'click' (click-to-carry): a click detaches and starts following the
    // cursor with no button held — see Cavi.setDragMode — so native
    // scrolling (including trackpad gestures) is never blocked, unlike
    // 'hold', which relies on setPointerCapture for the whole gesture.
    // Touch always uses 'hold': there's no scroll conflict to work around
    // (touch-action: none already keeps a touch drag from scrolling the
    // page), and press-and-drag-with-your-finger is already the natural
    // touch gesture.
    const clickToCarry = Cavi.shared?.getDragMode?.() === 'click' && e.pointerType !== 'touch';
    this._activeDragKind = clickToCarry ? 'click' : 'hold';

    if (clickToCarry) {
      document.addEventListener('pointermove', this.handleCarryMove);
      // capture: true so this sees the finishing click before it can be
      // reinterpreted as, say, a fresh click on whatever jack it lands on.
      document.addEventListener('pointerdown', this.handleCarryFinish, true);
      document.addEventListener('pointercancel', this.handleCarryCancel);
    } else {
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
  }

  /** Shared by both 'hold' pointermove and 'click' carry-move — see handlePointerMove/handleCarryMove. */
  private _updateCarriedPosition(clientX: number, clientY: number): void {
    if (!this._node) return;

    // Calculate position relative to the offset parent (the container)
    const offsetParent = this.offsetParent || document.body;
    const parentRect = offsetParent.getBoundingClientRect();

    const x = clientX - parentRect.left;
    const y = clientY - parentRect.top;

    this._node.setPosition(x, y);
    //always update mouse position in the world for physics interaction with other nodes/wires
    this._node.setMousePosition(x, y);
    this.updatePosition();

    this._setMagnetTarget(this._findSnapTarget());
  }

  private handlePointerMove(e: PointerEvent) {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._dragging) return;
    this._updateCarriedPosition(e.clientX, e.clientY);
  }

  /** 'click' mode's equivalent of handlePointerMove — see handlePointerDown. */
  private handleCarryMove(e: PointerEvent): void {
    if (!this._dragging) return;
    this._updateCarriedPosition(e.clientX, e.clientY);
  }

  /**
   * Ends the current drag's listeners/visual state, whichever mode started
   * it (this._activeDragKind) — shared by both modes' pointerup/cancel and
   * click-to-carry's finish/cancel. `pointerId` is only meaningful for
   * 'hold' (to release capture); pass null from the 'click' paths.
   */
  private _endDrag(pointerId: number | null): void {
    if (this._activeDragKind === 'click') {
      document.removeEventListener('pointermove', this.handleCarryMove);
      document.removeEventListener('pointerdown', this.handleCarryFinish, true);
      document.removeEventListener('pointercancel', this.handleCarryCancel);
    } else {
      this.removeEventListener('pointermove', this.handlePointerMove);
      this.removeEventListener('pointerup', this.handlePointerUp);
      this.removeEventListener('pointercancel', this.handlePointerCancel);
      if (pointerId !== null && typeof this.releasePointerCapture === 'function') {
        try {
          this.releasePointerCapture(pointerId);
        } catch {
          // Not supported / not captured — safe to ignore.
        }
      }
    }
    this.style.zIndex = '';
    this._activePointerId = null;
    this._activeDragKind = null;
    Jack.setDragActive(false);
  }

  /**
   * Attaches to the best jack under the plug right now, or — if none is in
   * range — drops it in place (falling under physics unless freeze-on-drop
   * is set). Shared by every way a drag/carry can end: 'hold' release,
   * 'click' finish, and both modes' cancel path (which passes `null`).
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

  private handlePointerUp(e: PointerEvent) {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._dragging) return;

    this._dragging = false;
    // Recompute rather than trusting the last pointermove's magnet target:
    // a drop can happen with no intervening move (e.g. a tap-release), and
    // the snap decision must reflect the plug's actual final position.
    const bestJack = this._findSnapTarget();
    this._setMagnetTarget(null);
    this._endDrag(e.pointerId);
    this._settleDrag(bestJack);
  }

  private handlePointerCancel(e: PointerEvent) {
    if (e.pointerId !== this._activePointerId) return;
    if (!this._dragging) return;

    this._dragging = false;
    this._setMagnetTarget(null);
    this._endDrag(e.pointerId);
    // A cancelled gesture (e.g. interrupted by the OS/browser) is treated
    // like a drop away from any Jack: same freeze-on-drop handling applies.
    this._settleDrag(null);
  }

  /**
   * 'click' mode's equivalent of handlePointerUp: the *next* primary-button
   * click anywhere (not necessarily on this plug — it's carried at the
   * cursor already, so in practice it always lands here) finalizes the
   * carry. capture:true (see handlePointerDown) plus stopPropagation here
   * keeps this click from also being reinterpreted as a fresh interaction
   * by whatever element it happens to land on.
   */
  private handleCarryFinish(e: PointerEvent): void {
    if (e.button !== undefined && e.button !== 0) return;
    if (!this._dragging) return;
    e.preventDefault();
    e.stopPropagation();

    this._dragging = false;
    const bestJack = this._findSnapTarget();
    this._setMagnetTarget(null);
    this._endDrag(null);
    this._settleDrag(bestJack);
  }

  /** 'click' mode's equivalent of handlePointerCancel. */
  private handleCarryCancel(): void {
    if (!this._dragging) return;

    this._dragging = false;
    this._setMagnetTarget(null);
    this._endDrag(null);
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
