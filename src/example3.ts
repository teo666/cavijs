import { Cavi } from './cavi';
import { Renderer } from './renderer';
import './jack';
import './wirewc'; // registers cavi-wire and pulls in cavi-plug

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

async function main(): Promise<void> {
  await Cavi.initWasm();

  const panel = document.getElementById('panel')!;
  const canvas = panel.querySelector('#wireCanvas') as HTMLCanvasElement;
  // The panel fills the viewport (see index3.html), so size the canvas's
  // pixel buffer to match its actual rendered size rather than a fixed
  // width/height attribute — this demo doesn't re-layout on window resize,
  // matching index2.html's own fixed-size approach, just at whatever size
  // the viewport happened to be on load.
  canvas.width = panel.clientWidth;
  canvas.height = panel.clientHeight;

  const cavi = new Cavi();
  const renderer = new Renderer(panel, cavi.getWorld());
  cavi.setRenderer(renderer);
  cavi.setAcceleration(0, 5);
  // Renderer defaults this to true; start clean, matching the unchecked
  // "show physics nodes" checkbox below, which then drives it live.
  cavi.setDebugDrawNodes(false);
  // Click-to-carry: a click detaches/creates and starts following the
  // cursor with no button held, so native scrolling — including trackpad
  // gestures — is never blocked while reaching for an off-screen jack.
  // Mouse/pen only; touch keeps the default press-and-drag (see Jack/Plug's
  // handlePointerDown for why). No auto-scroll hack needed anymore: with
  // nothing held down mid-drag, #panelScroll's native overflow-y:auto
  // already just works.
  cavi.setDragMode('click');

  materializeJacks(panel);
  materializePatches(panel);

  // Make the Cavi instance available to cavi-wire web components
  Cavi.shared = cavi;
  document.dispatchEvent(new CustomEvent('caviready', { detail: { cavi } }));

  wireUpControls(cavi, panel);

  renderer.render();
}

main();
