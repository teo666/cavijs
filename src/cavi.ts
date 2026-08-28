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
     * What happens to a brand-new cable (created by clicking an
     * empty/exposed Jack — see Jack.createCable/finishCableSession) when
     * it's released over empty space, with no compatible Jack underneath:
     * - 'dangle': the free end is left unfixed (falls/swings under physics)
     *   but the cable stays attached at its origin Jack.
     * - 'detach' (default): both ends are unfixed — the whole cable falls
     *   away disconnected, but is not removed from the DOM.
     * - 'cancel': the in-progress <cavi-wire> is removed outright, as if it
     *   never existed.
     * Only applies to a brand-new cable-creation session — relocating an
     * existing two-ended cable's Plug and dropping it on empty space always
     * keeps the 'dangle' behavior (see Plug.endDrag/_settleDrag).
     */
    private cableDropBehavior: 'cancel' | 'dangle' | 'detach' = 'detach';
    /**
     * How a Jack's already-attached Plugs are spread out on hover (see
     * Jack's hover-spread mechanic) so each can be individually clicked to
     * relocate it, while the jack's own center becomes clickable again to
     * start a new cable:
     * - 'towardOther' (default): each Plug spreads toward its cable's far
     *   end, with pairwise angular collision avoidance so near-parallel
     *   cables never overlap.
     * - 'radial': Plugs are always evenly distributed around the Jack,
     *   ignoring cable direction.
     */
    private plugSpreadMode: 'towardOther' | 'radial' = 'towardOther';
    /**
     * How far Plugs spread from their Jack's center on hover, as a
     * multiplier of the Jack's own rendered half-size (so bigger jacks
     * spread their plugs further out).
     */
    private plugSpreadRadiusMultiplier: number = 1.8;
    /**
     * How long (ms) a Jack waits, after the pointer leaves its spread-out
     * hover area, before recompacting its Plugs back to its center. Resets
     * whenever the pointer re-enters the area before it fires.
     */
    private plugSpreadRecompactDelayMs: number = 500;

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
     * Sets what happens when a brand-new cable is dropped over empty space
     * — see the `cableDropBehavior` field above.
     */
    public setCableDropBehavior(behavior: 'cancel' | 'dangle' | 'detach'): void {
        this.cableDropBehavior = behavior;
    }

    /**
     * The current new-cable-drop behavior. Defaults to 'detach'.
     */
    public getCableDropBehavior(): 'cancel' | 'dangle' | 'detach' {
        return this.cableDropBehavior;
    }

    /**
     * Sets how a Jack's Plugs spread out on hover — see the
     * `plugSpreadMode` field above.
     */
    public setPlugSpreadMode(mode: 'towardOther' | 'radial'): void {
        this.plugSpreadMode = mode;
    }

    /**
     * The current plug-spread direction mode. Defaults to 'towardOther'.
     */
    public getPlugSpreadMode(): 'towardOther' | 'radial' {
        return this.plugSpreadMode;
    }

    /**
     * Sets the plug-spread radius multiplier — see the
     * `plugSpreadRadiusMultiplier` field above.
     */
    public setPlugSpreadRadiusMultiplier(multiplier: number): void {
        this.plugSpreadRadiusMultiplier = multiplier;
    }

    /**
     * The current plug-spread radius multiplier. Defaults to 1.8.
     */
    public getPlugSpreadRadiusMultiplier(): number {
        return this.plugSpreadRadiusMultiplier;
    }

    /**
     * Sets the plug-spread recompact delay (ms) — see the
     * `plugSpreadRecompactDelayMs` field above.
     */
    public setPlugSpreadRecompactDelayMs(delayMs: number): void {
        this.plugSpreadRecompactDelayMs = delayMs;
    }

    /**
     * The current plug-spread recompact delay (ms). Defaults to 500.
     */
    public getPlugSpreadRecompactDelayMs(): number {
        return this.plugSpreadRecompactDelayMs;
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