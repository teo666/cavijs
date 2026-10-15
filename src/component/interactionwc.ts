import { Cavi } from '../core/cavi';
import type { IInteractionController } from '../core/types';
import { StandardInteractionController } from '../interaction/interaction';

/**
 * <cavi-interaction> attaches an IInteractionController to the live
 * Cavi/Jack/Plug setup — by default a StandardInteractionController (mouse/
 * touch drag-and-drop, click-to-carry, right-click/Shift+click cable
 * creation). Jack/Plug install no listeners of their own, so nothing is
 * interactive until some element like this one attaches a controller.
 *
 * To use a custom controller instead of the standard one, set `.controller`
 * before this element is connected to the document:
 *   const el = document.createElement('cavi-interaction');
 *   el.controller = new MyController();
 *   container.appendChild(el);
 * Or simply omit <cavi-interaction> entirely and drive Jack/Plug's public
 * API from anywhere else — it's just one IInteractionController among any
 * number of possible ones, not a special case.
 */
export class CaviInteractionElement extends HTMLElement {
  public controller: IInteractionController = new StandardInteractionController();
  private _attachedTo: Cavi | null = null;

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
    // One controller per world: two would both handle every click — one
    // click, two cables. The first one to attach wins.
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
    this.controller.attach(cavi);
  }

  disconnectedCallback(): void {
    const cavi = this._attachedTo;
    if (cavi) {
      this.controller.detach();
      this._attachedTo = null;
      if (CaviInteractionElement._byWorld.get(cavi) === this) {
        CaviInteractionElement._byWorld.delete(cavi);
      }
    }
  }
}

customElements.define('cavi-interaction', CaviInteractionElement);
