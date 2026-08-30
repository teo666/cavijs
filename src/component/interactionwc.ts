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

  connectedCallback(): void {
    if (Cavi.shared) {
      this._setup(Cavi.shared);
    } else {
      document.addEventListener(
        'caviready',
        (e: Event) => this._setup((e as CustomEvent<{ cavi: Cavi }>).detail.cavi),
        { once: true }
      );
    }
  }

  private _setup(cavi: Cavi): void {
    if (!this.isConnected) return; // removed while waiting for caviready
    this._attachedTo = cavi;
    this.controller.attach(cavi);
  }

  disconnectedCallback(): void {
    if (this._attachedTo) {
      this.controller.detach();
      this._attachedTo = null;
    }
  }
}

customElements.define('cavi-interaction', CaviInteractionElement);
