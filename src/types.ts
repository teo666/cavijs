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

export interface WireMeta {
    [key: string]: any;
    color?: string;
}

export { Node } from './node';
export { Wire } from './wire';
export { World } from './world';
export { Cavi } from './cavi';