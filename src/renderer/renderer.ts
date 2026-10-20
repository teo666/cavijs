import type { WasmWorld } from 'cavi';
import type { IRenderer, RendererOptions } from '../core/types';
import { DEFAULT_WIRE_COLORS, type World } from '../core/world';
import { forEachWireRender, tracePath } from '../core/render-data';
import { containerOrigin } from '../core/coords';
import { sizeCanvasToHost } from './resize';
import { PointerTracker } from './pointer';

/**
 * Resolution of the shadow layers relative to the canvas backing store
 * (per axis): the shadow is blurred on 1/16 of the pixels, then scaled up.
 */
const SHADOW_LAYER_SCALE = 0.25;

interface ShadowLayers {
  /** Every wire stroked unblurred in solid black. */
  strokeCanvas: HTMLCanvasElement;
  strokeCtx: CanvasRenderingContext2D;
  /** strokeCanvas's shadow, blurred once. */
  blurCanvas: HTMLCanvasElement;
  blurCtx: CanvasRenderingContext2D;
}

export class Renderer implements IRenderer {
  private container: HTMLElement;
  /** See RendererOptions.surface — null means the canvas lives in `container`. */
  private surface: HTMLElement | null;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private world: World;
  private lastTime = performance.now();
  private fpsFrameCount = 0;
  private fps = 0;
  private wasmWorld: WasmWorld;
  /** Feeds the engine's mouse from the page's pointer (see PointerTracker). */
  private pointer: PointerTracker;
  /** performance.now() of the previous frame, null before the first one — see frame(). */
  private lastFrameTime: number | null = null;
  private debugDrawNodes: boolean = false;
  private rafId: number | null = null;
  private running: boolean = false;
  /** See setWireShadows. */
  private wireShadows: boolean = false;
  /** Offscreen layers of the shadow pass, created on first use (see drawWireShadows). */
  private shadowLayers: ShadowLayers | null = null;
  /** World -> backing-store pixel transform applied by the last applyViewTransform. */
  private viewScale: number = 1;
  private viewOffsetX: number = 0;
  private viewOffsetY: number = 0;

