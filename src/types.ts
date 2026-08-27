import type { WasmWorld } from 'cavi';

export interface IRenderer {
    render: () => void;
    setDebugDrawNodes: (enabled: boolean) => void;
    getDebugDrawNodes: () => boolean;
    getContainer: () => HTMLElement;
    stop: () => void;
}

export interface WireMeta {
    [key: string]: any;
    color?: string;
}

export { Node } from './node';
export { Wire } from './wire';
export { World } from './world';
export { Cavi } from './cavi';