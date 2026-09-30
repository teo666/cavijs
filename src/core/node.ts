import type { WasmNode, WasmWorld } from 'cavi';
import type { Wire } from './wire';

/**
 * Node is the TypeScript wrapper for the WASM Node class.
 * Represents a single point in a wire with position, velocity, and fixed state.
 */
export class Node {
  private wasmNode: WasmNode | null = null;
  private world: WasmWorld | null = null;
  /**
   * The owning Wire, read live on every access rather than caching its
   * index: a sibling wire's deletion shifts this wire's WASM index (see
   * Wire._setIndex), and a cached copy would then silently read/write
   * another wire's node.
   */
  private wire: Wire | null = null;
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
    wire?: Wire,
    nodeIndex?: number
  ) {
    this._x = x;
    this._y = y;
    this._fixed = fixed;
    if (wasmNode) {
      this.wasmNode = wasmNode;
    }
    if (world !== undefined && wire !== undefined && nodeIndex !== undefined) {
      this.world = world;
      this.wire = wire;
      this.nodeIndex = nodeIndex;
    }
  }

  private get wireIndex(): number {
    return this.wire?.getIndex() ?? -1;
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
    if (this.world && this.wireIndex >= 0 && this.nodeIndex >= 0) {
      // WasmWorld has no direct fixed getter: read it off a temporary copy,
      // freed right away rather than left to the finalizer.
      const copy = this.world.get_wire_node(this.wireIndex, this.nodeIndex);
      if (copy) {
        const fixed = copy.get_fixed();
        copy.free();
        return fixed;
      }
    }
    if (this.wasmNode) {
      return this.wasmNode.get_fixed();
    }
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

  public setMousePosition(x: number, y: number) {
    this.world?.set_mouse(x, y);
  }
}
