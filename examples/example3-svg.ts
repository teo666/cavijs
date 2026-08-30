import { Cavi } from '../src/core/cavi';
import { SvgRenderer } from '../src/renderer/renderer-svg';
import '../src/component/jack'; // registers cavi-jack, and transitively cavi-wire (wirewc) + cavi-plug
import '../src/component/interactionwc'; // registers cavi-interaction
import {
  materializeJacks,
  repositionJacksFromSlots,
  materializePatches,
  wireUpControls,
} from './patchbay-shared';

/**
 * Same patchbay demo as example3.ts (demo-patchbay.html), but wired to
 * SvgRenderer instead of the canvas Renderer. <cavi-world> (worldwc.ts)
 * hardcodes a canvas Renderer with no pluggable-renderer hook, so this
 * bootstraps Cavi/SvgRenderer/<cavi-interaction> manually — mirroring
 * CaviWorldElement._setup() step for step (see worldwc.ts) — instead of
 * relying on <cavi-world>. Everything else (jack materialization, resize
 * repositioning, pre-patched cables, control wiring) is shared with
 * example3.ts via patchbay-shared.ts, since none of it depends on which
 * renderer is active.
 */
async function main(): Promise<void> {
  await Cavi.initWasm();
  const panel = document.getElementById('panel') as HTMLElement;

  const cavi = new Cavi();
  const renderer = new SvgRenderer(panel, cavi.getWorld());
  cavi.setRenderer(renderer);
  cavi.setAcceleration(0, 5); // matches demo-patchbay.html's gravity-y="5" (worldwc.ts's own default)
  cavi.setDebugDrawNodes(false); // matches debug-nodes being unset + the unchecked "show physics nodes" checkbox

  Cavi.shared = cavi;
  document.dispatchEvent(new CustomEvent('caviready', { detail: { cavi } }));

  // Jack/Plug install no listeners of their own — without some
  // <cavi-interaction>, dragging to create a cable wouldn't work.
  if (!panel.querySelector('cavi-interaction')) {
    panel.appendChild(document.createElement('cavi-interaction'));
  }

  materializeJacks(panel);
  materializePatches(panel);
  panel.addEventListener('cavi-resize', () => repositionJacksFromSlots(panel));
  wireUpControls(cavi, panel);

  renderer.render();
}

main();
