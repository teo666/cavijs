import { Cavi } from './cavi';
import { Jack } from './jack';
import { Plug } from './plug';
import type { IInteractionController } from './types';

/**
 * The standard pointer/mouse/touch interaction: everything Jack/Plug used
 * to handle internally (drag an existing Plug, create a cable from a Jack,
 * click-to-carry, the hover-spread affordance that fans a Jack's Plugs out
 * so each can be individually picked, occlusion routing between an
 * attached Plug and the Jack it sits on) — driven entirely through
 * Jack/Plug's public domain API (createCable/updateCableSession/
 * finishCableSession/cancelCableSession, beginDrag/updateDragPosition/
 * endDrag/cancelDrag, findSnapTarget, setPointerHoverPosition/
 * setDragActive), never their internals.
 *
 * Every gesture is plain left-click (or a touch tap) — there is no right-
 * click or modifier-key branch. Whether a click on a Plug relocates that
 * Plug or starts a new cable from its Jack depends entirely on whether that
 * Jack is currently "spread" (see Jack's hover-spread mechanic): a docked
 * Plug (not yet spread out) sits exactly on its Jack and forwards the click
 * to the Jack, same as clicking the Jack itself; a spread-out Plug is
 * clicked directly since it now occupies its own screen position.
 *
 * A single instance is meant to be attached to the whole document (see
 * <cavi-interaction> in interactionwc.ts) — Jack/Plug don't install any
 * listeners of their own, so nothing works until some IInteractionController
 * (this one, by default, or a custom replacement) is attached.
 */
export class StandardInteractionController implements IInteractionController {
  private _attached: boolean = false;

  public attach(_cavi: Cavi): void {
    if (this._attached) return;
    this._attached = true;
    document.addEventListener('pointerdown', this._handlePointerDown);
    document.addEventListener('pointermove', this._handleHoverMove);
  }

