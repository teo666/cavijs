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

    private world: World;
    private wasm: InitOutput | null = null;

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
}