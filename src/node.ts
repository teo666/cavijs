import type { WasmNode, WasmWorld } from "cavi";

/**
 * Node is the TypeScript wrapper for the WASM Node class.
 * Represents a single point in a wire with position, velocity, and fixed state.
 */
export class Node {
    private wasmNode: WasmNode | null = null;
    private world: WasmWorld | null = null;
    private wireIndex: number = -1;
    private nodeIndex: number = -1;
    private _x: number;
    private _y: number;
    private _fixed: boolean;

    constructor(
        x: number, 
        y: number, 
        fixed: boolean = false, 
        wasmNode?: WasmNode, 
        world?: WasmWorld, 
        wireIndex?: number, 
        nodeIndex?: number
    ) {
        this._x = x;
        this._y = y;
        this._fixed = fixed;
        if (wasmNode) {
            this.wasmNode = wasmNode;
        }
        if (world !== undefined && wireIndex !== undefined && nodeIndex !== undefined) {
            this.world = world;
            this.wireIndex = wireIndex;
            this.nodeIndex = nodeIndex;
        }
    }

    public get x(): number {
        if (this.world && this.wireIndex >= 0 && this.nodeIndex >= 0) {
            return this.world.get_wire_node_x(this.wireIndex, this.nodeIndex);
        }
        if (this.wasmNode) {
            return this.wasmNode.get_x();
        }
        return this._x;
    }

    public get y(): number {
        if (this.world && this.wireIndex >= 0 && this.nodeIndex >= 0) {
            return this.world.get_wire_node_y(this.wireIndex, this.nodeIndex);
        }
        if (this.wasmNode) {
            return this.wasmNode.get_y();
        }
        return this._y;
    }

    public get fixed(): boolean {
        if (this.wasmNode) {
            return this.wasmNode.get_fixed();
        }
        // Cannot easily get fixed state from world buffer if logic is complex, 
        // usually rely on cache or check if get_wire_node returns valid (but that's a copy).
        // Best effort: WasmWorld doesn't expose get_wire_node_fixed yet, 
        // so we might rely on the initial state or add that getter too.
        // For now, let's assume if we are using world accessor, we might still want to check the wasm node if we have one, 
        // BUT the wasm node is a copy. So relying on it for read is safer than write, but still might be stale.
        // Let's assume the user uses the setter correctly.
        return this._fixed;
    }

    public set fixed(value: boolean) {
        this._fixed = value;
        if (this.world && this.wireIndex >= 0 && this.nodeIndex >= 0) {
            this.world.set_wire_node_fixed(this.wireIndex, this.nodeIndex, value);
        } else if (this.wasmNode) {
            this.wasmNode.set_fixed(value);
        }
    }

    public setPosition(x: number, y: number): void {
        this._x = x;
        this._y = y;
        if (this.world && this.wireIndex >= 0 && this.nodeIndex >= 0) {
            this.world.set_wire_node_position(this.wireIndex, this.nodeIndex, x, y);
        } else if (this.wasmNode) {
            this.wasmNode.set_position(x, y);
        }
    }
}
