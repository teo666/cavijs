import type { InitOutput } from 'cavi';
import { _setWasm, getWasm, initWasm } from './wasm';

import type { IRenderer } from './types';
import { Wire } from './wire';
import { World } from './world';
import { type CoordinateTransform, IDENTITY_TRANSFORM, clientToWorld } from './coords';

/**
 * Cavi is the main class that provides a simple interface to use cavi in the browser.
 * It handles WASM initialization and provides a wrapper around the World simulation.
 */
export class Cavi {
  /** The loaded WASM module — see initWasm/getWasm (src/core/wasm.ts). Throws before it loaded. */
  static get wasm(): InitOutput {
    return getWasm();
  }

  static set wasm(loaded: InitOutput) {
    _setWasm(loaded);
  }
  /**
   * The most recently created <cavi-world>'s Cavi (or whatever a manual
   * setup assigns here). Kept as a fallback for elements that live outside
   * any registered container — prefer Cavi.for(element).
   */
  static shared: Cavi | null = null;

  /** Renderer container -> the Cavi rendering it, filled by setRenderer. */
  private static readonly _byContainer = new WeakMap<Element, Cavi>();

  /**
   * The Cavi instance `el` belongs to: the one whose renderer container is
   * `el` or its nearest ancestor (crossing shadow roots). Lets several
   * worlds coexist on one page, each Jack/Plug/Wire talking to its own.
   * Returns null while `el` sits inside a <cavi-world> that hasn't finished
   * initializing, and falls back to Cavi.shared for elements outside any
   * registered container (single-world pages, tests).
   */
  static for(el: Element): Cavi | null {
    let insideWorld = false;
    for (let n: Element | null = el; n instanceof Element;) {
      const cavi = Cavi._byContainer.get(n);
      if (cavi) return cavi;
      if (n.tagName === 'CAVI-WORLD') insideWorld = true;
      const root = n.getRootNode();
      n = n.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return insideWorld ? null : Cavi.shared;
  }

  /**
   * Runs `fn` with `el`'s Cavi as soon as it exists — immediately if it
   * already does. Waits on the `caviready` of the nearest enclosing
   * <cavi-world> (found across shadow roots, like Cavi.for does), or of
   * document for elements outside any, so an element never binds to
   * another world's instance just because that one finished initializing
   * first.
   */
  static whenReady(el: Element, fn: (cavi: Cavi) => void): void {
    const now = Cavi.for(el);
    if (now) {
      fn(now);
      return;
    }
    // The enclosing world found the same way Cavi.for looks for its
    // container — across shadow roots, which Element.closest() doesn't.
    const world = Cavi._enclosingWorld(el);
    const target: EventTarget = world ?? document;
    const onReady = (e: Event): void => {
      // Inside a world: only that world's own caviready counts. Outside
      // any: the first world to get ready (Cavi.shared, as before).
      const cavi = Cavi.for(el) ?? (world ? null : (e as CustomEvent<{ cavi: Cavi }>).detail.cavi);
      if (!cavi) return;
      target.removeEventListener('caviready', onReady);
      fn(cavi);
    };
    target.addEventListener('caviready', onReady);
  }

  /**
   * Converts a viewport point (e.g. PointerEvent.clientX/clientY) into the
   * world coordinates of `el`'s world — the one conversion every Jack and
   * Plug position goes through.
   *
   * Anchored on the world's renderer container (<cavi-world>), never on an
   * element's own `offsetParent`: any `position: relative` wrapper between
   * the world and its jacks (a CSS-Grid panel, a draggable module box, a
   * card...) would otherwise become the jacks' offsetParent while plugs and
   * the canvas keep resolving against the container, and every jack in it
   * would report a position short by the wrapper's own offset. Outside any
   * world (tests, manual setups without a renderer): document.body and the
   * identity transform.
   */
  static clientToWorldOf(el: Element, clientX: number, clientY: number): { x: number; y: number } {
    const cavi = Cavi.for(el);
    return clientToWorld(
      clientX,
      clientY,
      cavi?.getContainer?.() ?? document.body,
      cavi?.getCoordinateTransform?.() ?? IDENTITY_TRANSFORM
    );
  }

  /** The nearest <cavi-world> enclosing `el` (itself included), crossing shadow roots. */
  private static _enclosingWorld(el: Element): Element | null {
    for (let n: Element | null = el; n instanceof Element;) {
      if (n.tagName === 'CAVI-WORLD') return n;
      const root = n.getRootNode();
      n = n.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    return null;
  }

  private world: World;
  /**
   * What happens to a brand-new cable (created by clicking an
   * empty/exposed Jack — see Jack.createCable/finishCableSession) when
   * it's released over empty space, with no compatible Jack underneath:
   * - 'dangle': the free end is left unfixed (falls/swings under physics)
   *   but the cable stays attached at its origin Jack.
   * - 'detach' (default): both ends are unfixed — the whole cable falls
   *   away disconnected. Being orphaned, it is deleted once it has drifted
   *   out of view (see `orphanCleanup`) instead of being simulated forever.
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
  /**
   * Whether orphaned cables — no terminal fixed: neither plugged into a
   * Jack, held by a drag, nor frozen in place (freeze-on-drop) — are
   * deleted once they have stayed entirely out of view for a moment (see
   * CaviWireElement._cleanupOrphanOutsideView). Applies to every cable,
   * however it was created. On by default: under gravity, an orphaned cable
   * that left the view is gone for good. Turn it off when out of view
   * doesn't mean lost — e.g. zero gravity with pan/zoom, where a dropped
   * cable just floats where it was left and the user may pan back to it.
   */
  private orphanCleanup: boolean = true;

  constructor() {
    this.world = new World();
  }

  /** Loads the WASM module, once per page — see initWasm (src/core/wasm.ts). */
  static initWasm(): Promise<void> {
    return initWasm().then(() => undefined);
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
   * Set the renderer — null for none. Registers its container for
   * Cavi.for, and unregisters (and stops) the previous renderer's.
   */
  public setRenderer(value: IRenderer | null): void {
    const previous = this.world.getRenderer();
    if (previous && previous !== value) this._unregisterContainer(previous);
    this.world.setRenderer(value);
    if (value) Cavi._byContainer.set(value.getContainer(), this);
  }

  /**
   * Tears this simulation down for good (see World.destroy): stops the
   * renderer, frees the WASM world, unregisters the container from
   * Cavi.for, and clears Cavi.shared if it points here — so elements no
   * longer find a dead world. <cavi-world> calls it when it is removed from
   * the page (not when it is just moved). Idempotent.
   */
  public destroy(): void {
    const renderer = this.world.getRenderer();
    if (renderer) this._unregisterContainer(renderer);
    this.world.destroy();
    if (Cavi.shared === this) Cavi.shared = null;
  }

  /** Whether destroy() was called. */
  public isDestroyed(): boolean {
    return this.world.isDestroyed();
  }

  private _unregisterContainer(renderer: IRenderer): void {
    const container = renderer.getContainer();
    if (Cavi._byContainer.get(container) === this) Cavi._byContainer.delete(container);
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
   * Delete a wire, by handle or by current index — see World.deleteWire
   */
  public deleteWire(wire: Wire | number): void {
    this.world.deleteWire(wire);
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
   * Runs exactly one physics step — see World.update. The render loop
   * steps the simulation itself (World.advance); calling this while it runs
   * adds extra steps.
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

  /** See World.releaseMouse. */
  public releaseMouse(): void {
    this.world.releaseMouse();
  }

  /** See World.setStepRate — physics steps per second, default 60. */
  public setStepRate(stepsPerSecond: number): void {
    this.world.setStepRate(stepsPerSecond);
  }

  /** Physics steps per second run by the render loop. */
  public getStepRate(): number {
    return this.world.getStepRate();
  }

  /** See World.setSleepEnabled — sleeping of still cables, on by default. */
  public setSleepEnabled(enabled: boolean): void {
    this.world.setSleepEnabled(enabled);
  }

  public getSleepEnabled(): boolean {
    return this.world.getSleepEnabled();
  }

  /** See World.setTimeStep — simulated time per engine sub-step, default 0.3. */
  public setTimeStep(timeStep: number): void {
    this.world.setTimeStep(timeStep);
  }

  public getTimeStep(): number {
    return this.world.getTimeStep();
  }

  /** See World.setSubsteps — engine sub-steps per step, default 2. */
  public setSubsteps(substeps: number): void {
    this.world.setSubsteps(substeps);
  }

  public getSubsteps(): number {
    return this.world.getSubsteps();
  }

  /** See World.setConstraintIterations — link relaxation passes per sub-step, default 1. */
  public setConstraintIterations(iterations: number): void {
    this.world.setConstraintIterations(iterations);
  }

  public getConstraintIterations(): number {
    return this.world.getConstraintIterations();
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
   * Toggles a soft cast shadow under every wire, on the configured
   * renderer. No-op for renderers that don't support it (e.g. SvgRenderer).
   */
  public setWireShadows(enabled: boolean): void {
    this.world.getRenderer()?.setWireShadows?.(enabled);
  }

  /**
   * Whether wire shadows are currently enabled.
   */
  public getWireShadows(): boolean {
    return this.world.getRenderer()?.getWireShadows?.() ?? false;
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
   * Sets whether orphaned cables are deleted once out of view — see the
   * `orphanCleanup` field above.
   */
  public setOrphanCleanup(enabled: boolean): void {
    this.orphanCleanup = enabled;
  }

  /**
   * Whether orphaned cables are deleted once out of view. Defaults to true.
   */
  public getOrphanCleanup(): boolean {
    return this.orphanCleanup;
  }

  /**
   * The container element the renderer was initialized with — the
   * "world bounds" used by CaviWireElement's orphan cleanup to detect when
   * a wire has drifted entirely off-screen.
   */
  public getContainer(): HTMLElement | null {
    return this.world.getRenderer()?.getContainer() ?? null;
  }

  /**
   * The element the renderer's drawing surface covers — getContainer()
   * unless the renderer was given a separate `surface` (RendererOptions).
   */
  public getSurface(): HTMLElement | null {
    const renderer = this.world.getRenderer();
    return renderer?.getSurface?.() ?? renderer?.getContainer() ?? null;
  }

  /**
   * Registers how to convert between screen and world coordinates when the
   * world container has a pan/zoom transform applied by the consuming app
   * (e.g. via d3-zoom) — cavijs never implements or auto-detects pan/zoom
   * itself (see src/core/coords.ts for why: it can't tell "the" zoom
   * transform apart from any other unrelated `transform` an author's CSS
   * happens to use). Pass null to go back to the identity transform (the
   * default — zero behavior change for a consumer who never calls this).
   *
   * Consulted by Jack.getWorldPosition() when a Jack has no explicit `x`/`y`
   * attributes, so an auto-detected position is converted back to a stable
   * logical space before reaching the physics engine, regardless of any
   * zoom currently applied on screen. The provider is read every frame:
   * auto-positioned Jacks re-measure themselves each frame (see
   * Jack._startFrameSync), so nothing else needs to be called when the
   * transform changes.
   */
  public setCoordinateTransformProvider(fn: (() => CoordinateTransform) | null): void {
    this.world.setCoordinateTransformProvider(fn);
  }

  /**
   * The current screen<->world coordinate transform — IDENTITY_TRANSFORM if
   * no provider was registered via setCoordinateTransformProvider.
   */
  public getCoordinateTransform(): CoordinateTransform {
    return this.world.getCoordinateTransform();
  }

  /**
   * Announces that the registered coordinate transform's value just changed
   * (e.g. a zoom/pan step) by dispatching a `cavi-transform-change`
   * CustomEvent on getContainer(), for page code that wants to react to it.
   * Optional: cavijs itself re-measures auto-positioned Jacks every frame
   * and no longer needs this call.
   */
  public notifyCoordinateTransformChanged(): void {
    this.getContainer()?.dispatchEvent(new CustomEvent('cavi-transform-change'));
  }
}
