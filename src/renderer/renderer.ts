import type { WasmWorld } from 'cavi';
import type { IRenderer, RendererOptions } from '../core/types';
import type { World } from '../core/world';
import { Cavi } from '../core/cavi';
import { clientToWorld, containerOrigin } from '../core/coords';
import { sizeCanvasToHost } from './resize';

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
  // Last pointer position, in world coordinates. Public: <cavi-controls>
  // reads them duck-typed off the active renderer (same as SvgRenderer).
  public mouseX: number = 200;
  public mouseY: number = 200;
  /** Whether the last known pointer position is over the drawing surface. */
  private pointerInside: boolean = false;
  private debugDrawNodes: boolean = false;
  private rafId: number | null = null;
  private running: boolean = false;
  /**
   * Memoized wire-color -> highlight-color lookups (see lightenColor) — this
   * runs every frame for every wire, so a color string is only ever
   * normalized/mixed once, not re-parsed on every draw call.
   */
  private highlightColorCache = new Map<string, string>();
  /** Offscreen 1x1 canvas reused to normalize arbitrary CSS color strings (hex/named/rgb/...) into RGB, for lightenColor. */
  private colorProbeCanvas: HTMLCanvasElement | null = null;
  private colorProbeContext: CanvasRenderingContext2D | null = null;

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

  private drawNodeDebug() {
    const wires = this.world.getWires();

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
    if (!this.pointerInside) return;
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
   * Feeds the physics engine's mouse-repulsion position. Listens on the
   * document (not the container) so it keeps working over every part of
   * the surface — including areas outside the container's own box once a
   * consumer zooms out — and converts through the same container-anchored,
   * zoom-aware clientToWorld every other pointer position goes through.
   */
  private handlePointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerInside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!this.pointerInside) return;

    const p = clientToWorld(
      e.clientX,
      e.clientY,
      this.container,
      this.world.getCoordinateTransform()
    );
    this.mouseX = p.x;
    this.mouseY = p.y;
    this.wasmWorld.set_mouse(p.x, p.y);
  };

  /**
   * Normalizes any CSS color string (hex, named, rgb(), ...) by painting it
   * into a reused 1x1 offscreen canvas and reading the resulting pixel back,
   * then mixes it toward white by `amount` (0-1) and returns an `rgba(...)`
   * string with `alpha` baked in — used to derive a cable's highlight color
   * from its own base color (see drawAllWires). Memoized in
   * highlightColorCache, keyed by the exact (color, amount, alpha) request,
   * since this would otherwise re-parse/re-paint on every frame for every
   * wire.
   */
  private lightenColor(color: string, amount: number, alpha: number): string {
    const cacheKey = `${color}|${amount}|${alpha}`;
    const cached = this.highlightColorCache.get(cacheKey);
    if (cached) return cached;

    if (!this.colorProbeCanvas) {
      this.colorProbeCanvas = document.createElement('canvas');
      this.colorProbeCanvas.width = 1;
      this.colorProbeCanvas.height = 1;
      this.colorProbeContext = this.colorProbeCanvas.getContext('2d');
    }
    const probe = this.colorProbeContext;
    let result: string;
    if (!probe) {
      // Extremely unlikely (2D context unavailable) — fall back to a
      // neutral light gray rather than crashing the render loop.
      result = `rgba(255, 255, 255, ${alpha})`;
    } else {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
      result = `rgba(${mix(r)}, ${mix(g)}, ${mix(b)}, ${alpha})`;
    }

    this.highlightColorCache.set(cacheKey, result);
    return result;
  }

  private drawAllWires() {
    // Access wire data directly from WASM memory (ZERO COPY!)
    const ptr = this.wasmWorld.wire_data_ptr();
    const len = this.wasmWorld.wire_data_len();

    if (len === 0) return;

    // Create Float32Array view directly into WASM memory (buffer is now f32)
    const wireData = new Float32Array(Cavi.wasm.memory.buffer, ptr, len);

    // Default colors as fallback
    const defaultColors = ['#00ff88', '#ff00ff', '#ffaa00'];

    let offset = 0;
    const wireCount = this.world.getWireCount();
    const wires = this.world.getWires();

    for (let wireIdx = 0; wireIdx < wireCount; wireIdx++) {
      offset++; // node count — unused here
      const radius = wireData[offset++];
      const renderType = wireData[offset++];
      const pathLength = wireData[offset++];

      // Get wire instance to access metadata
      const wire = wires[wireIdx];
      const wireColor = wire?.getColor() || defaultColors[wireIdx % defaultColors.length];

      // Draw wire path
      if (pathLength >= 2) {
        this.context.lineWidth = radius * 2;
        this.context.lineCap = 'round';
        this.context.lineJoin = 'round';

        this.context.beginPath();

        // Start at first point
        this.context.moveTo(wireData[offset], wireData[offset + 1]);

        offset += 2;

        if (renderType === 0) {
          // Render as segments
          const targetOffset = offset + pathLength - 2;
          while (offset < targetOffset) {
            const x = wireData[offset++];
            const y = wireData[offset++];
            this.context.lineTo(x, y);
          }
        } else {
          // Render as Bezier curves
          const targetOffset = offset + pathLength - 2;
          while (offset < targetOffset) {
            const cp1x = wireData[offset++];
            const cp1y = wireData[offset++];
            const cp2x = wireData[offset++];
            const cp2y = wireData[offset++];
            const x = wireData[offset++];
            const y = wireData[offset++];

            this.context.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
          }
        }

        // // Base color pass, with a soft cast shadow (the canvas shadow
        // // renderer casts the shadow of this stroked shape for free, in the
        // // same call — no extra path/pass needed for the shadow itself).
        // this.context.shadowColor = 'rgb(0, 0, 0)';
        // this.context.shadowBlur = radius * 2;
        // this.context.shadowOffsetX = 0;
        // this.context.shadowOffsetY = radius * 0.6;
        this.context.strokeStyle = wireColor;
        this.context.stroke();

        // // Highlight pass, on the same path already built above: a thin,
        // // lighter centerline streak to fake a rounded/glossy tube — cheap
        // // approximation vs. a true perpendicular-offset highlight, which
        // // the 2D canvas API doesn't give you for free. No shadow of its own.
        // // A small ctx.filter blur softens its edge into the base color
        // // beneath instead of reading as a hard-edged second stroke — much
        // // cheaper than a true cross-section gradient, which would need the
        // // path re-built as an offset polygon per curve segment.
        // this.context.shadowColor = 'transparent';
        // this.context.shadowBlur = 0;
        // this.context.shadowOffsetY = 0;
        // this.context.filter = `blur(${radius * 0.35}px)`;
        // this.context.lineWidth = radius * 0.7;
        // this.context.strokeStyle = this.lightenColor(wireColor, 0.45, 0.5);
        //  this.context.stroke();
        //  this.context.filter = 'none';
      } else {
        offset += pathLength;
      }
    }
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
    this.context.setTransform(
      scale,
      0,
      0,
      scale,
      (dpr * (origin.x - left)) / c,
      (dpr * (origin.y - top)) / c
    );
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

    // Update physics
    this.world.update();

    // Match the canvas to its host *before* drawing: a resize (which clears
    // the canvas) then happens ahead of this frame's drawing instead of
    // after it — left to the ResizeObserver alone, it would land between
    // drawing and paint and show an empty frame. No-op when unchanged.
    sizeCanvasToHost(this.canvas, this.getSurface());
    this.clear();
    this.applyViewTransform();

    // Draw all wires using efficient memory access
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
    document.addEventListener('pointermove', this.handlePointerMove);
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
    document.removeEventListener('pointermove', this.handlePointerMove);
    this.clear();
  }
}
