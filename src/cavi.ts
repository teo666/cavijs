import initSync, { type InitOutput } from "cavi";

import type { IRenderer } from "./types";
import { Renderer } from "./renderer";
import { Wire } from "./wire";
import { World } from "./world";

/**
 * Cavi is the main class that provides a simple interface to use cavi in the browser.
 * It handles WASM initialization and provides a wrapper around the World simulation.
 */
export class Cavi {

    static wasm: InitOutput;
    static shared: Cavi | null = null;

    private world: World;
    private wasm: InitOutput | null = null;
    /**
     * How Plug/Jack interpret a pointer-driven drag: 'hold' (default) is
     * today's press-drag-release, gated by setPointerCapture; 'click' is
     * click-to-carry — a click detaches/creates and starts following the
     * cursor with no button held (so native scrolling, including trackpad
     * gestures, is never blocked), and a second click attaches to a jack
     * underneath or drops in place. Pure JS-side interaction state, not a
     * physics concept — never touches World/WASM. World-level rather than
     * per-element so it's one app-wide interaction choice, not something
     * that could vary jack-by-jack.
     */
    private dragMode: 'hold' | 'click' = 'hold';

    constructor() {
        this.world = new World();
    }
    
    /**
     * Initialize WASM module (static method)
     */
    static initWasm(): Promise<void> {
        return initSync().then((wasmModule: InitOutput) => {
            Cavi.wasm = wasmModule;
        });
    }

    /**
     * Get the World instance
     */
    public getWorld(): World {
        return this.world;
    }

    /**
     * Get the renderer
     */
    public getRenderer(): IRenderer | null {
        return this.world.getRenderer();
    }

    /**
     * Set the renderer
     */
    public setRenderer(value: IRenderer | null): void {
        if (value) {
            this.world.setRenderer(value);
        }
    }

    /**
     * Add a new Wire to the simulation
     */
    public addWire(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        nodes: number,
        tension: number,
        radius: number,
        type: number = 1
    ): Wire {
        return this.world.addWire(x1, y1, x2, y2, nodes, tension, radius, type);
    }

    /**
     * Delete a Wire by index
     */
    public deleteWire(index: number): void {
        this.world.deleteWire(index);
    }

    /**
     * Clear all wires from the simulation
     */
    public clearAllWires(): void {
        this.world.clearAllWires();
    }

    /**
     * Set global acceleration (gravity)
     */
    public setAcceleration(x: number, y: number): void {
        this.world.setAcceleration(x, y);
    }

    /**
     * Get global acceleration
     */
    public getAcceleration(): { x: number; y: number } {
        return this.world.getAcceleration();
    }

    /**
     * Get a wire by its index
     */
    public getWireByIndex(index: number): Wire | null {
        return this.world.getWireByIndex(index);
    }

    /**
     * Get all wires
     */
    public getWires(): Wire[] {
        return this.world.getWires();
    }

    /**
     * Update the simulation
     */
    public update(): void {
        this.world.update();
    }

    /**
     * Set mouse position for interaction
     */
    public setMouse(x: number, y: number): void {
        this.world.setMouse(x, y);
    }

    /**
     * Render using the configured renderer
     */
    public render(): void {
        const renderer = this.world.getRenderer();
        if (renderer) {
            renderer.render();
        }
    }

    /**
     * Toggles the debug overlay that draws the circumference of every
     * wire node, on the configured renderer. Global: affects every wire.
     */
    public setDebugDrawNodes(enabled: boolean): void {
        this.world.getRenderer()?.setDebugDrawNodes(enabled);
    }

    /**
     * Whether the debug node overlay is currently enabled.
     */
    public getDebugDrawNodes(): boolean {
        return this.world.getRenderer()?.getDebugDrawNodes() ?? false;
    }

    /**
     * Sets the pointer-drag interaction mode for every Plug/Jack — see the
     * `dragMode` field above. Applies to mouse/pen only: touch always uses
     * 'hold' (the natural press-and-drag-with-your-finger gesture already
     * works well there and has no scroll conflict to work around).
     */
    public setDragMode(mode: 'hold' | 'click'): void {
        this.dragMode = mode;
    }

    /**
     * The current pointer-drag interaction mode. Defaults to 'hold'.
     */
    public getDragMode(): 'hold' | 'click' {
        return this.dragMode;
    }

    /**
     * The container element the renderer was initialized with — the
     * "world bounds" used by CaviWireElement's auto-cleanup mechanism to
     * detect when a wire has drifted entirely off-screen.
     */
    public getContainer(): HTMLElement | null {
        return this.world.getRenderer()?.getContainer() ?? null;
    }
}