  public detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener('pointerdown', this._handlePointerDown);
    document.removeEventListener('pointermove', this._handleHoverMove);
    // Leaving hover state stuck would strand every Jack's hover-spread/
    // full-jack preview in whatever state it was in at the moment of detach.
    Jack.setPointerHoverPosition(null, null);
  }

  /** Walks the real (shadow-DOM-aware) event path to find the nearest Jack/Plug custom element, if any. */
  private _closestCaviElement(e: Event): Jack | Plug | null {
    for (const node of e.composedPath()) {
      if (node instanceof Jack || node instanceof Plug) return node;
    }
    return null;
  }

  private _handleHoverMove = (e: PointerEvent): void => {
    Jack.setPointerHoverPosition(e.clientX, e.clientY);
  };

  private _handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const el = this._closestCaviElement(e);
    if (!el) return;

    if (el instanceof Plug) {
      // A Plug not currently spread out sits fixed exactly on its Jack's
      // center with a higher z-index, occluding it — a click meant to
      // start a new cable from that Jack physically lands here instead.
      // Forward it verbatim rather than silently swallowing it.
      if (!el.isSpread() && el.jack) {
        this._startCableCreation(el.jack, e);
        return;
      }
      this._startPlugDrag(el, e);
      return;
    }

    if (el instanceof Jack) {
      this._startCableCreation(el, e);
    }
  };

  /**
   * Drives a Plug drag from pointerdown to release, entirely through
   * Plug's public API. Always click-to-carry for mouse/pen; touch keeps
   * press-and-drag (setPointerCapture) since it has no scroll conflict to
   * work around and is the natural touch gesture.
   */
  private _startPlugDrag(plug: Plug, e: PointerEvent): void {
    e.preventDefault();
    const pointerId = e.pointerId;
    Jack.setDragActive(true);
    plug.beginDrag();

    const clickToCarry = e.pointerType !== 'touch';

    const onHoldMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      plug.updateDragPosition(ev.clientX, ev.clientY);
    };
    // No pointerId filter here (unlike onHoldMove above): click-to-carry has
    // no button held and no pointer capture, so the plug simply follows
    // wherever the pointer goes next, regardless of which pointerId.
    const onCarryMove = (ev: PointerEvent): void => {
      plug.updateDragPosition(ev.clientX, ev.clientY);
    };
    const onCarryFinish = (ev: PointerEvent): void => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      endGesture();
      plug.endDrag();
    };
    const onCarryCancel = (): void => {
      endGesture();
      plug.cancelDrag();
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      endGesture();
      plug.endDrag();
    };
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      endGesture();
      plug.cancelDrag();
    };
    const endGesture = (): void => {
      if (clickToCarry) {
        document.removeEventListener('pointermove', onCarryMove);
        document.removeEventListener('pointerdown', onCarryFinish, true);
        document.removeEventListener('pointercancel', onCarryCancel);
      } else {
        plug.removeEventListener('pointermove', onHoldMove);
        plug.removeEventListener('pointerup', onUp);
        plug.removeEventListener('pointercancel', onCancel);
        if (typeof plug.releasePointerCapture === 'function') {
          try {
            plug.releasePointerCapture(pointerId);
          } catch {
            // Not supported / not captured — safe to ignore.
          }
        }
      }
      Jack.setDragActive(false);
    };

    if (clickToCarry) {
      document.addEventListener('pointermove', onCarryMove);
      // capture: true so this sees the finishing click before it can be
      // reinterpreted as, say, a fresh click on whatever it lands on.
      document.addEventListener('pointerdown', onCarryFinish, true);
      document.addEventListener('pointercancel', onCarryCancel);
    } else {
      if (typeof plug.setPointerCapture === 'function') {
        try {
          plug.setPointerCapture(pointerId);
        } catch {
          // Not supported in this environment (e.g. jsdom) — the drag
          // still works via the listeners added below.
        }
      }
      plug.addEventListener('pointermove', onHoldMove);
      plug.addEventListener('pointerup', onUp);
      plug.addEventListener('pointercancel', onCancel);
    }
  }

  /**
   * Drives a cable-creation session from pointerdown to release, entirely
   * through Jack's public session API. Same click-to-carry/hold handling
   * as _startPlugDrag above.
   */
  private _startCableCreation(jack: Jack, e: PointerEvent): void {
    const session = jack.createCable(e.clientX, e.clientY);
    if (!session) return;

    e.preventDefault();
    const pointerId = e.pointerId;
    Jack.setDragActive(true);

    const clickToCarry = e.pointerType !== 'touch';

    const onHoldMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      Jack.updateCableSession(session, ev.clientX, ev.clientY);
    };
    // No pointerId filter here (unlike onHoldMove above): click-to-carry has
    // no button held and no pointer capture, so the free end simply follows
    // wherever the pointer goes next, regardless of which pointerId.
    const onCarryMove = (ev: PointerEvent): void => {
      Jack.updateCableSession(session, ev.clientX, ev.clientY);
    };
    const onCarryFinish = (ev: PointerEvent): void => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      Jack.finishCableSession(session);
      endGesture();
    };
    const onCarryCancel = (): void => {
      Jack.cancelCableSession(session);
      endGesture();
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      Jack.finishCableSession(session);
      endGesture();
    };
    const onCancel = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      Jack.cancelCableSession(session);
      endGesture();
    };
    const endGesture = (): void => {
      if (clickToCarry) {
        document.removeEventListener('pointermove', onCarryMove);
        document.removeEventListener('pointerdown', onCarryFinish, true);
        document.removeEventListener('pointercancel', onCarryCancel);
      } else {
        jack.removeEventListener('pointermove', onHoldMove);
        jack.removeEventListener('pointerup', onUp);
        jack.removeEventListener('pointercancel', onCancel);
        if (typeof jack.releasePointerCapture === 'function') {
          try {
            jack.releasePointerCapture(pointerId);
          } catch {
            // Not supported / not captured — safe to ignore.
          }
        }
      }
      Jack.setDragActive(false);
    };

    if (clickToCarry) {
      document.addEventListener('pointermove', onCarryMove);
      document.addEventListener('pointerdown', onCarryFinish, true);
      document.addEventListener('pointercancel', onCarryCancel);
    } else {
      if (typeof jack.setPointerCapture === 'function') {
        try {
          jack.setPointerCapture(pointerId);
        } catch {
          // Not supported in this environment (e.g. jsdom) — the drag
          // still works via the listeners added below.
        }
      }
      jack.addEventListener('pointermove', onHoldMove);
      jack.addEventListener('pointerup', onUp);
      jack.addEventListener('pointercancel', onCancel);
    }
  }
}
