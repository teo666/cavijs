import type { WasmWorld } from 'cavi';
import type { IRenderer } from './types';
import type { World } from './world';
import { Cavi } from './cavi';

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

  public clear() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Get current FPS
   */
  public getFPS(): number {
    return this.fps;
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
        this.context.strokeStyle = wireColor;
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

        this.context.stroke();
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

    // Draw interaction radii at mouse position
    this.drawInteractionRadii(this.mouseX, this.mouseY);

    // Update debug info
    // updateDebugInfo();

    // Continue animation
    requestAnimationFrame(this.render.bind(this));
  }
}
