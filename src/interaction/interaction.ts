import { Cavi } from '../core/cavi';
import { Jack } from '../component/jack';
import { Plug } from '../component/plug';
import type { IInteractionController } from '../core/types';

/** How long (ms) a touch press on a Jack with Plugs is held still before its fan opens. */
export const LONG_PRESS_MS = 400;
/** How far (viewport px) the finger may wander during that press before it counts as a drag instead. */
export const LONG_PRESS_SLOP = 8;

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
 * Touch has no hover, so a long press (LONG_PRESS_MS, the finger held
 * still within LONG_PRESS_SLOP) on a Jack that already has Plugs opens its
 * fan instead (Jack.holdSpread) and keeps it open: the next press on one of
 * those spread-out Plugs drags it, and any other press closes the fan (and
 * still does what it would have done). A touch press on such a Jack that
 * moves before then starts a new cable as usual; a short tap does nothing.
 *
 * Pointer only: the keyboard is KeyboardInteractionController's
 * (src/interaction/keyboard.ts), which <cavi-interaction> attaches next to
 * this one.
 *
 * A single instance is meant to be attached to the whole document (see
 * <cavi-interaction> in interactionwc.ts) — Jack/Plug don't install any
 * listeners of their own, so nothing works until some IInteractionController
 * (this one, by default, or a custom replacement) is attached.
 */
export class StandardInteractionController implements IInteractionController {
  private _attached: boolean = false;
  private _cavi: Cavi | null = null;
  /** The Jack whose fan a touch long press opened, held until the next press. */
  private _heldSpread: Jack | null = null;
  /** Gives up the touch press waiting to become a long press or a drag, if any. */
  private _cancelPendingPress: (() => void) | null = null;

  public attach(cavi: Cavi): void {
    if (this._attached) return;
    this._attached = true;
    this._cavi = cavi;
    document.addEventListener('pointerdown', this._handlePointerDown);
    document.addEventListener('pointermove', this._handleHoverMove);
  }

  public detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener('pointerdown', this._handlePointerDown);
    document.removeEventListener('pointermove', this._handleHoverMove);
    this._cancelPendingPress?.();
    this._setHeldSpread(null);
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
    // A finger only "hovers" while it drags something (for the full-jack
    // preview): otherwise it would fan out whatever jack it rests on, and
    // leave it open once lifted.
    if (e.pointerType === 'touch' && !Jack.isDragActive(this._cavi)) return;
    // Only this world's jacks: each world's controller feeds its own.
    Jack.setPointerHoverPosition(e.clientX, e.clientY, this._cavi);
  };

  private _handlePointerDown = (e: PointerEvent): void => {
    // Any press closes a fan held open by a long press. If it lands on one
    // of that fan's plugs, the plug is still spread out (the fan only
    // recompacts after a delay), so it is picked up below.
    this._setHeldSpread(null);
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
        this._pressJack(el.jack, e);
        return;
      }
      this._startPlugDrag(el, e);
      return;
    }

    if (el instanceof Jack) {
      this._pressJack(el, e);
    }
  };

  /**
   * A press on a Jack: a new cable, except for a touch press on a Jack that
   * already has Plugs, which waits to see whether it becomes a long press.
   */
  private _pressJack(jack: Jack, e: PointerEvent): void {
    if (e.pointerType === 'touch' && jack.plugCount > 0) {
      this._awaitLongPress(jack, e);
      return;
    }
    this._startCableCreation(jack, e);
  }

  /**
   * Waits on a touch press on `jack`: held still for LONG_PRESS_MS, it
   * opens the jack's fan (and keeps it open, see _setHeldSpread); moved
   * further than LONG_PRESS_SLOP first, it starts a new cable from the jack
   * as any other press would; lifted first, it does nothing.
   */
  private _awaitLongPress(jack: Jack, e: PointerEvent): void {
    e.preventDefault();
    this._cancelPendingPress?.();
    const pointerId = e.pointerId;

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) <= LONG_PRESS_SLOP) return;
      cleanup();
      this._startCableCreation(jack, e, ev.clientX, ev.clientY);
    };
    const onEnd = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId) cleanup();
    };
    const timer = setTimeout(() => {
      cleanup();
      this._setHeldSpread(jack);
    }, LONG_PRESS_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      this._cancelPendingPress = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    this._cancelPendingPress = cleanup;
  }

  /** Keeps `jack`'s fan open (Jack.holdSpread), letting go of the one held before. */
  private _setHeldSpread(jack: Jack | null): void {
    if (this._heldSpread === jack) return;
    this._heldSpread?.holdSpread(false);
    this._heldSpread = jack;
    jack?.holdSpread(true);
  }

  /** Relocates an existing Plug, entirely through Plug's public API. */
  private _startPlugDrag(plug: Plug, e: PointerEvent): void {
    const origin = plug.jack;
    plug.beginDrag();
    this._runGesture(plug, e, {
      move: (x, y) => plug.updateDragPosition(x, y),
      finish: () => plug.endDrag(),
      cancel: () => plug.cancelDrag(),
      // Back into the jack it was pulled out of, if it still has room —
      // otherwise just dropped, as for an interrupted gesture.
      abort: () => plug.endDragAt(origin),
    });
  }

  /**
   * Creates a new cable from a Jack, entirely through Jack's public session
   * API. `atX`/`atY`: where the pointer is now, when the gesture starts later
   * than its pointerdown `e` (a touch press that waited, see _awaitLongPress).
   */
  private _startCableCreation(jack: Jack, e: PointerEvent, atX = e.clientX, atY = e.clientY): void {
    const session = jack.createCable(e.clientX, e.clientY);
    if (!session) return;
    this._runGesture(jack, e, {
      move: (x, y) => Jack.updateCableSession(session, x, y),
      finish: () => Jack.finishCableSession(session),
      cancel: () => Jack.cancelCableSession(session),
      // Escape: the cable never existed — not an orphan left to fall away.
      abort: () => Jack.discardCableSession(session),
    });
    if (atX !== e.clientX || atY !== e.clientY) Jack.updateCableSession(session, atX, atY);
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
      // A lifted finger no longer points anywhere (see _handleHoverMove).
      if (!clickToCarry) Jack.setPointerHoverPosition(null, null, cavi);
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
