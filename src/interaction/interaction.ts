import { Cavi } from '../core/cavi';
import { Jack, type CableSession } from '../component/jack';
import { Plug } from '../component/plug';
import type { IInteractionController } from '../core/types';

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
 * click or modifier-key branch. Escape cancels the gesture in progress: a
 * new cable is removed, a relocated plug goes back to its jack. Whether a click on a Plug relocates that
 * Plug or starts a new cable from its Jack depends entirely on whether that
 * Jack is currently "spread" (see Jack's hover-spread mechanic): a docked
 * Plug (not yet spread out) sits exactly on its Jack and forwards the click
 * to the Jack, same as clicking the Jack itself; a spread-out Plug is
 * clicked directly since it now occupies its own screen position.
 *
 * Keyboard: jacks are focusable (see Jack). Enter or Space on a jack
 * starts a new cable; moving the focus to another jack (Tab) carries the
 * cable's free end there; Enter or Space plugs it in; Escape cancels.
 *
 * A single instance is meant to be attached to the whole document (see
 * <cavi-interaction> in interactionwc.ts) — Jack/Plug don't install any
 * listeners of their own, so nothing works until some IInteractionController
 * (this one, by default, or a custom replacement) is attached.
 */
export class StandardInteractionController implements IInteractionController {
  private _attached: boolean = false;
  private _cavi: Cavi | null = null;
  /** A cable being created from the keyboard, if any (see _handleKeyDown). */
  private _keyboard: { session: CableSession; cavi: Cavi | null } | null = null;

  public attach(cavi: Cavi): void {
    if (this._attached) return;
    this._attached = true;
    this._cavi = cavi;
    document.addEventListener('pointerdown', this._handlePointerDown);
    document.addEventListener('pointermove', this._handleHoverMove);
    document.addEventListener('keydown', this._handleKeyDown);
    document.addEventListener('focusin', this._handleFocusIn);
  }

  public detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener('pointerdown', this._handlePointerDown);
    document.removeEventListener('pointermove', this._handleHoverMove);
    document.removeEventListener('keydown', this._handleKeyDown);
    document.removeEventListener('focusin', this._handleFocusIn);
    if (this._keyboard) this._endKeyboardCable(false);
    // Leaving hover state stuck would strand this world's hover-spread/
    // full-jack preview in whatever state it was in at the moment of detach.
    Jack.setPointerHoverPosition(null, null, this._cavi);
    this._cavi = null;
  }

  /** Walks the real (shadow-DOM-aware) event path to find the nearest Jack/Plug custom element, if any. */
  private _closestCaviElement(e: Event): Jack | Plug | null {
    for (const node of e.composedPath()) {
      if (node instanceof Jack || node instanceof Plug) return node;
    }
    return null;
  }

  private _handleHoverMove = (e: PointerEvent): void => {
    // Only this world's jacks: each world's controller feeds its own.
    Jack.setPointerHoverPosition(e.clientX, e.clientY, this._cavi);
  };

  private _handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const el = this._closestCaviElement(e);
    if (!el) return;
    // Every <cavi-world> gets its own controller, all listening on the
    // document — each only handles elements of its own world, or a click
    // would start one gesture per world on the same jack.
    if (Cavi.for(el) !== this._cavi) return;

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

  /** Relocates an existing Plug, entirely through Plug's public API. */
  private _startPlugDrag(plug: Plug, e: PointerEvent): void {
    const origin = plug.jack;
    plug.beginDrag();
    this._runGesture(plug, e, {
      move: (x, y) => plug.updateDragPosition(x, y),
      finish: () => plug.endDrag(),
      cancel: () => plug.cancelDrag(),
      abort: () => {
        // Back into the jack it was pulled out of, if it still has room —
        // otherwise just dropped, as for an interrupted gesture.
        if (origin?.isConnected && origin.canAcceptMore()) {
          const c = origin.getCenter();
          plug.updateDragPosition(c.x, c.y);
          plug.endDrag();
        } else {
          plug.cancelDrag();
        }
      },
    });
  }

  /** Creates a new cable from a Jack, entirely through Jack's public session API. */
  private _startCableCreation(jack: Jack, e: PointerEvent): void {
    const session = jack.createCable(e.clientX, e.clientY);
    if (!session) return;
    this._runGesture(jack, e, {
      move: (x, y) => Jack.updateCableSession(session, x, y),
      finish: () => Jack.finishCableSession(session),
      cancel: () => Jack.cancelCableSession(session),
      // Escape: the cable never existed — not an orphan left to fall away.
      abort: () => Jack.discardCableSession(session),
    });
  }

  /**
   * Drives one pointer gesture on `target` from its pointerdown to its
   * end, calling `handlers` as it goes. Always click-to-carry for
   * mouse/pen: the cable/plug follows the pointer with no button held,
   * and the next primary click ends it. Touch keeps press-and-drag
   * (pointer capture on `target`), the natural touch gesture. Escape
   * aborts it either way. The drag is announced to this world's jacks
   * (Jack.setDragActive) for the whole gesture.
   */
  private _runGesture(target: HTMLElement, e: PointerEvent, handlers: GestureHandlers): void {
    e.preventDefault();
    const pointerId = e.pointerId;
    // Captured: the gesture may end after this controller detached.
    const cavi = this._cavi;
    Jack.setDragActive(true, cavi);
    const clickToCarry = e.pointerType !== 'touch';

    const end = (handler: () => void): void => {
      cleanup();
      handler();
      Jack.setDragActive(false, cavi);
    };
    const onMove = (ev: PointerEvent): void => {
      // No pointerId filter when carrying: no button held and no pointer
      // capture, so the end simply follows wherever the pointer goes next.
      if (!clickToCarry && ev.pointerId !== pointerId) return;
      handlers.move(ev.clientX, ev.clientY);
    };
    const onCarryClick = (ev: PointerEvent): void => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      end(handlers.finish);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId) end(handlers.finish);
    };
    const onCancel = (ev: PointerEvent): void => {
      if (clickToCarry || ev.pointerId === pointerId) end(handlers.cancel);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      end(handlers.abort);
    };
    const cleanup = (): void => {
      document.removeEventListener('keydown', onKey, true);
      if (clickToCarry) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerdown', onCarryClick, true);
        document.removeEventListener('pointercancel', onCancel);
      } else {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onCancel);
        try {
          target.releasePointerCapture?.(pointerId);
        } catch {
          // Not supported / not captured — safe to ignore.
        }
      }
    };

    document.addEventListener('keydown', onKey, true);
    if (clickToCarry) {
      document.addEventListener('pointermove', onMove);
      // capture: true so this sees the finishing click before it can be
      // reinterpreted as, say, a fresh click on whatever it lands on.
      document.addEventListener('pointerdown', onCarryClick, true);
      document.addEventListener('pointercancel', onCancel);
    } else {
      try {
        target.setPointerCapture?.(pointerId);
      } catch {
        // Not supported in this environment (e.g. jsdom) — the drag still
        // works via the listeners added below.
      }
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
    }
  }

  /** The Jack of this world `e` happened on (the focused one, for key events), if any. */
  private _jackOf(e: Event): Jack | null {
    for (const node of e.composedPath()) {
      if (node instanceof Jack) return Cavi.for(node) === this._cavi ? node : null;
    }
    return null;
  }

  /**
   * Keyboard cable creation: Enter/Space on a focused jack starts a cable
   * there; while one is in progress, Enter/Space on another jack plugs it
   * in (on the same jack: cancels), Escape cancels.
   */
  private _handleKeyDown = (e: KeyboardEvent): void => {
    const activate = e.key === 'Enter' || e.key === ' ';
    if (this._keyboard) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._endKeyboardCable(false);
        return;
      }
      if (!activate) return;
      const jack = this._jackOf(e);
      if (!jack) return;
      e.preventDefault();
      if (jack === this._keyboard.session.jack) {
        this._endKeyboardCable(false);
        return;
      }
      this._moveKeyboardCable(jack);
      this._endKeyboardCable(true);
      return;
    }
    if (!activate || e.defaultPrevented) return;
    const jack = this._jackOf(e);
    if (!jack) return;
    const c = jack.getCenter();
    const session = jack.createCable(c.x, c.y);
    if (!session) return;
    e.preventDefault(); // Space would scroll the page
    this._keyboard = { session, cavi: this._cavi };
    Jack.setDragActive(true, this._cavi);
  };

  /** While a keyboard cable is in progress, focusing a jack carries its free end there. */
  private _handleFocusIn = (e: FocusEvent): void => {
    if (!this._keyboard) return;
    const jack = this._jackOf(e);
    if (jack && jack !== this._keyboard.session.jack) this._moveKeyboardCable(jack);
  };

  private _moveKeyboardCable(jack: Jack): void {
    const c = jack.getCenter();
    Jack.updateCableSession(this._keyboard!.session, c.x, c.y);
  }

  /** Ends the keyboard cable: plugs it in where its free end is (connect), or removes it. */
  private _endKeyboardCable(connect: boolean): void {
    const { session, cavi } = this._keyboard!;
    this._keyboard = null;
    if (connect) Jack.finishCableSession(session);
    else Jack.discardCableSession(session);
    Jack.setDragActive(false, cavi);
  }
}

/** What a pointer gesture does as it goes — see StandardInteractionController._runGesture. */
interface GestureHandlers {
  move(clientX: number, clientY: number): void;
  /** Released (press-and-drag) or the next click (click-to-carry). */
  finish(): void;
  /** Interrupted by the browser (pointercancel). */
  cancel(): void;
  /** Escape: undo the gesture. */
  abort(): void;
}
