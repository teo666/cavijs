import { select } from 'd3-selection';
import { drag, type D3DragEvent } from 'd3-drag';
import { Cavi } from '../src/core/cavi';
import type { IInteractionController } from '../src/core/types';
import { Jack, type CableSession } from '../src/component/jack';
import { Plug } from '../src/component/plug';

/**
 * Alternative to StandardInteractionController (src/interaction/
 * interaction.ts), driving the exact same public domain API
 * (createCable/updateCableSession/finishCableSession, beginDrag/
 * updateDragPosition/endDrag, findSnapTarget/setPointerHoverPosition) but
 * through d3-drag instead of hand-rolled pointerdown/pointermove/pointerup
 * bookkeeping — proof that IInteractionController is a genuinely pluggable
 * seam, not something only cavijs's own default implementation can fill.
 * Deliberately kept out of src/: cavijs itself never depends on d3, same as
 * d3-zoom in demo-patchbay-zoom.ts — this is consumer-space code a user
 * could paste into their own project just as easily.
 *
 * What d3-drag buys you over StandardInteractionController, concretely:
 * - No manual pointer capture / listener add-remove per gesture — `.on()`
 *   handlers only run while a drag it decided to start is actually live.
 * - `.filter()` + `.subject()` replace the hand-written "which element, and
 *   is it a plug that should forward to its jack instead" branch, run once
 *   up front instead of threaded through every handler.
 * - Mouse and touch are unified by d3-drag's own gesture state machine.
 *
 * Two modes (see D3InteractionMode), switchable at any time via `.mode`:
 * - 'hold' (default): strictly press-and-hold, d3-drag's own gesture model
 *   (mousedown/touchstart → move while held → release).
 * - 'carry': hybrid. Press-drag-release still works exactly as in 'hold',
 *   but a mouse/pen click that releases without moving leaves the cable/plug
 *   carried by the pointer with no button held, until the next primary
 *   click drops it — the click-to-carry StandardInteractionController
 *   always uses for mouse/pen. d3-drag has no notion of this, so the carry
 *   phase is a few document-level listeners picked up after d3-drag's own
 *   `end` (see _beginCarry). Touch always stays 'hold', same as there.
 */

export type D3InteractionMode = 'hold' | 'carry';

export interface D3InteractionOptions {
  mode?: D3InteractionMode;
}

/** Max pointer travel (screen px) between press and release for a gesture to still count as a click — and so, in 'carry' mode, to turn into a carry instead of finishing on release. */
const CARRY_CLICK_DISTANCE = 3;

/** What a single drag gesture is acting on, decided once in `.subject()` and threaded through start/drag/end by d3-drag itself. */
type DragSubject = (
  { kind: 'plug'; plug: Plug } | { kind: 'cable'; jack: Jack; session: CableSession | null }
) & {
  /** Client-space pointer position at gesture start, set in `start`. */
  originX: number;
  originY: number;
  /** Whether the pointer has travelled past CARRY_CLICK_DISTANCE since `start`. */
  moved: boolean;
};

/**
 * d3-drag normalizes mouse/touch gesture state but still hands back the
 * underlying native event as `sourceEvent` — this reads viewport
 * coordinates off of it directly (rather than d3's own container-relative
 * event.x/event.y) so it lines up exactly with the clientX/clientY every
 * Jack/Plug domain method already expects.
 */
