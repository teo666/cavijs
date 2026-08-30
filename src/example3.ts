import type { Cavi } from './cavi';
import type { CaviWorldElement } from './worldwc';
import './worldwc'; // registers cavi-world, and transitively cavi-jack/cavi-wire/cavi-plug
import { materializeJacks, repositionJacksFromSlots, materializePatches, wireUpControls } from './patchbay-shared';

function main(): void {
  // <cavi-world id="panel" gravity-y="5"> (demo-patchbay.html) now owns WASM
  // init, canvas creation, and the render loop — see src/worldwc.ts. gravity/
  // debug-draw-nodes match what this main() used to set imperatively
  // (gravity-y="5" is worldwc's own default; debug-nodes starts
  // unset/false, matching the unchecked "show physics nodes" checkbox
  // below, which then drives it live).
  const panel = document.getElementById('panel') as CaviWorldElement;

  materializeJacks(panel);
  materializePatches(panel);
  panel.addEventListener('cavi-resize', () => repositionJacksFromSlots(panel));

  // wireUpControls needs the real Cavi instance, which only exists once
  // <cavi-world>'s async WASM init finishes — cavi-jack/cavi-wire/cavi-plug
  // already key off this same event (see wirewc.ts) to defer their own
  // setup, so this follows the same pattern rather than polling getCavi().
  document.addEventListener(
    'caviready',
    (e) => wireUpControls((e as CustomEvent<{ cavi: Cavi }>).detail.cavi, panel),
    { once: true },
  );
}

main();