  /**
   * Uses `options.canvas` — any canvas, anywhere on the page — else the
   * `#wireCanvas` found in the host (the surface if given, else
   * `container`), creating one there if there is none. The canvas is kept
   * sized to the host (see sizeCanvasToHost), and its on-screen placement
   * is measured every frame (see applyViewTransform), so where it sits and
   * how it is stacked (e.g. a z-index above the jacks) is up to the page.
   */
  constructor(
    container: HTMLElement,
    world: World,
    options: RendererOptions & { canvas?: HTMLCanvasElement } = {}
  ) {
    this.container = container;
    this.surface = options.surface ?? null;
    const host = this.surface ?? container;

    let canvas =
      options.canvas ??
      (this.surface
        ? host.querySelector<HTMLCanvasElement>(':scope > #wireCanvas')
        : host.querySelector<HTMLCanvasElement>('#wireCanvas'));
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wireCanvas';
      canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      host.insertBefore(canvas, host.firstChild);
      sizeCanvasToHost(canvas, host);
    }
    this.canvas = canvas;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to get 2D context');
    }
    this.context = context;

    this.world = world;
    this.wasmWorld = world.getWasmWorld();
    this.pointer = new PointerTracker(world, container, () => this.canvas);
  }

  // Last pointer position, in world coordinates. Public: <cavi-debug> (and
  // the examples' <cavi-controls>) read them duck-typed off the active renderer (same as
  // SvgRenderer).
  public get mouseX(): number {
    return this.pointer.x;
  }

  public get mouseY(): number {
    return this.pointer.y;
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public getSurface(): HTMLElement {
    return this.surface ?? this.container;
  }

  public clear() {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Get current FPS
   */
  public getFPS(): number {
    return this.fps;
  }

  /**
   * Toggles the debug overlay that draws the circumference of every wire
   * node (its actual physics position, not just the rendered path).
   */
  public setDebugDrawNodes(enabled: boolean): void {
    this.debugDrawNodes = enabled;
  }

  public getDebugDrawNodes(): boolean {
    return this.debugDrawNodes;
  }

  /**
   * Toggles a soft cast shadow under every wire (see drawWireShadows).
   * Off by default: it costs one extra blur per frame, on a low-resolution layer.
   */
  public setWireShadows(enabled: boolean): void {
    this.wireShadows = enabled;
    if (!enabled) {
      // Release the layers' backing stores rather than keep them around
      // for a feature that is off.
      this.shadowLayers = null;
    }
  }

  public getWireShadows(): boolean {
    return this.wireShadows;
  }

  private drawNodeDebug() {
    const wires = this.world.getWiresView();

    this.context.strokeStyle = '#00ffff'; // Cyan
    this.context.lineWidth = 1;

    // Read straight from WASM rather than through Wire.getNode(), which
    // would allocate a wrapper per node per frame.
    for (const wire of wires) {
      const wireIndex = wire.getIndex();
      const radius = wire.getRadius();
      const nodeCount = wire.getNodeCount();

      for (let i = 0; i < nodeCount; i++) {
        this.context.beginPath();
        this.context.arc(
          this.wasmWorld.get_wire_node_x(wireIndex, i),
          this.wasmWorld.get_wire_node_y(wireIndex, i),
          radius,
          0,
          Math.PI * 2
        );
        this.context.stroke();
      }
    }
  }

  /** Draws the mouse/pointer interaction radii around (mouseX, mouseY), in world coordinates. */
  public drawInteractionRadii(mouseX: number, mouseY: number) {
    if (!this.pointer.inside) return;
    const mouseRadius = this.wasmWorld.get_mouse_radius();
    const pointerRadius = this.wasmWorld.get_pointer_radius();

    // Draw pointer radius (inner circle)
    this.context.beginPath();
    this.context.arc(mouseX, mouseY, pointerRadius, 0, Math.PI * 2);
    this.context.strokeStyle = '#ffff00'; // Yellow
    this.context.lineWidth = 2;
    this.context.setLineDash([5, 5]);
    this.context.stroke();
    this.context.setLineDash([]);

    // Draw mouse radius (outer circle)
    this.context.beginPath();
    this.context.arc(mouseX, mouseY, mouseRadius, 0, Math.PI * 2);
    this.context.strokeStyle = '#ff00ff'; // Magenta
    this.context.lineWidth = 2;
    this.context.setLineDash([5, 5]);
    this.context.stroke();
    this.context.setLineDash([]);

    // Draw center point
    this.context.beginPath();
    this.context.arc(mouseX, mouseY, 3, 0, Math.PI * 2);
    this.context.fillStyle = '#ffffff';
    this.context.fill();

    // Draw labels
    this.context.font = '12px monospace';
    this.context.fillStyle = '#ffffff';
    this.context.strokeStyle = '#000000';
    this.context.lineWidth = 3;

    // Pointer radius label
    const pointerLabelX = mouseX + pointerRadius * 0.7;
    const pointerLabelY = mouseY - pointerRadius * 0.7;
    this.context.strokeText(`pointer: ${pointerRadius.toFixed(1)}`, pointerLabelX, pointerLabelY);
    this.context.fillText(`pointer: ${pointerRadius.toFixed(1)}`, pointerLabelX, pointerLabelY);

    // Mouse radius label
    const mouseLabelX = mouseX + mouseRadius * 0.7;
    const mouseLabelY = mouseY - mouseRadius * 0.7;
    this.context.strokeText(`mouse: ${mouseRadius.toFixed(1)}`, mouseLabelX, mouseLabelY);
    this.context.fillText(`mouse: ${mouseRadius.toFixed(1)}`, mouseLabelX, mouseLabelY);
  }

  /**
   * Builds each wire's path into `ctx` straight from WASM memory (zero
   * copy), calling `visit` once per drawable wire with its path ready to
   * stroke. Shared by the shadow pass and the base color pass, so both
   * trace exactly the same geometry.
   */
  private traceWires(
    ctx: CanvasRenderingContext2D,
    visit: (wireIdx: number, radius: number) => void
  ): void {
    forEachWireRender(this.world, ({ index, radius, renderType, path }) => {
      ctx.beginPath();
      if (tracePath(ctx, path, renderType)) visit(index, radius);
    });
  }

  /**
   * The two offscreen layers of the shadow pass (see drawWireShadows), kept
   * at SHADOW_LAYER_SCALE of the visible canvas's backing size. Null if a
   * 2D context is unavailable.
   */
  private getShadowLayers(): ShadowLayers | null {
    if (!this.shadowLayers) {
      const strokeCanvas = document.createElement('canvas');
      const blurCanvas = document.createElement('canvas');
      const strokeCtx = strokeCanvas.getContext('2d');
      const blurCtx = blurCanvas.getContext('2d');
      if (!strokeCtx || !blurCtx) return null;
      this.shadowLayers = { strokeCanvas, strokeCtx, blurCanvas, blurCtx };
    }
    const width = Math.max(1, Math.ceil(this.canvas.width * SHADOW_LAYER_SCALE));
    const height = Math.max(1, Math.ceil(this.canvas.height * SHADOW_LAYER_SCALE));
    // Only reassign on change: setting width/height clears and reallocates.
    for (const layer of [this.shadowLayers.strokeCanvas, this.shadowLayers.blurCanvas]) {
      if (layer.width !== width) layer.width = width;
      if (layer.height !== height) layer.height = height;
    }
    return this.shadowLayers;
  }

  /**
   * Soft cast shadow under every wire, for a single blur per frame no
   * matter how many wires there are. A canvas shadow on each wire's own
   * stroke() runs one blur per wire — the dominant cost of the frame as
   * soon as there are more than a handful. Instead:
   *
   * 1. every wire is stroked, unblurred and in solid black, into a stroke
   *    layer at SHADOW_LAYER_SCALE of the canvas resolution;
   * 2. that layer is blurred once into a blur layer of the same size —
   *    drawn fully off-canvas, with the shadow offset bringing only its
   *    blurred shadow back into view (unlike ctx.filter, shadowBlur on
   *    drawImage works in every browser);
   * 3. the blur layer is scaled back up onto the canvas.
   *
   * The low resolution is what keeps the blur cheap — it runs on 1/16 of
   * the pixels — and is invisible in a shadow this soft.
   *
   * Blur and offset follow the thickest wire (radius * 2 and radius * 0.6,
   * in world units), so thinner wires get a slightly wider shadow than a
   * per-wire shadow would give them.
   */
  private drawWireShadows(): void {
    const layers = this.getShadowLayers();
    if (!layers) return;
    const { strokeCanvas, strokeCtx, blurCanvas, blurCtx } = layers;
    const { width, height } = strokeCanvas;

    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.clearRect(0, 0, width, height);
    // The canvas's view transform, shrunk to the layer's resolution.
    const k = SHADOW_LAYER_SCALE;
    const scale = this.viewScale * k;
    strokeCtx.setTransform(scale, 0, 0, scale, this.viewOffsetX * k, this.viewOffsetY * k);
    strokeCtx.strokeStyle = '#000';
    strokeCtx.lineCap = 'round';
    strokeCtx.lineJoin = 'round';

    let maxRadius = 0;
    this.traceWires(strokeCtx, (_wireIdx, radius) => {
      strokeCtx.lineWidth = radius * 2;
      strokeCtx.stroke();
      if (radius > maxRadius) maxRadius = radius;
    });
    if (maxRadius === 0) return;

    // shadowBlur/shadowOffset ignore the canvas transform (they are in
    // layer pixels), so scale them to stay constant in world units across
    // zoom and devicePixelRatio.
    blurCtx.clearRect(0, 0, width, height);
    blurCtx.shadowColor = 'rgb(0, 0, 0)';
    blurCtx.shadowBlur = maxRadius * 2 * scale;
    blurCtx.shadowOffsetX = width;
    blurCtx.shadowOffsetY = maxRadius * 0.6 * scale;
    blurCtx.drawImage(strokeCanvas, -width, 0);

    const ctx = this.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(blurCanvas, 0, 0, width / k, height / k);
    ctx.restore();
  }

  private drawAllWires() {
    const wires = this.world.getWiresView();
    const ctx = this.context;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    this.traceWires(ctx, (wireIdx, radius) => {
      // Every wire gets a color at creation (World.addWire); the fallback
      // only covers one explicitly cleared.
      const wireColor = wires[wireIdx]?.getColor() || DEFAULT_WIRE_COLORS[0];

      ctx.lineWidth = radius * 2;
      ctx.strokeStyle = wireColor;
      ctx.stroke();
    });
  }

  /**
   * The canvas transform mapping world coordinates to backing-store pixels,
   * derived from where the canvas actually is on screen, so it works for
   * any placement: inside the (possibly CSS-zoomed) container, on an
   * untransformed surface, or anywhere else on the page (options.canvas).
   *
   *   world -> client:  client = world * k + origin   (registered zoom k,
   *                     origin = the container's on-screen world origin)
   *   client -> canvas: css = (client - canvasLeft) / c   (c = the canvas's
   *                     own on-screen scale: k inside the zoomed container,
   *                     1 on an untransformed surface)
   *   canvas -> pixels: * dpr (backing store / CSS size)
   *
   * For the default canvas at the container's top-left this reduces to a
   * plain devicePixelRatio scale, exactly as before.
   */
  private applyViewTransform(): void {
    const cssWidth = this.canvas.clientWidth;
    const dpr = cssWidth > 0 ? this.canvas.width / cssWidth : 1;
    const rect = this.canvas.getBoundingClientRect();
    const c = this.canvas.offsetWidth > 0 ? rect.width / this.canvas.offsetWidth || 1 : 1;
    // Content-box origin: skip the canvas's own border, if any.
    const left = rect.left + this.canvas.clientLeft * c;
    const top = rect.top + this.canvas.clientTop * c;

    const t = this.world.getCoordinateTransform();
    const origin = containerOrigin(this.container, t.scale);
    const scale = (dpr * t.scale) / c;
    this.viewScale = scale;
    this.viewOffsetX = (dpr * (origin.x - left)) / c;
    this.viewOffsetY = (dpr * (origin.y - top)) / c;
    this.context.setTransform(scale, 0, 0, scale, this.viewOffsetX, this.viewOffsetY);
  }

  private frame = (): void => {
    if (!this.running) return;
    const currentTime = performance.now();

    // Update FPS counter every second
    this.fpsFrameCount++;
    if (currentTime - this.lastTime >= 1000) {
      this.fps = this.fpsFrameCount;
      this.fpsFrameCount = 0;
      this.lastTime = currentTime;
    }

    // Step the physics by the real time elapsed since the previous frame
    // (one step's worth on the first frame, so it has something to draw).
    const elapsed =
      this.lastFrameTime === null
        ? 1000 / this.world.getStepRate()
        : currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;
    this.world.advance(elapsed);

    // Match the canvas to its host *before* drawing: a resize (which clears
    // the canvas) then happens ahead of this frame's drawing instead of
    // after it — left to the ResizeObserver alone, it would land between
    // drawing and paint and show an empty frame. No-op when unchanged.
    sizeCanvasToHost(this.canvas, this.getSurface());
    this.clear();
    this.applyViewTransform();
    // DOM work of the world's elements (plugs following their nodes,
    // jacks following the layout, ...): after this renderer's own layout
    // reads above, so measuring the page costs one layout per frame. The
    // drawing below only touches the canvas.
    this.world.runFrameTasks();

    // Draw all wires using efficient memory access, over their shadows
    if (this.wireShadows) this.drawWireShadows();
    this.drawAllWires();

    // Debug: draw the circumference of every wire node, and the
    // mouse/pointer interaction radii — both gated behind the same debug
    // toggle (see setDebugDrawNodes).
    if (this.debugDrawNodes) {
      this.drawNodeDebug();
      this.drawInteractionRadii(this.mouseX, this.mouseY);
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  /**
   * Starts the self-rescheduling render loop (physics update + draw every
   * frame). Idempotent: calling it again while running does not start a
   * second loop. Can be called again after stop().
   */
  public render() {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = null;
    this.pointer.attach();
    this.frame();
  }

  /**
   * Cancels the render loop started by render(), removes its pointer
   * listener and clears the canvas. Needed by <cavi-world> (worldwc.ts) so
   * removing it from the DOM doesn't leave a dangling rAF loop running
   * against a detached canvas — or, with a surface, stale cables drawn on
   * a canvas that lives outside it.
   */
  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pointer.detach();
    this.clear();
  }
}
