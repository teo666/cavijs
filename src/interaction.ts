import { Cavi } from './cavi';
import { Jack } from './jack';
import { Plug } from './plug';
import type { IInteractionController } from './types';

/**
 * The standard pointer/mouse/touch interaction: everything Jack/Plug used
 * to handle internally (drag an existing Plug, create a cable from a Jack
 * via right-click/Shift+click, click-to-carry, the Shift/hover-distance
 * "full jack" preview, occlusion routing between an attached Plug and the
 * Jack it sits on) — driven entirely through Jack/Plug's public domain API
 * (createCable/updateCableSession/finishCableSession/cancelCableSession,
 * beginDrag/updateDragPosition/endDrag/cancelDrag, findSnapTarget,
 * setShiftHeld/setPointerHoverPosition/setDragActive), never their
 * internals.
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
    document.addEventListener('contextmenu', this._handleContextMenu);
    document.addEventListener('keydown', this._handleKeyDown);
    document.addEventListener('keyup', this._handleKeyUp);
    window.addEventListener('blur', this._handleBlur);
    document.addEventListener('pointermove', this._handleHoverMove);
  }

  public detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener('pointerdown', this._handlePointerDown);
    document.removeEventListener('contextmenu', this._handleContextMenu);
    document.removeEventListener('keydown', this._handleKeyDown);
    document.removeEventListener('keyup', this._handleKeyUp);
    window.removeEventListener('blur', this._handleBlur);
    document.removeEventListener('pointermove', this._handleHoverMove);
    // Leaving Shift/hover state stuck would strand every Jack's full-jack
    // preview in whatever state it was in at the moment of detach.
    Jack.setShiftHeld(false);
    Jack.setPointerHoverPosition(null, null);
  }

  /** Walks the real (shadow-DOM-aware) event path to find the nearest Jack/Plug custom element, if any. */
  private _closestCaviElement(e: Event): Jack | Plug | null {
    for (const node of e.composedPath()) {
      if (node instanceof Jack || node instanceof Plug) return node;
    }
    return null;
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') Jack.setShiftHeld(true);
  };

  private _handleKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') Jack.setShiftHeld(false);
  };

  private _handleBlur = (): void => {
    // A keyup can be missed if focus leaves the page while Shift is held
    // (e.g. alt-tab) — clear the stuck state once focus returns elsewhere.
    Jack.setShiftHeld(false);
  };

  private _handleHoverMove = (e: PointerEvent): void => {
    Jack.setPointerHoverPosition(e.clientX, e.clientY);
  };

  /**
   * A Jack (permanent cable-creation drag source) or a Plug currently
   * attached to one would otherwise have its native context menu interrupt
   * a right-click drag.
   */
  private _handleContextMenu = (e: MouseEvent): void => {
    const el = this._closestCaviElement(e);
    if (el instanceof Jack) e.preventDefault();
    else if (el instanceof Plug && el.jack) e.preventDefault();
  };

  private _handlePointerDown = (e: PointerEvent): void => {
    const el = this._closestCaviElement(e);
    if (!el) return;

    const isRightClick = e.button === 2;
    const isModifiedLeftClick = e.button === 0 && e.shiftKey;

    if (el instanceof Plug) {
      // A Plug attached to a Jack sits fixed exactly on that Jack's center
      // with a higher z-index, occluding it — a right-click/Shift+click
      // meant to start a new cable from that Jack physically lands here
      // instead. Forward it verbatim rather than silently swallowing it.
      if ((isRightClick || isModifiedLeftClick) && el.jack) {
        this._startCableCreation(el.jack, e);
        return;
      }
      // Shift is reserved for starting a new cable from a Jack — don't
      // also start dragging this plug's own node while it's held.
      if (e.button === 0 && !e.shiftKey) {
        this._startPlugDrag(el, e);
      }
      return;
    }

    if (el instanceof Jack) {
      if (isRightClick || isModifiedLeftClick) {
        this._startCableCreation(el, e);
      }
    }
  };

  /**
   * Drives a Plug drag from pointerdown to release, entirely through
   * Plug's public API. Handles both 'hold' (setPointerCapture) and 'click'
   * (click-to-carry) modes — see Cavi.setDragMode.
   */
  private _startPlugDrag(plug: Plug, e: PointerEvent): void {
    e.preventDefault();
    const pointerId = e.pointerId;
    Jack.setDragActive(true);
    plug.beginDrag();

    // Touch always uses 'hold': there's no scroll conflict to work around
    // (touch-action: none already keeps a touch drag from scrolling the
    // page), and press-and-drag-with-your-finger is already the natural
    // touch gesture.
    const clickToCarry = Cavi.shared?.getDragMode?.() === 'click' && e.pointerType !== 'touch';

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
   * through Jack's public session API. Same 'hold'/'click' handling as
   * _startPlugDrag above.
   */
  private _startCableCreation(jack: Jack, e: PointerEvent): void {
    const session = jack.createCable(e.clientX, e.clientY);
    if (!session) return;

    e.preventDefault();
    const pointerId = e.pointerId;
    // Shift/right-click is only needed to *start* this drag, not to keep
    // it going — this keeps the full-jack forbidden-hover preview correct
    // for the whole drag even if Shift is released partway through.
    Jack.setDragActive(true);

    const clickToCarry = Cavi.shared?.getDragMode?.() === 'click' && e.pointerType !== 'touch';

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
