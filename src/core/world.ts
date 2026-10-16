import { WasmWorld } from 'cavi';
import { Wire } from './wire';
import type { IRenderer } from './types';
import { type CoordinateTransform, IDENTITY_TRANSFORM, clientToWorld } from './coords';
import type { FrameContext, FrameTask, WorldRect } from './frame';

/**
 * Where the engine's mouse is parked while no pointer hovers the world
 * (see releaseMouse): far enough that it never reaches a cable, finite so
 * the engine's distance math stays well-defined.
 */
const PARKED_MOUSE = -1e6;

/**
 * Colors given to new wires that get none of their own, in creation order
 * (see addWire).
 */
export const DEFAULT_WIRE_COLORS: readonly [string, ...string[]] = [
  '#00ff88',
  '#ff00ff',
  '#ffaa00',
];

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
  /** See addFrameTask. */
  private _frameTasks = new Set<FrameTask>();
  /** Wires created so far — picks each new wire's default color. */
  private _wiresCreated: number = 0;
  /** See destroy. */
  private _destroyed: boolean = false;

  constructor() {
    this.wasmWorld = new WasmWorld();
    this.wasmWorld.set_response_coef(0.0); // Set default response coefficient
    // The engine's mouse starts at (0, 0) and repels cables on every step:
    // keep it out of reach until a pointer actually hovers the world.
    this.releaseMouse();
  }

  /**
   * The underlying WASM world — for renderers (the zero-copy render buffer)
   * and engine parameters this class doesn't wrap. Add and remove wires
   * only through World (addWire/deleteWire) and nodes only through Wire:
   * World pairs its Wire handles with the engine's wires by position, so a
   * wire added or deleted on the WASM world directly would shift that
   * pairing — colors and metadata ending up on the wrong cables. addWire
   * and deleteWire detect it and throw (see _assertInSync).
   */
  public getWasmWorld(): WasmWorld {
    return this.wasmWorld;
  }

  /**
   * Throws if the engine's wire count no longer matches this World's own
   * list — wires were added or deleted on getWasmWorld() directly.
   */
  private _assertInSync(): void {
    const engine = this.wasmWorld.wire_count();
    if (engine !== this.wires.length) {
      throw new Error(
        `cavijs: the WASM world has ${engine} wires but World knows ${this.wires.length}: ` +
          `wires were added or deleted on getWasmWorld() directly. Use World.addWire/deleteWire.`
      );
    }
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
    this._assertInSync();
    const wireIndex = this.wires.length;
    this.wasmWorld.add_wire_with_count(x1, y1, x2, y2, nodes, tension, radius, renderType);
    const wire = new Wire(this.wasmWorld, wireIndex, this);
    // A default color of its own, fixed at creation: picked by position at
    // draw time instead, every later wire changed color when one was deleted.
    // Callers with a color of their own (<cavi-wire>) just overwrite it.
    wire.setColor(DEFAULT_WIRE_COLORS[this._wiresCreated++ % DEFAULT_WIRE_COLORS.length]!);
    this.wires.push(wire);
    return wire;
  }

  /**
   * Delete a wire — by handle (preferred: indices shift as wires are
   * deleted) or by its current index. No-op for a wire already deleted, or
   * of another world.
   */
  public deleteWire(wire: Wire | number): void {
    const index = typeof wire === 'number' ? wire : this.wires.indexOf(wire);
    if (index >= 0 && index < this.wires.length) {
      this._assertInSync();
      this.wasmWorld.delete_wire(index);
      const [removed] = this.wires.splice(index, 1);
      // Invalidate the deleted handle and shift every later one down in
      // place, so references held elsewhere stay valid (see Wire._setIndex).
      removed!._setIndex(-1);
      for (let i = index; i < this.wires.length; i++) {
        this.wires[i]!._setIndex(i);
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
   * Set the renderer that draws this world — null for none. A previous,
   * different renderer is stopped first: two render loops would both step
   * the physics, running it at twice the speed.
   */
  public setRenderer(renderer: IRenderer | null): void {
    if (this._renderer && this._renderer !== renderer) this._renderer.stop();
    this._renderer = renderer;
  }

  /**
   * Tears this world down for good: stops its renderer, drops its frame
   * tasks, invalidates every Wire handle (and through them every Node
   * handle, which then turn into no-ops instead of touching freed memory),
   * and frees the WASM world. WASM memory never shrinks, but what is freed
   * is reused by the next world. Idempotent; the world must not be used
   * afterwards. Usually called through Cavi.destroy.
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._renderer?.stop();
    this._renderer = null;
    this._frameTasks.clear();
    for (const wire of this.wires) wire._setIndex(-1);
    this.wires = [];
    this.wasmWorld.free();
  }

  /** Whether destroy() was called. */
  public isDestroyed(): boolean {
    return this._destroyed;
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
    return this.wires[index] ?? null;
  }

  /**
   * Get all wires — a copy, safe to keep and modify.
   */
  public getWires(): Wire[] {
    return [...this.wires];
  }

  /**
   * All wires without copying them — the live list, for code that reads it
   * every frame (renderers). Don't keep it across frames or modify it: it
   * changes as wires are added and deleted.
   */
  public getWiresView(): readonly Wire[] {
    return this.wires;
  }

  /**
   * Get the number of wires
   */
  public getWireCount(): number {
    return this.wires.length;
  }

  /**
   * Runs exactly one physics step and rebuilds the render buffer for the
   * resulting state. The engine's step has a fixed time delta, so how fast
   * the simulation runs depends on how often this is called — renderers
   * call advance() instead, which turns real elapsed time into a steady
   * number of steps.
   */
  public update(): void {
    this.wasmWorld.update();
  }

  /**
   * Advances the simulation by `elapsedMs` of real time, at a fixed rate of
   * getStepRate() steps per second whatever the display's frame rate: a
   * 120 Hz screen runs a step every other frame, a 30 Hz one two per frame,
   * so cables fall and swing at the same speed everywhere. Returns how many
   * steps ran. Gaps longer than MAX_ELAPSED_MS (background tab) are not
   * replayed, and at most MAX_STEPS_PER_ADVANCE steps run per call.
   *
   * Then rebuilds the render buffer on every call, steps or not, with the
   * cables drawn as far between the last two steps as the time left over in
   * the accumulator (WasmWorld.build_render_data): a display faster than
   * the step rate draws a new, interpolated position on every frame instead
   * of repeating the last step's, and the buffer always matches the current
   * wires even right after one was added or deleted. Drawing trails the
   * simulation by at most one step.
   */
  public advance(elapsedMs: number): number {
    const stepMs = 1000 / this._stepRate;
    this._accumulatorMs += Math.min(Math.max(elapsedMs, 0), MAX_ELAPSED_MS);

    let steps = Math.floor((this._accumulatorMs + STEP_TOLERANCE_MS) / stepMs);
    if (steps > MAX_STEPS_PER_ADVANCE) {
      steps = MAX_STEPS_PER_ADVANCE;
      this._accumulatorMs = 0;
    } else {
      this._accumulatorMs -= steps * stepMs;
    }

    for (let i = 0; i < steps; i++) this.wasmWorld.step();
    this.wasmWorld.build_render_data(Math.min(Math.max(this._accumulatorMs / stepMs, 0), 1));
    return steps;
  }

  /**
   * Marks `wire` as held by the user — one of its ends is being dragged,
   * or it is being pulled out of a jack. While held, the mouse (which sits
   * on the dragged end) no longer pushes that wire's own nodes away, and
   * pushes the other wires within the pointer radius (setPointerRadius)
   * instead of the mouse radius. See WasmWorld.set_held_wire.
   */
  public holdWire(wire: Wire): void {
    const index = wire.getIndex();
    if (index >= 0) this.wasmWorld.set_held_wire(index);
  }

  /**
   * Ends a hold. With `wire`, only if that is the held wire — so the end of
   * one gesture never releases another gesture's wire.
   */
  public releaseHeldWire(wire?: Wire): void {
    const held = this.wasmWorld.get_held_wire();
    if (held === undefined) return;
    if (wire && wire.getIndex() !== held) return;
    this.wasmWorld.release_held_wire();
  }

  /** The wire currently held, if any. */
  public getHeldWire(): Wire | null {
    const held = this.wasmWorld.get_held_wire();
    return held === undefined ? null : (this.wires[held] ?? null);
  }

  /** Radius within which the held point pushes the other wires (default 20) — see holdWire. */
  public setPointerRadius(radius: number): void {
    this.wasmWorld.set_pointer_radius(radius);
  }

  public getPointerRadius(): number {
    return this.wasmWorld.get_pointer_radius();
  }

  /**
   * Whether still wires are put to sleep (default true): a wire whose nodes
   * all moved less than getSleepThreshold() in each of getSleepSteps()
   * steps in a row is skipped by the simulation until something can move
   * it again — the mouse coming near, a node moved, fixed or released, a
   * changed parameter. Saves CPU with many cables at rest. See
   * WasmWorld.set_sleep_enabled.
   */
  public setSleepEnabled(enabled: boolean): void {
    this.wasmWorld.set_sleep_enabled(enabled);
  }

  public getSleepEnabled(): boolean {
    return this.wasmWorld.get_sleep_enabled();
  }

  /** Largest movement of a node in a step that still counts as still (default 0.01). */
  public setSleepThreshold(threshold: number): void {
    this.wasmWorld.set_sleep_threshold(threshold);
  }

  public getSleepThreshold(): number {
    return this.wasmWorld.get_sleep_threshold();
  }

  /** Still steps in a row before a wire sleeps (default 30, half a second at 60 steps/s). */
  public setSleepSteps(steps: number): void {
    this.wasmWorld.set_sleep_steps(Math.max(1, Math.round(steps)));
  }

  public getSleepSteps(): number {
    return this.wasmWorld.get_sleep_steps();
  }

  /** How many wires are asleep right now. */
  public getSleepingWireCount(): number {
    return this.wasmWorld.sleeping_wire_count();
  }

  /**
   * Simulated time covered by one engine sub-step (default 0.3). Together
   * with setStepRate and setSubsteps it sets how fast the simulation runs;
   * larger values are faster but less stable.
   */
  public setTimeStep(timeStep: number): void {
    this.wasmWorld.set_time_step(timeStep);
  }

  public getTimeStep(): number {
    return this.wasmWorld.get_time_step();
  }

  /**
   * Engine sub-steps per step (default 2). Each advances time by
   * getTimeStep(), so this changes speed as well as accuracy — for stiffer
   * cables at the same speed, use setConstraintIterations.
   */
  public setSubsteps(substeps: number): void {
    this.wasmWorld.set_substeps(Math.max(1, Math.round(substeps)));
  }

  public getSubsteps(): number {
    return this.wasmWorld.get_substeps();
  }

  /**
   * Link relaxation passes per sub-step (default 1): more make cables
   * stiffer (less stretch), at no change in speed and a small CPU cost.
   */
  public setConstraintIterations(iterations: number): void {
    this.wasmWorld.set_constraint_iterations(Math.max(1, Math.round(iterations)));
  }

  public getConstraintIterations(): number {
    return this.wasmWorld.get_constraint_iterations();
  }

  /**
   * Registers per-frame DOM work for this world (see FrameTask) — e.g. a
   * <cavi-wire> keeping its plugs on the cable, an auto-positioned Jack
   * following the layout. Returns a function that unregisters it.
   */
  public addFrameTask(task: FrameTask): () => void {
    this._frameTasks.add(task);
    return () => {
      this._frameTasks.delete(task);
    };
  }

  /**
   * Runs every registered FrameTask: all `read`s, then all `write`s.
   * Called once per frame by the renderer, right after advance() — a
   * custom IRenderer driving its own loop should do the same.
   */
  public runFrameTasks(): void {
    if (this._frameTasks.size === 0) return;
    // A snapshot: a task may unregister itself (or another) while running.
    const tasks = [...this._frameTasks];
    // Measured on first access only, then shared by every task.
    let viewBounds: WorldRect[] | null = null;
    const measure = () => (viewBounds ??= this._measureViewBounds());
    const ctx: FrameContext = {
      get viewBounds() {
        return measure();
      },
    };
    for (const task of tasks) task.read?.(ctx);
    for (const task of tasks) {
      if (this._frameTasks.has(task)) task.write?.(ctx);
    }
  }

  /** FrameContext.viewBounds: the renderer's container and surface boxes, in world coordinates. */
  private _measureViewBounds(): WorldRect[] {
    const renderer = this._renderer;
    if (!renderer) return [];
    const container = renderer.getContainer();
    const surface = renderer.getSurface?.() ?? container;
    const transform = this.getCoordinateTransform();
    const elements = surface === container ? [container] : [container, surface];
    return elements.map((el) => {
      const rect = el.getBoundingClientRect();
      const topLeft = clientToWorld(rect.left, rect.top, container, transform);
      const bottomRight = clientToWorld(rect.right, rect.bottom, container, transform);
      return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
    });
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
