import { Node } from '../core/node';
import { Jack } from './jack'; // Ensure Jack is imported if we check types
import { Cavi } from '../core/cavi';
import { emitCaviEvent } from '../core/events';
import type { CaviWireElement } from './wirewc';

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
 * (src/interaction/interaction.ts) for the default mouse/touch/click
 * implementation, KeyboardInteractionController (src/interaction/
 * keyboard.ts) for the keyboard,
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
  /**
   * Where this Plug's node was, and whether it was fixed, when the Plug
   * left the page — so if its <cavi-wire> is set up again later (its world
   * was removed and inserted back), a free end comes back where it was,
   * falling or held as before (see takeRestoreState).
   */
  private _restoreState: { x: number; y: number; fixed: boolean } | null = null;
  /** Whether aria-label is ours to keep up to date (the author set none). */
  private _autoLabel: boolean = false;

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
    this._refreshLabel();
  }

  /**
   * Toggles the configurable "magnet" highlight class on this Plug's host
   * element, used to preview an in-range compatible connection during drag.
   */
  public setMagnetActive(active: boolean): void {
    this.classList.toggle(this._magnetClass, active);
  }

  connectedCallback() {
    // Focusable, but out of the natural Tab order: KeyboardInteractionController
    // puts each Plug right after its Jack. An author's own tabindex, role
    // or label wins.
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button');
    if (!this.hasAttribute('aria-label')) this._autoLabel = true;
    this._refreshLabel();
    this.render();
  }

  /** "audio plug in jack4", "plug, unplugged" — see _autoLabel. */
  private _refreshLabel(): void {
    if (!this._autoLabel) return;
    const what = [this._type || null, 'plug'].filter(Boolean).join(' ');
    const where = this._jack ? ` in ${this._jack.id || 'jack'}` : ', unplugged';
    this.setAttribute('aria-label', what + where);
  }

  /**
   * Leaving the document frees this Plug's slot on its Jack — deferred to a
   * microtask so a plain DOM move of its <cavi-wire> (disconnect
   * immediately followed by connect) keeps the cable plugged in.
   */
  disconnectedCallback() {
    // Read now: once removed for good, the world is torn down a microtask
    // later and the node can no longer be read.
    if (this._node) {
      this._restoreState = { x: this._node.x, y: this._node.y, fixed: this._node.fixed };
    }
    queueMicrotask(() => {
      // Keeps `jack="id"`: the markup still says where this Plug belongs, so
      // it plugs back in if its cable is set up again.
      if (!this.isConnected) this._release(true);
    });
  }

  /**
   * The state recorded when this Plug left the page (see _restoreState),
   * handed over once: used by CaviWireElement to set an unplugged end up
   * again where it was.
   */
  public takeRestoreState(): { x: number; y: number; fixed: boolean } | null {
    const state = this._restoreState;
    this._restoreState = null;
    return state;
  }

  /** The connection type of this Plug (see setType); '' for untyped. */
  public get type(): string {
    return this._type;
  }

  /**
   * The Jack this Plug is currently attached to, or null if unplugged.
   */
  public get jack(): Jack | null {
    return this._jack;
  }

  /** The cable node this Plug is bound to (see setNode), null before its cable is set up. */
  public get node(): Node | null {
    return this._node;
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

  /**
   * Per-frame sync (see CaviWireElement's frame task): moves this Plug to
   * where its node is *drawn* — interpolated between physics steps on a
   * display faster than the step rate (see Node.getRenderPosition) — so it
   * stays on the rendered cable. No-op mid-drag.
   */
  public update() {
    if (!this._dragging && this._node) {
      const { x, y } = this._node.getRenderPosition();
      this.style.left = `${x}px`;
      this.style.top = `${y}px`;
    }
  }

  /** Moves this Plug onto its node's current physics position, right away. */
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
  public snapToJack(position?: { x: number; y: number }): void {
    if (this._dragging || !this._node || !this._jack) return;

    // Straight from the Jack's own world position rather than re-deriving
    // it from its screen rect here: that keeps explicit-x/y jacks exact,
    // and keeps auto-positioned ones going through the single
    // container-anchored, zoom-corrected conversion (see
    // Jack.getWorldPosition) instead of a second, subtly different one.
    // A caller that already measured it (Jack's frame task) passes it in,
    // so re-gluing doesn't read layout again.
    const { x, y } = position ?? this._jack.getWorldPosition();
    this._node.setPosition(x, y);
    this.updatePosition();
  }

  /** A viewport point in this Plug's world coordinates — see Cavi.clientToWorldOf. */
  private _clientToLocal(clientX: number, clientY: number): { x: number; y: number } {
    return Cavi.clientToWorldOf(this, clientX, clientY);
  }

  private _setMagnetTarget(jack: Jack | null): void {
    this._magnetJack = Jack.switchMagnet(this._magnetJack, jack, this);
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
    this._setHeld(true);
  }

  /**
   * Moves this Plug (and its underlying node) to a new cursor position
   * (viewport coordinates) during a drag, and refreshes the magnet-highlight
   * preview against the nearest compatible in-range Jack.
   */
  public updateDragPosition(clientX: number, clientY: number): void {
    if (!this._node) return;

    const { x, y } = this._clientToLocal(clientX, clientY);

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
      const local = bestJack.getWorldPosition();

      this._node.setPosition(local.x, local.y);
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
    this._setHeld(false);
    this.style.zIndex = '';
    const bestJack = Jack.findSnapTarget(this, this._type);
    this._setMagnetTarget(null);
    this._settleDrag(bestJack);
  }

  /**
   * Ends a drag by plugging into `jack` — wherever this Plug is on screen —
   * if `jack` is still on the page, accepts this Plug's type and has room;
   * otherwise like cancelDrag. For a controller that already knows the
   * target, e.g. the keyboard, or Escape putting a Plug back where it was.
   */
  public endDragAt(jack: Jack | null): void {
    if (!this._node) return;
    const ok =
      jack !== null && jack.isConnected && jack.canAccept(this._type) && jack.canAcceptMore();
    if (!ok) {
      this.cancelDrag();
      return;
    }
    this._dragging = false;
    this._setHeld(false);
    this.style.zIndex = '';
    this._setMagnetTarget(null);
    this._settleDrag(jack);
  }

  /**
   * Ends a drag that was interrupted (e.g. by the OS/browser): always
   * treated like a drop away from any Jack, regardless of what was under
   * the cursor — same freeze-on-drop handling as endDrag applies.
   */
  public cancelDrag(): void {
    if (!this._node) return;
    this._dragging = false;
    this._setHeld(false);
    this.style.zIndex = '';
    this._setMagnetTarget(null);
    this._settleDrag(null);
  }

  /**
   * Tells this Plug's world that its cable is held — or no longer held —
   * by the drag (see World.holdWire), so the mouse sitting on this Plug
   * doesn't push the cable's own nodes away from it.
   */
  private _setHeld(held: boolean): void {
    const wire = (this.closest('cavi-wire') as CaviWireElement | null)?.getWire?.();
    const world = Cavi.for(this)?.getWorld?.();
    if (!wire || !world) return;
    if (held) world.holdWire?.(wire);
    else world.releaseHeldWire?.(wire);
  }

  /**
   * Attaches this Plug to a Jack, going through the Jack's own attach
   * bookkeeping so plugCount/max-plugs stay accurate.
   */
  public attach(jack: Jack): void {
    if (this._jack === jack) return;
    this.detach();
    this._jack = jack;
    // Reflected in the markup (when the Jack has an id), so <cavi-wire> can
    // plug it back in if it is ever set up again — a cable created by
    // dragging becomes as declarative as one written in HTML.
    if (jack.id) this.setAttribute('jack', jack.id);
    jack.attach(this);
    this._refreshLabel();
    emitCaviEvent(Cavi.for(jack), jack, 'cavi-plug-attach', { plug: this, jack });
  }

  /**
   * Pulls this Plug out of its Jack, if any, and lets its end go: the node
   * is unfixed and falls/moves freely under physics — used when the Jack
   * itself disappears from the page. No-op mid-drag.
   */
  public unplug(): void {
    if (this._dragging) return;
    // Keep `jack="id"` when this Plug left the page too (its whole world
    // was removed): it plugs back in if the world comes back.
    this._release(!this.isConnected);
    this.removeAttribute('plugged');
    if (this._node) this._node.fixed = false;
  }

  /** Pulls this Plug out of its Jack, if any (and drops `jack="id"` from the markup). */
  public detach(): void {
    this._release(false);
  }

  private _release(keepMarkup: boolean): void {
    const jack = this._jack;
    if (jack) {
      jack.detach(this);
      this._jack = null;
      if (!keepMarkup) this.removeAttribute('jack');
      this._refreshLabel();
      emitCaviEvent(Cavi.for(jack), jack, 'cavi-plug-detach', { plug: this, jack });
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
                outline: none;
            }
            :host(:focus-visible) {
                box-shadow: 0 0 0 3px #4fc3f7;
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
