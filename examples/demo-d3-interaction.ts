import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { drag, type D3DragEvent } from 'd3-drag';
import type { CaviWorldElement } from '../src/component/worldwc';
import '../src/component/worldwc'; // registers cavi-world, and transitively cavi-jack/cavi-wire/cavi-plug/cavi-interaction
import type { CaviInteractionElement } from '../src/component/interactionwc';
import { Jack } from '../src/component/jack';
import { Plug } from '../src/component/plug';
import {
  D3InteractionController,
  clientPointFromSourceEvent,
  type D3InteractionMode,
} from './d3-interaction';

/**
 * Swaps <cavi-world>'s default <cavi-interaction> (StandardInteractionController
 * — see worldwc.ts's own auto-attach-if-missing check) for one running
 * D3InteractionController instead. Importing worldwc.ts above upgrades the
 * already-parsed <cavi-world id="panel"> synchronously, which means its
 * connectedCallback (and therefore the default auto-attach) has *already*
 * run by the time this function body executes — so the only way to swap
 * controllers here is to remove that default child (this fires its
 * disconnectedCallback, cleanly detach()ing StandardInteractionController)
 * and append a fresh <cavi-interaction> with `.controller` set beforehand,
 * exactly the override pattern documented in interactionwc.ts.
 */
function useD3Interaction(worldEl: CaviWorldElement): D3InteractionController {
  worldEl.querySelector('cavi-interaction')?.remove();
  const el = document.createElement('cavi-interaction') as CaviInteractionElement;
  const controller = new D3InteractionController();
  el.controller = controller;
  worldEl.appendChild(el);
  return controller;
}

/** Wires the page's hold/carry radio group to `controller.mode` — the controller reads it at the end of every gesture, so switching takes effect from the next one. */
function bindModeToggle(controller: D3InteractionController): void {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[name="interaction-mode"]');
  for (const input of inputs) {
    if (input.checked) controller.mode = input.value as D3InteractionMode;
    input.addEventListener('change', () => {
      if (input.checked) controller.mode = input.value as D3InteractionMode;
    });
  }
}

/** True if `event`'s real (shadow-DOM-aware) target path touches a Jack/Plug or a `.jack-unit-handle` — i.e. something d3-drag (D3InteractionController or makeDraggableUnit) already claims, so d3-zoom's own pan/wheel gesture below must not also start for it. */
function targetsD3DragOwnedElement(event: Event): boolean {
  for (const node of event.composedPath()) {
    if (node instanceof Jack || node instanceof Plug) return true;
    if (node instanceof HTMLElement && node.classList.contains('jack-unit-handle')) return true;
  }
  return false;
}

/**
 * Wires up one `.jack-unit` box (dragged only via its own `.jack-unit-handle`
 * header, same delegation split as D3InteractionController: this instance
 * never touches jacks/plugs directly) with its own d3-drag behavior — d3 is
 * used for *every* gesture in this demo, not just the library-facing one.
 *
 * Moved through `transform: translate(...)`, not `margin`: a transform
 * doesn't take part in layout, so the other units stay put. `margin` did —
 * the units are inline-blocks in normal flow, so growing one unit's margin
 * pushed every following unit along with it. cavijs anchors every
 * coordinate on the <cavi-world> container (never on a jack's
 * `offsetParent`), so a transformed unit is fine for its jacks.
 *
 * The translate delta is divided by the *outer* d3-zoom scale on every
 * drag tick: dragging this unit by a given screen-pixel amount must move it
 * by that same amount on screen regardless of the current zoom level, but
 * the translate is measured in this unit's own local (pre-zoom) space — the ancestor #viewport's `transform: scale(k)` then
 * visually re-scales that local movement by k for free, so failing to
 * divide here would make the box drift faster/slower than the cursor at
 * any zoom level other than 1 (same reasoning as Jack.getWorldPosition()
 * itself, just applied to a translate delta instead of a screen-rect delta).
 */
function makeDraggableUnit(
  unitEl: HTMLElement,
  handleEl: HTMLElement,
  worldEl: CaviWorldElement
): void {
  const currentScale = (): number => worldEl.getCavi()?.getCoordinateTransform().scale ?? 1;

  // Current translate offset of this unit, in its local (pre-zoom) space.
  let offsetX = 0;
  let offsetY = 0;
  let originX = 0;
  let originY = 0;
  let startX = 0;
  let startY = 0;

  const behavior = drag<HTMLElement, unknown>()
    .on('start', (event: D3DragEvent<HTMLElement, unknown, unknown>) => {
      originX = offsetX;
      originY = offsetY;
      const p = clientPointFromSourceEvent(event.sourceEvent);
      startX = p.x;
      startY = p.y;
    })
    .on('drag', (event: D3DragEvent<HTMLElement, unknown, unknown>) => {
      const scale = currentScale();
      const p = clientPointFromSourceEvent(event.sourceEvent);
      offsetX = originX + (p.x - startX) / scale;
      offsetY = originY + (p.y - startY) / scale;
      unitEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
      worldEl.notifyCoordinateTransformChanged();
    });

  select(handleEl).call(behavior);
}

async function main(): Promise<void> {
  const worldEl = document.getElementById('panel') as CaviWorldElement;
  bindModeToggle(useD3Interaction(worldEl));

  // <cavi-world>'s Cavi instance is created asynchronously (after WASM
  // init) — wait for it so the very first zoomIdentity call below isn't
  // silently dropped by setCoordinateTransform's no-op-if-not-ready guard,
  // and so makeDraggableUnit()'s currentScale() has something to read.
  if (!worldEl.getCavi()) {
    await new Promise<void>((resolve) =>
      document.addEventListener('caviready', () => resolve(), { once: true })
    );
  }

  const frame = document.getElementById('zoomFrame')!;
  const viewport = document.getElementById('viewport') as HTMLElement;

  const zoomBehavior = zoom<HTMLElement, unknown>()
    .scaleExtent([0.4, 3])
    // Everything under a Jack/Plug or a `.jack-unit-handle` is exclusively
    // d3-drag's (D3InteractionController's or makeDraggableUnit's) —
    // without this, a pointerdown there would bubble up to #zoomFrame and
    // start an outer pan *at the same time*, doubling the on-screen
    // movement (this is exactly the bug the single-module version of this
    // demo hit before adding an equivalent guard).
    .filter((event: MouseEvent | WheelEvent | TouchEvent) => {
      if (event.type === 'wheel') return true;
      if (event instanceof MouseEvent && event.button !== 0) return false;
      return !targetsD3DragOwnedElement(event);
    })
    .on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
      const t = event.transform;
      viewport.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
      worldEl.setCoordinateTransform(() => ({ scale: t.k, translateX: t.x, translateY: t.y }));
      worldEl.notifyCoordinateTransformChanged();
    });

  select(frame as HTMLElement)
    .call(zoomBehavior)
    .call(zoomBehavior.transform, zoomIdentity);

  for (const id of ['unit-a', 'unit-b', 'unit-c']) {
    const unitEl = document.getElementById(id) as HTMLElement;
    const handleEl = unitEl.querySelector('.jack-unit-handle') as HTMLElement;
    makeDraggableUnit(unitEl, handleEl, worldEl);
  }
}

main();
