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
 * What's traded away: d3-drag's gesture model is strictly press-and-hold
 * (mousedown/touchstart → move while held → release), so unlike
 * StandardInteractionController this has no "click-to-carry" mode for
 * mouse/pen (click once, move without holding, click again to drop) — every
 * pointer type here behaves like touch does there. Use
 * StandardInteractionController instead if click-to-carry matters to you.
 */

/** What a single drag gesture is acting on, decided once in `.subject()` and threaded through start/drag/end by d3-drag itself. */
type DragSubject =
  { kind: 'plug'; plug: Plug } | { kind: 'cable'; jack: Jack; session: CableSession | null };

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
  private _attached = false;
  private _cavi: Cavi | null = null;
  private _behavior = drag<HTMLElement, unknown, DragSubject | null>();

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
        if (el instanceof Plug) {
          if (!el.isSpread() && el.jack) return { kind: 'cable', jack: el.jack, session: null };
          return { kind: 'plug', plug: el };
        }
        if (el instanceof Jack) return { kind: 'cable', jack: el, session: null };
        return null;
      })
      .on('start', (event: D3DragEvent<HTMLElement, unknown, DragSubject>) => {
        const subject = event.subject;
        const { x, y } = clientPointFromSourceEvent(event.sourceEvent);
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
        if (subject.kind === 'plug') {
          subject.plug.updateDragPosition(x, y);
        } else if (subject.session) {
          Jack.updateCableSession(subject.session, x, y);
        }
      })
      .on('end', (event: D3DragEvent<HTMLElement, unknown, DragSubject>) => {
        const subject = event.subject;
        if (subject.kind === 'plug') {
          subject.plug.endDrag();
        } else if (subject.session) {
          Jack.finishCableSession(subject.session);
        }
        Jack.setDragActive(false);
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
    // Same reasoning as StandardInteractionController.detach(): leaving
    // hover state stuck would strand every Jack's hover-spread/full-jack
    // preview in whatever state it was in at the moment of detach.
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
}
