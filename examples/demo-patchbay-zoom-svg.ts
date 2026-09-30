import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { Cavi } from '../src/core/cavi';
import { SvgRenderer } from '../src/renderer/renderer-svg';
import '../src/component/jack'; // registers cavi-jack, and transitively cavi-wire (wirewc) + cavi-plug
import '../src/component/interactionwc'; // registers cavi-interaction

/**
 * Same validation as demo-patchbay-zoom.ts, against SvgRenderer instead of
 * the canvas Renderer — see that file for the full rationale. <cavi-world>
 * hardcodes a canvas Renderer with no pluggable-renderer hook (see
 * worldwc.ts), so this bootstraps Cavi/SvgRenderer manually here, same as
 * example3-svg.ts, instead of relying on <cavi-world>.
 *
 * Unlike the canvas variant, there is no raster-crispness caveat here: SVG
 * scales natively via the same CSS transform applied to #viewport, with no
 * bitmap involved — nothing extra for a consumer to do beyond registering
 * the coordinate transform below.
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
function setupDraggableJackHolder(holder: HTMLElement, handle: HTMLElement, cavi: Cavi): void {
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
  const currentScale = (): number => cavi.getCoordinateTransform().scale;

  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const scale = currentScale();
    offsetX = originX + (e.clientX - startX) / scale;
    offsetY = originY + (e.clientY - startY) / scale;
    holder.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    cavi.notifyCoordinateTransformChanged();
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
  await Cavi.initWasm();
  const frame = document.getElementById('zoomFrame')!;
  const viewport = document.getElementById('viewport') as HTMLElement;
  const panel = document.getElementById('panel') as HTMLElement;
  const jackHolder = document.getElementById('jackHolder') as HTMLElement;
  const jackHolderHandle = document.getElementById('jackHolderHandle') as HTMLElement;

  const cavi = new Cavi();
  // `surface`: the svg lives on the untransformed full-screen frame and
  // applies the zoom itself, instead of being clipped to #panel's box.
  const renderer = new SvgRenderer(panel, cavi.getWorld(), { surface: frame });
  cavi.setRenderer(renderer);
  cavi.setAcceleration(0, 0);
  cavi.setDebugDrawNodes(false);

  Cavi.shared = cavi;
  document.dispatchEvent(new CustomEvent('caviready', { detail: { cavi } }));

  if (!panel.querySelector('cavi-interaction')) {
    panel.appendChild(document.createElement('cavi-interaction'));
  }

  const behavior = zoom<HTMLElement, unknown>()
    .scaleExtent([0.4, 3])
    .on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
      const t = event.transform;
      viewport.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
      cavi.setCoordinateTransformProvider(() => ({ scale: t.k, translateX: t.x, translateY: t.y }));
      cavi.notifyCoordinateTransformChanged();
    });

  // Start slightly offset so the grid isn't hidden under the info panel.
  select(frame as HTMLElement)
    .call(behavior)
    .call(behavior.transform, zoomIdentity.translate(40, 140));

  setupDraggableJackHolder(jackHolder, jackHolderHandle, cavi);

  renderer.render();
}

main();
