import type { WasmWorld } from 'cavi';
import type { Cavi } from './cavi';

export interface IRenderer {
    render: () => void;
    setDebugDrawNodes: (enabled: boolean) => void;
    getDebugDrawNodes: () => boolean;
    getContainer: () => HTMLElement;
    stop: () => void;
}

/**
 * Contract for anything that drives user interaction (drag, click, touch...)
 * with Jack/Plug — pluggable the same way IRenderer is: `attach` wires up
 * whatever listeners this implementation needs against the given Cavi
 * instance (and, transitively, the live Jack/Plug registries), `detach`
 * tears them down. Jack/Plug themselves stay pure domain/data elements and
 * never assume any particular controller is attached — see
 * StandardInteractionController (src/interaction.ts) for the default
 * pointer/mouse/touch implementation, and <cavi-interaction>
 * (src/interactionwc.ts) for how it's wired up declaratively.
 */
export interface IInteractionController {
    attach: (cavi: Cavi) => void;
    detach: () => void;
}

/**
 * Contract for anything that keeps a <cavi-world>'s canvas backing store
 * sized to its container and announces layout changes — pluggable the same
 * way IInteractionController is: `attach` starts watching `container` (and
 * sizes `canvas` to match it), `detach` tears that down. See
 * StandardResizeController (src/resize.ts) for the default ResizeObserver
 * implementation, and CaviWorldElement (src/worldwc.ts) for how it's wired
 * up by default.
 */
export interface IResizeController {
    attach: (container: HTMLElement, canvas: HTMLCanvasElement) => void;
    detach: () => void;
}

export interface WireMeta {
    [key: string]: any;
    color?: string;
}

export { Node } from './node';
export { Wire } from './wire';
export { World } from './world';
export { Cavi } from './cavi';