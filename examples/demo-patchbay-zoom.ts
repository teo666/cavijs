import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import type { CaviWorldElement } from '../src/component/worldwc';
import '../src/component/worldwc'; // registers cavi-world, and transitively cavi-jack/cavi-wire/cavi-plug

/**
 * Validates that cavijs's coordinate-space primitives (Jack's x/y-optional
 * auto-detect fallback + Cavi.setCoordinateTransformProvider/
 * notifyCoordinateTransformChanged) are enough for a consumer to build
 * *any* pan/zoom implementation on top, without cavijs implementing pan/zoom
 * itself. d3-zoom is only ever imported here, in this example — it is a
 * devDependency, never a dependency of the library. See
 * demo-patchbay-zoom-svg.ts for the same validation against SvgRenderer.
 *
 * Every <cavi-jack> in demo-patchbay-zoom.html has no x/y attribute: its
 * position comes entirely from plain CSS Grid (see the `.panel` rule).
 * #viewport (the element d3-zoom actually transforms) is a plain page `div`
 * cavijs knows nothing about — the only channel between the two is the
 * CoordinateTransform registered below, consulted by Jack.getWorldPosition()
 * whenever a Jack has no explicit x/y.
 *
 * Why this is needed at all: getBoundingClientRect() (which the auto-detect
 * fallback measures a Jack's position from) already reflects whatever CSS
 * transform d3-zoom applies to #viewport. Jacks and plugs live inside that
 * transformed subtree, so the browser re-scales them visually for free, and
 * the renderer applies the same zoom to the cables — but only if the
 * *logical* coordinates fed to the physics
 * engine are the pre-zoom values. Without un-applying the transform here, a
 * Jack's auto-detected position would already be zoom-scaled, and the
 * physics/rendered cable would then be scaled a *second* time by the CSS
 * transform itself — visibly drifting from the jack at any zoom level other
 * than 1. clientToWorld (used internally by getWorldPosition) is exactly
 * the inverse of that.
 *
 * Clipping and blur: <cavi-world surface="#zoomFrame"> (see the HTML) puts
 * #wireCanvas on the untransformed, full-screen #zoomFrame instead of inside
 * the transformed #viewport. The canvas then covers the whole screen at
 * device-pixel resolution, and the renderer applies the zoom registered
 * below itself — so cables are never clipped to #panel's box when zooming
 * out, and stay sharp when zooming in (see RendererOptions.surface).
 */
/**
 * Wires up a plain draggable HTML box (`.jack-holder`, dragged only via its
 * `.jack-holder-handle` header so it never fights a jack/plug's own
 * pointerdown handling) that cavijs knows nothing about, same as
 * `#viewport` above. Its jacks keep no x/y attribute either, so their
 * plugged cables would otherwise be left stranded at the box's old position
 * on every drag step — calling `notifyCoordinateTransformChanged()` (the
 * exact same call the zoom handler above makes on every zoom step) is
 * enough to make Jack re-measure and re-glue them, regardless of *what*
 * moved the jack on screen.
 */
function setupDraggableJackHolder(
  holder: HTMLElement,
  handle: HTMLElement,
  worldEl: CaviWorldElement
): void {
  // Current translate offset of the holder, in its local (pre-zoom) space.
  let offsetX = 0;
  let offsetY = 0;
  let originX = 0;
  let originY = 0;
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;

  // Moved via `transform: translate(...)`, not `margin`: a transform doesn't
  // take part in layout, so it never reflows (or resizes) anything around
  // the holder. cavijs anchors every coordinate on the world container, so
  // it does not care whether this box is transformed. The delta is divided
  // by the outer zoom so the box tracks the cursor at any zoom level.
  const currentScale = (): number => worldEl.getCavi()?.getCoordinateTransform().scale ?? 1;

  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const scale = currentScale();
    offsetX = originX + (e.clientX - startX) / scale;
    offsetY = originY + (e.clientY - startY) / scale;
    holder.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    worldEl.notifyCoordinateTransformChanged();
  };

  const endDrag = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', endDrag);
    handle.removeEventListener('pointercancel', endDrag);
  };

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    // d3-zoom's own pan gesture listens for pointerdown on the whole
    // #zoomFrame (see main() below) — without stopping propagation here,
    // starting a holder drag from the handle would *also* start an outer
    // pan at the same time, doubling the on-screen movement and desyncing
    // Jack.getWorldPosition()'s measurements.
    e.stopPropagation();
    e.preventDefault();
    pointerId = e.pointerId;
    originX = offsetX;
    originY = offsetY;
    startX = e.clientX;
    startY = e.clientY;
    handle.setPointerCapture(pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  });
}

async function main(): Promise<void> {
  const frame = document.getElementById('zoomFrame')!;
  const viewport = document.getElementById('viewport') as HTMLElement;
  const worldEl = document.getElementById('panel') as CaviWorldElement;
  const jackHolder = document.getElementById('jackHolder') as HTMLElement;
  const jackHolderHandle = document.getElementById('jackHolderHandle') as HTMLElement;

  // <cavi-world>'s Cavi instance is created asynchronously (after WASM
  // init) — wait for it so the very first zoomIdentity call below isn't
  // silently dropped by setCoordinateTransform's no-op-if-not-ready guard.
  if (!worldEl.getCavi()) {
    await new Promise<void>((resolve) =>
      document.addEventListener('caviready', () => resolve(), { once: true })
    );
  }

  const behavior = zoom<HTMLElement, unknown>()
    .scaleExtent([0.4, 3])
    .on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
      const t = event.transform;
      viewport.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
      worldEl.setCoordinateTransform(() => ({ scale: t.k, translateX: t.x, translateY: t.y }));
      worldEl.notifyCoordinateTransformChanged();
    });

  // Start slightly offset so the grid isn't hidden under the info panel.
  select(frame as HTMLElement)
    .call(behavior)
    .call(behavior.transform, zoomIdentity.translate(40, 140));

  setupDraggableJackHolder(jackHolder, jackHolderHandle, worldEl);
}

main();
