import initSync, { type InitOutput } from 'cavi';

import type { IRenderer } from './types';
import { Wire } from './wire';
import { World } from './world';
import type { CoordinateTransform } from './coords';

/**
 * Cavi is the main class that provides a simple interface to use cavi in the browser.
 * It handles WASM initialization and provides a wrapper around the World simulation.
 */
export class Cavi {
  static wasm: InitOutput;
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
   * <cavi-world> (which bubbles to document), or of document for elements
   * outside any, so an element never binds to another world's instance
   * just because that one finished initializing first.
   */
  static whenReady(el: Element, fn: (cavi: Cavi) => void): void {
    const now = Cavi.for(el);
    if (now) {
      fn(now);
      return;
    }
    const target: EventTarget = el.closest('cavi-world') ?? document;
    target.addEventListener(
      'caviready',
      (e: Event) => fn(Cavi.for(el) ?? (e as CustomEvent<{ cavi: Cavi }>).detail.cavi),
      { once: true }
    );
  }

  private world: World;
  private wasm: InitOutput | null = null;
  /**
   * What happens to a brand-new cable (created by clicking an
   * empty/exposed Jack — see Jack.createCable/finishCableSession) when
   * it's released over empty space, with no compatible Jack underneath:
   * - 'dangle': the free end is left unfixed (falls/swings under physics)
   *   but the cable stays attached at its origin Jack.
   * - 'detach' (default): both ends are unfixed — the whole cable falls
   *   away disconnected. It is marked `auto-cleanup`, so it is deleted
   *   once it has drifted out of view instead of being simulated forever.
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
      Cavi._byContainer.set(value.getContainer(), this);
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
   * The container element the renderer was initialized with — the
   * "world bounds" used by CaviWireElement's auto-cleanup mechanism to
   * detect when a wire has drifted entirely off-screen.
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
   * zoom currently applied on screen. Call notifyCoordinateTransformChanged
   * after the transform changes (e.g. on every zoom event) so every
   * auto-positioned Jack re-syncs.
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
   * CustomEvent on getContainer() — every auto-positioned Jack listens for
   * this to re-measure and re-snap its plugs, since a pure CSS-transform
   * zoom/pan does not resize the container and therefore never fires a
   * ResizeObserver on its own.
   */
  public notifyCoordinateTransformChanged(): void {
    this.getContainer()?.dispatchEvent(new CustomEvent('cavi-transform-change'));
  }
}
