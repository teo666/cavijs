import type { Cavi } from './cavi';
import type { CaviWorldElement } from './worldwc';
import './worldwc'; // registers cavi-world, and transitively cavi-jack/cavi-wire/cavi-plug

/**
 * A pre-patched connection between two jacks, materialized as a
 * <cavi-wire>+two <cavi-plug jack="..."> DOM subtree — the same
 * declarative wiring CaviWireElement._setup() already supports, just
 * generated here instead of hand-written in HTML since the jacks
 * themselves are also generated (see materializeJacks below).
 */
interface Patch {
  from: string;
  to: string;
  color: string;
  type: string;
  /** Demonstrates the freeze-on-drop <cavi-plug> attribute. */
  freezeTo?: boolean;
  /** Demonstrates the auto-cleanup <cavi-wire> attribute. */
  autoCleanup?: boolean;
}

const PATCHES: Patch[] = [
  { from: 'vco1-out', to: 'vcf-in', color: '#3fc6d8', type: 'audio' },
  { from: 'vcf-out', to: 'vca-in', color: '#3fc6d8', type: 'audio' },
  { from: 'vca-out', to: 'mix-in1', color: '#e8834a', type: 'audio', autoCleanup: true },
  { from: 'lfo1-out', to: 'vcf-cv', color: '#d966b3', type: 'cv' },
  { from: 'env-out', to: 'vca-cv', color: '#d966b3', type: 'cv', freezeTo: true },
];

const PATCH_NODE_COUNT = 14;

/**
 * Turns every .jack-slot placeholder (positioned by the panel's own CSS
 * layout, see index3.html) into a real <cavi-jack> at that slot's on-screen
 * center — keeping the responsive panel layout (CSS Grid/Flexbox) separate
 * from a jack's absolute x/y physics coordinates, which are computed once
 * here from the actually-rendered layout rather than hand-picked pixels.
 */
function materializeJacks(panel: HTMLElement): void {
  const panelRect = panel.getBoundingClientRect();

  for (const slot of Array.from(panel.querySelectorAll<HTMLElement>('.jack-slot'))) {
    const id = slot.dataset.id;
    if (!id) continue;

    const rect = slot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 - panelRect.left;
    const cy = rect.top + rect.height / 2 - panelRect.top;

    const jack = document.createElement('cavi-jack');
    jack.id = id;
    jack.setAttribute('x', String(cx));
    jack.setAttribute('y', String(cy));
    jack.setAttribute('type', slot.dataset.type ?? '');
    if (slot.dataset.maxPlugs) jack.setAttribute('max-plugs', slot.dataset.maxPlugs);
    if (slot.dataset.cableColor) jack.setAttribute('cable-color', slot.dataset.cableColor);
    // Three socket sizes (see index3.html's cavi-jack.size-sm/size-lg) —
    // 'md' is the unmodified default, so only sm/lg need an extra class.
    if (slot.dataset.size === 'sm' || slot.dataset.size === 'lg') {
      jack.classList.add(`size-${slot.dataset.size}`);
    }
    panel.appendChild(jack);
  }
}

/**
 * Re-measures every .jack-slot placeholder's on-screen center and updates
 * the matching already-materialized <cavi-jack>'s x/y attributes — called
 * on every 'cavi-resize' (see worldwc.ts) so jacks (and, via Jack's own
 * plug-snapping, any cables already plugged into them) track the panel's
 * responsive CSS layout instead of staying frozen at their load-time
 * position.
 */
function repositionJacksFromSlots(panel: HTMLElement): void {
  const panelRect = panel.getBoundingClientRect();

  for (const slot of Array.from(panel.querySelectorAll<HTMLElement>('.jack-slot'))) {
    const id = slot.dataset.id;
    if (!id) continue;

    const jack = document.getElementById(id);
    if (!jack) continue;

    const rect = slot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 - panelRect.left;
    const cy = rect.top + rect.height / 2 - panelRect.top;

    jack.setAttribute('x', String(cx));
    jack.setAttribute('y', String(cy));
  }
}

/** Builds the initial "already patched" cables from PATCHES. */
function materializePatches(panel: HTMLElement): void {
  for (const patch of PATCHES) {
    const wire = document.createElement('cavi-wire');
    wire.setAttribute('length', String(PATCH_NODE_COUNT));
    wire.setAttribute('tension', '20');
    wire.setAttribute('size', '6');
    wire.setAttribute('color', patch.color);
    wire.setAttribute('type', patch.type);
    if (patch.autoCleanup) wire.setAttribute('auto-cleanup', '');

    const origin = document.createElement('cavi-plug');
    origin.setAttribute('node', '0');
    origin.setAttribute('jack', patch.from);

    const end = document.createElement('cavi-plug');
    end.setAttribute('node', String(PATCH_NODE_COUNT - 1));
    end.setAttribute('jack', patch.to);
    if (patch.freezeTo) end.setAttribute('freeze-on-drop', '');

    wire.appendChild(origin);
    wire.appendChild(end);
    panel.appendChild(wire);
  }
}

function wireUpControls(cavi: Cavi, panel: HTMLElement): void {
  const debugCheckbox = document.getElementById('debugNodes') as HTMLInputElement;
  debugCheckbox.addEventListener('change', () => {
    cavi.setDebugDrawNodes(debugCheckbox.checked);
  });

  // Applied live to every jack, so it takes effect on the next cable
  // grown/created from any of them — see Jack's cable-node-spawn attribute.
  const spawnSelect = document.getElementById('spawnMode') as HTMLSelectElement;
  spawnSelect.addEventListener('change', () => {
    for (const jack of Array.from(panel.querySelectorAll('cavi-jack'))) {
      jack.setAttribute('cable-node-spawn', spawnSelect.value);
    }
  });

  const clearButton = document.getElementById('clearPatches') as HTMLButtonElement;
  clearButton.addEventListener('click', () => {
    cavi.clearAllWires(); // frees every wire WASM-side...
    for (const wireEl of Array.from(panel.querySelectorAll('cavi-wire'))) {
      wireEl.remove(); // ...then drops the now-stale DOM subtree.
    }
  });
}

function main(): void {
  // <cavi-world id="panel" gravity-y="5" drag-mode="click"> (index3.html)
  // now owns WASM init, canvas creation, and the render loop — see
  // src/worldwc.ts. gravity/debug-draw-nodes/drag-mode all match what this
  // main() used to set imperatively (gravity-y="5" is worldwc's own default;
  // debug-nodes starts unset/false, matching the unchecked "show physics
  // nodes" checkbox below, which then drives it live).
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
