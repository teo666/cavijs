import { WasmWorld } from 'cavi';
import { Wire } from './wire';
import type { IRenderer } from './types';
import { type CoordinateTransform, IDENTITY_TRANSFORM } from './coords';

/**
 * Where the engine's mouse is parked while no pointer hovers the world
 * (see releaseMouse): far enough that it never reaches a cable, finite so
 * the engine's distance math stays well-defined.
 */
const PARKED_MOUSE = -1e6;

/** Default physics rate of advance(), in steps per second. */
const DEFAULT_STEP_RATE = 60;
/**
 * advance() runs a step as soon as the accumulated time is within this
 * many ms of a full step, so the natural jitter of frame timestamps (a
 * 60 Hz frame measuring 16.5ms instead of 16.67ms) doesn't alternate 0 and
 * 2 steps per frame on a display that matches the step rate.
 */
const STEP_TOLERANCE_MS = 2;
/**
 * Longest elapsed time one advance() call accounts for: a tab that was in
 * the background, or a debugger pause, resumes with a huge gap that must
 * not be replayed as a burst of steps.
 */
const MAX_ELAPSED_MS = 100;
/** Most steps one advance() call runs; anything beyond is dropped (slow device). */
const MAX_STEPS_PER_ADVANCE = 4;

/**
 * World is the main container for the cavi simulation.
 * It exposes all methods to interact with cables and global parameter configuration.
 */
export class World {
  private wasmWorld: WasmWorld;
  private wires: Wire[] = [];
  private _renderer: IRenderer | null = null;
  private _transformProvider: (() => CoordinateTransform) | null = null;
  private _stepRate: number = DEFAULT_STEP_RATE;
  /** Simulated time owed by advance(), in ms — may dip slightly below 0 (see STEP_TOLERANCE_MS). */
  private _accumulatorMs: number = 0;
  /**
   * Set when a wire was added or deleted since the last step. The render
   * buffer (wire_data_ptr) is only rebuilt by a step, and renderers walk it
   * using the current wire count — so advance() never lets a frame go by
   * without a step while the two disagree.
   */
  private _wiresChanged: boolean = false;

  constructor() {
    this.wasmWorld = new WasmWorld();
    this.wasmWorld.set_response_coef(0.0); // Set default response coefficient
    // The engine's mouse starts at (0, 0) and repels cables on every step:
    // keep it out of reach until a pointer actually hovers the world.
    this.releaseMouse();
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
    this._wiresChanged = true;
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
      this._wiresChanged = true;
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
   * Runs exactly one physics step (and rebuilds the render buffer). The
   * engine's step has a fixed time delta, so how fast the simulation runs
   * depends on how often this is called — renderers call advance() instead,
   * which turns real elapsed time into a steady number of steps.
   */
  public update(): void {
    this.wasmWorld.update();
    this._wiresChanged = false;
  }

  /**
   * Advances the simulation by `elapsedMs` of real time, at a fixed rate of
   * getStepRate() steps per second whatever the display's frame rate: a
   * 120 Hz screen runs a step every other frame, a 30 Hz one two per frame,
   * so cables fall and swing at the same speed everywhere. Returns how many
   * steps ran. Gaps longer than MAX_ELAPSED_MS (background tab) are not
   * replayed, and at most MAX_STEPS_PER_ADVANCE steps run per call.
   */
  public advance(elapsedMs: number): number {
    const stepMs = 1000 / this._stepRate;
    this._accumulatorMs += Math.min(Math.max(elapsedMs, 0), MAX_ELAPSED_MS);

    let steps = Math.floor((this._accumulatorMs + STEP_TOLERANCE_MS) / stepMs);
    if (steps === 0 && this._wiresChanged) {
      // Borrowed from the next frame's time, so the long-run rate holds.
      steps = 1;
    }
    if (steps > MAX_STEPS_PER_ADVANCE) {
      steps = MAX_STEPS_PER_ADVANCE;
      this._accumulatorMs = 0;
    } else {
      this._accumulatorMs -= steps * stepMs;
    }

    for (let i = 0; i < steps; i++) this.update();
    return steps;
  }

  /**
   * Sets how many physics steps advance() runs per second of real time.
   * Default 60. Higher is faster *and* smoother motion; it does not change
   * the step itself (the engine's time delta is fixed).
   */
  public setStepRate(stepsPerSecond: number): void {
    if (Number.isFinite(stepsPerSecond) && stepsPerSecond > 0) {
      this._stepRate = stepsPerSecond;
    }
  }

  /** Physics steps per second run by advance(). */
  public getStepRate(): number {
    return this._stepRate;
  }

  /**
   * Set mouse position for interaction
   */
  public setMouse(x: number, y: number): void {
    this.wasmWorld.set_mouse(x, y);
  }

  /**
   * Moves the engine's mouse out of reach, so it stops repelling cables —
   * for when no pointer hovers the world (see PointerTracker).
   */
  public releaseMouse(): void {
    this.wasmWorld.set_mouse(PARKED_MOUSE, PARKED_MOUSE);
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
