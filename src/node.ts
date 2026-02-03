import type { Node as WasmNode } from "cavi";

/**
 * Node is the TypeScript wrapper for the WASM Node class.
 * Represents a single point in a wire with position, velocity, and fixed state.
 */
export class Node {
    private wasmNode: WasmNode | null = null;
    private _x: number;
    private _y: number;
    private _fixed: boolean;

    constructor(x: number, y: number, fixed: boolean = false, wasmNode?: WasmNode) {
        this._x = x;
        this._y = y;
        this._fixed = fixed;
        if (wasmNode) {
            this.wasmNode = wasmNode;
        }
    }

    public get x(): number {
        if (this.wasmNode) {
            return this.wasmNode.get_x();
        }
        return this._x;
    }

    public get y(): number {
        if (this.wasmNode) {
            return this.wasmNode.get_y();
        }
        return this._y;
    }

    public get fixed(): boolean {
        if (this.wasmNode) {
            return this.wasmNode.get_fixed();
        }
        return this._fixed;
    }

    public set fixed(value: boolean) {
        this._fixed = value;
        if (this.wasmNode) {
            this.wasmNode.set_fixed(value);
        }
    }

    public setPosition(x: number, y: number): void {
        this._x = x;
        this._y = y;
        if (this.wasmNode) {
            this.wasmNode.set_position(x, y);
        }
    }
}
