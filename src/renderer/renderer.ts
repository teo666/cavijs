import type { WasmWorld } from 'cavi';
import type { IRenderer } from '../core/types';
import type { World } from '../core/world';
import { Cavi } from '../core/cavi';

export class Renderer implements IRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private world: World;
  private lastTime = performance.now();
  private fpsFrameCount = 0;
  private fps = 0;
  private wasmWorld: WasmWorld;
  private mouseX: number = 200;
  private mouseY: number = 200;
  private isDragging: boolean = false;
  private draggedWire: number | null = null;
  private draggedEndpoint: 'start' | 'end' | null = null;
  private debugDrawNodes: boolean = true;
  private rafId: number | null = null;
  /**
   * Memoized wire-color -> highlight-color lookups (see lightenColor) — this
   * runs every frame for every wire, so a color string is only ever
   * normalized/mixed once, not re-parsed on every draw call.
   */
  private highlightColorCache = new Map<string, string>();
  /** Offscreen 1x1 canvas reused to normalize arbitrary CSS color strings (hex/named/rgb/...) into RGB, for lightenColor. */
  private colorProbeCanvas: HTMLCanvasElement | null = null;
  private colorProbeContext: CanvasRenderingContext2D | null = null;

  constructor(container: HTMLElement, world: World) {
    this.container = container;
    const canvas = container.querySelector('#wireCanvas') as HTMLCanvasElement;
    
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to get 2D context');
    }
    this.context = context;
    this.addMouseMoveListener();

    this.world = world;
    this.wasmWorld = world.getWasmWorld();
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public clear() {
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

    for (const wire of wires) {
      const radius = wire.getRadius();
      const nodeCount = wire.getNodeCount();

      for (let i = 0; i < nodeCount; i++) {
        const node = wire.getNode(i);
        if (!node) continue;

        this.context.beginPath();
        this.context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        this.context.stroke();
      }
    }
  }

  public drawInteractionRadii(mouseX: number, mouseY: number) {
    // Only draw if mouse is within canvas bounds
    if (mouseX < 0 || mouseY < 0 || mouseX > this.canvas.width || mouseY > this.canvas.height) {
      return;
    }

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

  private addMouseMoveListener() {
    this.container.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;

      if (this.isDragging && this.draggedWire !== null && this.draggedEndpoint !== null) {
        // Update the dragged endpoint position
        if (this.draggedEndpoint === 'start') {
          this.wasmWorld.set_wire_start(this.draggedWire, this.mouseX, this.mouseY);
        } else {
          this.wasmWorld.set_wire_end(this.draggedWire, this.mouseX, this.mouseY);
        }
      } else {
        this.wasmWorld.set_mouse(this.mouseX, this.mouseY);
      }
    });
  }

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
    const wireData = new Float32Array(
      Cavi.wasm.memory.buffer,
      ptr,
      len
    );

    // Default colors as fallback
    const defaultColors = ['#00ff88', '#ff00ff', '#ffaa00'];

    let offset = 0;
    const wireCount = this.world.getWireCount();
    const wires = this.world.getWires();

    for (let wireIdx = 0; wireIdx < wireCount; wireIdx++) {
      const nodeCount = wireData[offset++];
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

  public render() {
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

    // Clear canvas
    // this.context.fillStyle = '#0a0a0a';
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // // Draw all wires using efficient memory access
    this.drawAllWires();

    // // Draw wire endpoints to show they're draggable
    // drawWireEndpoints();

    // Debug: draw the circumference of every wire node, and the
    // mouse/pointer interaction radii — both gated behind the same debug
    // toggle (see setDebugDrawNodes).
    if (this.debugDrawNodes) {
      this.drawNodeDebug();
      this.drawInteractionRadii(this.mouseX, this.mouseY);
    }

    // Update debug info
    // updateDebugInfo();

    // Continue animation
    this.rafId = requestAnimationFrame(this.render.bind(this));
  }

  /**
   * Cancels the self-rescheduling render loop started by render(). Needed by
   * <cavi-world> (worldwc.ts) so removing it from the DOM doesn't leave a
   * dangling rAF loop running against a detached canvas.
   */
  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
