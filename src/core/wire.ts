import type { WireMeta } from './types';
import type { WasmWorld } from 'cavi';
import { Node } from './node';

/**
 * Wire is the TypeScript wrapper for the WASM Wire class.
 * It contains methods to change properties like radius and tension,
 * and a meta dictionary that allows extending with render information.
 */
export class Wire {
  private meta: WireMeta = {};
  private world: WasmWorld | null = null;
  private wireIndex: number = -1;

  constructor(world?: WasmWorld, wireIndex?: number) {
    if (world !== undefined && wireIndex !== undefined) {
      this.world = world;
      this.wireIndex = wireIndex;
    }
  }

  /**
   * Add a node to the wire at the specified position
   */
  public addNode(x: number, y: number, fixed: boolean = false): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.add_wire_node(this.wireIndex, x, y, fixed);
    }
  }

  /**
   * Add a node at a specific index in the wire
   */
  public addNodeAt(index: number, x: number, y: number, fixed: boolean = false): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.add_wire_node_at(this.wireIndex, index, x, y, fixed);
    }
  }

  /**
   * Remove a node at the specified index
   */
  public removeNode(index: number): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.remove_wire_node(this.wireIndex, index);
    }
  }

  /**
   * Get the number of nodes in this wire
   */
  public getNodeCount(): number {
    if (this.world && this.wireIndex >= 0) {
      return this.world.get_wire_node_count(this.wireIndex);
    }
    return 0;
  }

  /**
   * Resize the wire to a new node count, redistributing intermediate nodes
   * evenly between the two terminal nodes (whose position/fixed state is
   * preserved). Any custom state on previously-existing intermediate nodes
   * is discarded — this rebuilds the node vector from scratch.
   */
  public setNodeCount(count: number): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.set_wire_node_count(this.wireIndex, count);
    }
  }

  /**
   * Get a node at a specific index
   */
  public getNode(index: number): Node | null {
    if (this.world && this.wireIndex >= 0) {
      const wasmNode = this.world.get_wire_node(this.wireIndex, index);
      if (wasmNode) {
        return new Node(
          wasmNode.get_x(),
          wasmNode.get_y(),
          wasmNode.is_fixed(),
          wasmNode,
          this.world,
          this.wireIndex,
          index
        );
      }
    }
    return null;
  }

  /**
   * Set custom metadata for the wire (e.g., render information)
   */
  public setMetaData(key: string, value: any): void {
    this.meta[key] = value;
  }

  /**
   * Get custom metadata from the wire
   */
  public getMetaData(key: string): any {
    return this.meta[key];
  }

  /**
   * Get all metadata
   */
  public getAllMetaData(): WireMeta {
    return { ...this.meta };
  }

  /**
   * Convenience method to set the render color
   */
  public setColor(color: string): void {
    this.meta.color = color;
  }

  /**
   * Get the render color
   */
  public getColor(): string | undefined {
    return this.meta.color;
  }

  /**
   * Change the radius of the wire
   */
  public setRadius(radius: number): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.set_wire_radius(this.wireIndex, radius);
    }
  }

  /**
   * Get the current radius of the wire
   */
  public getRadius(): number {
    if (this.world && this.wireIndex >= 0) {
      return this.world.get_wire_radius(this.wireIndex);
    }
    return 0;
  }

  /**
   * Get the wire index in the world
   */
  public getIndex(): number {
    return this.wireIndex;
  }
}