export function clientPointFromSourceEvent(sourceEvent: Event): { x: number; y: number } {
  if (sourceEvent instanceof MouseEvent) {
    return { x: sourceEvent.clientX, y: sourceEvent.clientY };
  }
  if (typeof TouchEvent !== 'undefined' && sourceEvent instanceof TouchEvent) {
    const touch = sourceEvent.touches[0] ?? sourceEvent.changedTouches[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
  }
  return { x: 0, y: 0 };
}

export class D3InteractionController implements IInteractionController {
  /** Read at the end of every gesture, so changing it mid-carry lets the current carry finish normally. */
  public mode: D3InteractionMode;

  private _attached = false;
  private _cavi: Cavi | null = null;
  private _behavior = drag<HTMLElement, unknown, DragSubject | null>();
  /** The gesture currently being carried with no button held ('carry' mode only), if any. */
  private _carry: DragSubject | null = null;

  constructor(options: D3InteractionOptions = {}) {
    this.mode = options.mode ?? 'hold';
  }

  public attach(cavi: Cavi): void {
    if (this._attached) return;
    this._attached = true;
    this._cavi = cavi;

    document.addEventListener('pointermove', this._handleHoverMove);

    this._behavior
      // Runs before a gesture starts: rejects right/middle-click and any
      // pointerdown that didn't land on a Jack/Plug at all, same gate
      // StandardInteractionController applies per-event.
      .filter((event: MouseEvent | TouchEvent) => {
        // The click that ends a carry is already swallowed in capture by
        // _handleCarryFinish — this is just a second line of defense.
        if (this._carry) return false;
        if (event instanceof MouseEvent && event.button !== 0) return false;
        const el = this._closestCaviElement(event);
        // Only elements of this controller's own world (see Cavi.for).
        return el !== null && Cavi.for(el) === this._cavi;
      })
      // Computed once per gesture — mirrors StandardInteractionController's
      // "a docked plug forwards to its jack" rule (see _handlePointerDown).
      // Unlike .filter() above (which gets the raw native event), d3-drag
      // calls .subject() with its own synthetic "beforestart" DragEvent —
      // the real MouseEvent/TouchEvent lives on its `.sourceEvent`.
      .subject((event: D3DragEvent<HTMLElement, unknown, DragSubject>): DragSubject | null => {
        const el = this._closestCaviElement(event.sourceEvent);
        const gesture = { originX: 0, originY: 0, moved: false };
        if (el instanceof Plug) {
          if (!el.isSpread() && el.jack) {
            return { kind: 'cable', jack: el.jack, session: null, ...gesture };
          }
          return { kind: 'plug', plug: el, ...gesture };
        }
        if (el instanceof Jack) return { kind: 'cable', jack: el, session: null, ...gesture };
        return null;
      })
      .on('start', (event: D3DragEvent<HTMLElement, unknown, DragSubject>) => {
        const subject = event.subject;
        const { x, y } = clientPointFromSourceEvent(event.sourceEvent);
        subject.originX = x;
        subject.originY = y;
        Jack.setDragActive(true);
        if (subject.kind === 'plug') {
          subject.plug.beginDrag();
          subject.plug.updateDragPosition(x, y);
        } else {
          // null when the jack has no room left (canAcceptMore() — see
          // Jack.createCable) — the gesture still runs to completion below,
          // it just never touches a session, same silent no-op
          // StandardInteractionController falls back to.
          subject.session = subject.jack.createCable(x, y);
        }
      })
      .on('drag', (event: D3DragEvent<HTMLElement, unknown, DragSubject>) => {
        const subject = event.subject;
        const { x, y } = clientPointFromSourceEvent(event.sourceEvent);
        const dx = x - subject.originX;
        const dy = y - subject.originY;
        if (dx * dx + dy * dy > CARRY_CLICK_DISTANCE * CARRY_CLICK_DISTANCE) {
          subject.moved = true;
        }
        this._move(subject, x, y);
      })
      .on('end', (event: D3DragEvent<HTMLElement, unknown, DragSubject>) => {
        const subject = event.subject;
        // Touch never carries: a finger lifted off the screen has no
        // position left to follow (same exception as StandardInteractionController).
        if (this.mode === 'carry' && event.sourceEvent instanceof MouseEvent && !subject.moved) {
          this._beginCarry(subject);
          return;
        }
        this._finish(subject);
      });

    select(document.documentElement).call(this._behavior);
  }

  public detach(): void {
    if (!this._attached) return;
    this._attached = false;
    this._cavi = null;
    document.removeEventListener('pointermove', this._handleHoverMove);
    // Unbinds every "*.drag" namespaced listener d3-drag itself installed
    // via the .call() above — the same cleanup .call(drag) would need if
    // you wanted to stop reusing this._behavior on a fresh selection.
    select(document.documentElement).on('.drag', null);
    // A carry outlives d3-drag's own gesture, so the unbind above doesn't
    // end it — drop it here or the cable would stay stuck to the pointer.
    const carried = this._carry;
    if (carried) {
      this._endCarry();
      this._cancel(carried);
    }
    // Same reasoning as StandardInteractionController.detach(): leaving
    // hover state stuck would strand every Jack's hover-spread/full-jack
    // preview in whatever state it was in at the moment of detach.
    Jack.setPointerHoverPosition(null, null);
  }

  private _move(subject: DragSubject, x: number, y: number): void {
    if (subject.kind === 'plug') {
      subject.plug.updateDragPosition(x, y);
    } else if (subject.session) {
      Jack.updateCableSession(subject.session, x, y);
    }
  }

  private _finish(subject: DragSubject): void {
    if (subject.kind === 'plug') {
      subject.plug.endDrag();
    } else if (subject.session) {
      Jack.finishCableSession(subject.session);
    }
    Jack.setDragActive(false);
  }

  private _cancel(subject: DragSubject): void {
    if (subject.kind === 'plug') {
      subject.plug.cancelDrag();
    } else if (subject.session) {
      Jack.cancelCableSession(subject.session);
    }
    Jack.setDragActive(false);
  }

  /**
   * Keeps a gesture d3-drag has already ended alive with no button held:
   * the cable/plug follows the pointer until the next primary click.
   * Listens for that click as `mousedown` in capture on the document — not
   * `pointerdown` — because that's what d3-drag (on documentElement) and
   * d3-zoom (on its frame) themselves listen to: stopping it here, before
   * it reaches either, keeps the dropping click from instantly starting a
   * new cable on the jack it lands on, or a pan on empty space.
   */
  private _beginCarry(subject: DragSubject): void {
    this._carry = subject;
    document.addEventListener('pointermove', this._handleCarryMove);
    document.addEventListener('mousedown', this._handleCarryFinish, true);
    document.addEventListener('pointercancel', this._handleCarryCancel);
  }

  private _endCarry(): void {
    this._carry = null;
    document.removeEventListener('pointermove', this._handleCarryMove);
    document.removeEventListener('mousedown', this._handleCarryFinish, true);
    document.removeEventListener('pointercancel', this._handleCarryCancel);
  }

  private _handleCarryMove = (e: PointerEvent): void => {
    if (this._carry) this._move(this._carry, e.clientX, e.clientY);
  };

  private _handleCarryFinish = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const carried = this._carry;
    if (!carried) return;
    e.preventDefault();
    e.stopPropagation();
    this._endCarry();
    this._finish(carried);
  };

  private _handleCarryCancel = (): void => {
    const carried = this._carry;
    if (!carried) return;
    this._endCarry();
    this._cancel(carried);
  };

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
}
