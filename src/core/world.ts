import { WasmWorld } from 'cavi';
import { Wire } from './wire';
import type { IRenderer } from './types';
import { type CoordinateTransform, IDENTITY_TRANSFORM } from './coords';

/**
 * World is the main container for the cavi simulation.
 * It exposes all methods to interact with cables and global parameter configuration.
 */
export class World {
  private wasmWorld: WasmWorld;
  private wires: Wire[] = [];
  private _renderer: IRenderer | null = null;
  private _transformProvider: (() => CoordinateTransform) | null = null;

  constructor() {
    this.wasmWorld = new WasmWorld();
    this.wasmWorld.set_response_coef(0.0); // Set default response coefficient
  }

  /**
   * Get the underlying WASM World instance
   */
  public getWasmWorld(): WasmWorld {
    return this.wasmWorld;
  }

  /**
   * Add a new Wire to the world
   */
  public addWire(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    nodes: number,
    tension: number,
    radius: number,
    renderType: number = 1
  ): Wire {
    const wireIndex = this.wasmWorld.wire_count();
    this.wasmWorld.add_wire_with_count(x1, y1, x2, y2, nodes, tension, radius, renderType);
    const wire = new Wire(this.wasmWorld, wireIndex);
    this.wires.push(wire);
    return wire;
  }

  /**
   * Delete a Wire by its index
   */
  public deleteWire(index: number): void {
    if (index >= 0 && index < this.wires.length) {
      this.wasmWorld.delete_wire(index);
      const [removed] = this.wires.splice(index, 1);
      // Invalidate the deleted handle and shift every later one down in
      // place, so references held elsewhere stay valid (see Wire._setIndex).
      removed._setIndex(-1);
      for (let i = index; i < this.wires.length; i++) {
        this.wires[i]._setIndex(i);
      }
    }
  }

  /**
   * Clear all wires from the world
   */
  public clearAllWires(): void {
    // Delete wires in reverse order to avoid index shifting issues
    while (this.wires.length > 0) {
      this.deleteWire(this.wires.length - 1);
    }
  }

  /**
   * Set the global acceleration (gravity)
   */
  public setAcceleration(x: number, y: number): void {
    this.wasmWorld.set_acceleration(x, y);
  }

  /**
   * Get the global acceleration
   */
  public getAcceleration(): { x: number; y: number } {
    return {
      x: this.wasmWorld.get_acceleration_x(),
      y: this.wasmWorld.get_acceleration_y(),
    };
  }

  /**
   * Set the renderer class that will be used to render wires
   */
  public setRenderer(renderer: IRenderer): void {
    this._renderer = renderer;
  }

  /**
   * Get the current renderer
   */
  public getRenderer(): IRenderer | null {
    return this._renderer;
  }

  /**
   * See Cavi.setCoordinateTransformProvider. Lives on World (not Cavi) so a
   * renderer — which only ever holds its World — reads the transform of its
   * own simulation instead of whichever Cavi happens to be `Cavi.shared`.
   */
  public setCoordinateTransformProvider(fn: (() => CoordinateTransform) | null): void {
    this._transformProvider = fn;
  }

  /** The current screen<->world transform, IDENTITY_TRANSFORM if none was registered. */
  public getCoordinateTransform(): CoordinateTransform {
    return this._transformProvider?.() ?? IDENTITY_TRANSFORM;
  }

  /**
   * Get a wire by its index
   */
  public getWireByIndex(index: number): Wire | null {
    if (index >= 0 && index < this.wires.length) {
      return this.wires[index];
    }
    return null;
  }

  /**
   * Get all wires
   */
  public getWires(): Wire[] {
    return [...this.wires];
  }

  /**
   * Get the number of wires
   */
  public getWireCount(): number {
    return this.wires.length;
  }

  /**
   * Update the simulation
   */
  public update(): void {
    this.wasmWorld.update();
  }

  /**
   * Set mouse position for interaction
   */
  public setMouse(x: number, y: number): void {
    this.wasmWorld.set_mouse(x, y);
  }

  /**
   * Get wire data buffer pointer for rendering
   */
  public getWireDataPtr(): number {
    return this.wasmWorld.wire_data_ptr();
  }

  /**
   * Get wire data buffer length
   */
  public getWireDataLen(): number {
    return this.wasmWorld.wire_data_len();
  }

  /**
   * Set mouse interaction radius
   */
  public setMouseRadius(radius: number): void {
    this.wasmWorld.set_mouse_radius(radius);
  }

  /**
   * Get mouse interaction radius
   */
  public getMouseRadius(): number {
    return this.wasmWorld.get_mouse_radius();
  }

  /**
   * Set friction coefficient
   */
  public setFriction(friction: number): void {
    this.wasmWorld.set_friction(friction);
  }

  /**
   * Get friction coefficient
   */
  public getFriction(): number {
    return this.wasmWorld.get_friction();
  }
}
