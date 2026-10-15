import { Cavi } from '../core/cavi';
import type { IInteractionController } from '../core/types';
import { StandardInteractionController } from '../interaction/interaction';
import { KeyboardInteractionController } from '../interaction/keyboard';

/**
 * <cavi-interaction> attaches a list of IInteractionControllers to the live
 * Cavi/Jack/Plug setup, each handling one way of interacting — by default
 * a StandardInteractionController (mouse/touch drag-and-drop,
 * click-to-carry) and a KeyboardInteractionController (Tab, Space/Enter,
 * Escape); the `no-keyboard` attribute leaves the latter out. Jack/Plug
 * install no listeners of their own, so nothing is interactive until some
 * element like this one attaches a controller.
 *
 * To use other controllers, set `.controllers` before this element is
 * connected to the document:
 *   const el = document.createElement('cavi-interaction');
 *   el.controllers = [new MyPointerController(), new KeyboardInteractionController()];
 *   container.appendChild(el);
 * (`.controller = c` is short for `.controllers = [c]`.) Or simply omit
 * <cavi-interaction> entirely and drive Jack/Plug's public API from
 * anywhere else — these are just IInteractionControllers among any number
 * of possible ones, not a special case.
 */
export class CaviInteractionElement extends HTMLElement {
  private _controllers: IInteractionController[] | null = null;
  private _attachedTo: Cavi | null = null;
  /** The controllers attached by _setup, detached by disconnectedCallback. */
  private _attached: IInteractionController[] = [];

  /**
   * The controllers attached to this element's world, read once when it
   * connects. Unless set, the standard pointer controller and — without
   * `no-keyboard` — the keyboard one.
   */
  public get controllers(): IInteractionController[] {
    if (!this._controllers) {
      this._controllers = [new StandardInteractionController()];
      if (!this.hasAttribute('no-keyboard')) {
        this._controllers.push(new KeyboardInteractionController());
      }
    }
    return this._controllers;
  }

  public set controllers(list: IInteractionController[]) {
    this._controllers = [...list];
  }

  /** The first controller; setting it replaces the whole list with just that one. */
  public get controller(): IInteractionController {
    return this.controllers[0];
  }

  public set controller(c: IInteractionController) {
    this._controllers = [c];
  }

  /** The element whose controller drives each world — at most one per world. */
  private static readonly _byWorld = new WeakMap<Cavi, CaviInteractionElement>();

  /**
   * The <cavi-interaction> whose controller is attached to `cavi`, if any.
   * Used by <cavi-world> to not add a default one next to an existing one.
   */
  public static attachedTo(cavi: Cavi): CaviInteractionElement | null {
    return CaviInteractionElement._byWorld.get(cavi) ?? null;
  }

  connectedCallback(): void {
    Cavi.whenReady(this, (cavi) => this._setup(cavi));
  }

  private _setup(cavi: Cavi): void {
    if (!this.isConnected) return; // removed while waiting for caviready
    if (this._attachedTo) return; // already attached (e.g. reconnected while waiting)
    // One <cavi-interaction> per world: two would both handle every click —
    // one click, two cables. The first one to attach wins.
    const existing = CaviInteractionElement._byWorld.get(cavi);
    if (existing && existing !== this && existing.isConnected) {
      console.warn(
        '<cavi-interaction>: this world already has an interaction controller ' +
          '(another <cavi-interaction>); this one stays inactive.'
      );
      return;
    }
    this._attachedTo = cavi;
    CaviInteractionElement._byWorld.set(cavi, this);
    this._attached = [...this.controllers];
    for (const c of this._attached) c.attach(cavi);
  }

  disconnectedCallback(): void {
    const cavi = this._attachedTo;
    if (cavi) {
      for (const c of this._attached) c.detach();
      this._attached = [];
      this._attachedTo = null;
      if (CaviInteractionElement._byWorld.get(cavi) === this) {
        CaviInteractionElement._byWorld.delete(cavi);
      }
    }
  }
}

customElements.define('cavi-interaction', CaviInteractionElement);
