import type { WasmWorld } from 'cavi';
import type { IRenderer } from '../core/types';
import type { World } from '../core/world';
import { Cavi } from '../core/cavi';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * SVG-based alternative to Renderer (src/renderer.ts): draws one <path> per
 * wire instead of stroking a canvas. Self-contained by design — unlike
 * Renderer (which expects a consumer, e.g. worldwc.ts, to create and size
 * the #wireCanvas for it), this class creates its own #wireSvg if none
 * exists and manages its own sizing via an internal ResizeObserver, so
 * `new SvgRenderer(container, world)` is a drop-in swap for
 * `new Renderer(container, world)` anywhere without further wiring.
 */
export class SvgRenderer implements IRenderer {
  private container: HTMLElement;
  private svg: SVGSVGElement;
  private wireLayer: SVGGElement;
  private debugLayer: SVGGElement;
  private world: World;
  private wasmWorld: WasmWorld;

  private lastTime = performance.now();
  private fpsFrameCount = 0;
  private fps = 0;

  // Duck-typed members controls.ts reads directly off a renderer instance
  // (getFPS() guarded with typeof, mouseX/mouseY read unguarded) — kept
  // public (not private, unlike Renderer) since that's read from outside
  // the class at runtime.
  public mouseX: number = 200;
  public mouseY: number = 200;
  public isDragging: boolean = false;
  public draggedWire: number | null = null;
  public draggedEndpoint: 'start' | 'end' | null = null;

  private debugDrawNodes: boolean = true;
  private rafId: number | null = null;

  /** Pooled per-wire <path> elements, indexed by wire index — updated in place each frame, only added/removed when wire count changes. */
  private wirePaths: SVGPathElement[] = [];

  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, world: World) {
    this.container = container;
    this.world = world;
    this.wasmWorld = world.getWasmWorld();

    this.svg = this.ensureSvg();
    this.wireLayer = this.ensureGroup('wireLayer');
    this.debugLayer = this.ensureGroup('debugLayer');

    this.attachResizeObserver();
    this.addMouseMoveListener();
  }

  private ensureSvg(): SVGSVGElement {
    let svg = this.container.querySelector<SVGSVGElement>('#wireSvg');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.id = 'wireSvg';
      svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      this.container.insertBefore(svg, this.container.firstChild);
    }
    return svg;
  }

  private ensureGroup(id: string): SVGGElement {
    let g = this.svg.querySelector<SVGGElement>(`#${id}`);
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      g.id = id;
      this.svg.appendChild(g);
    }
    return g;
  }

  private attachResizeObserver(): void {
    const resize = () => {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.svg.setAttribute('width', String(width));
      this.svg.setAttribute('height', String(height));
      // Same event contract as StandardResizeController (src/resize.ts), so
      // consumers (e.g. repositionJacksFromSlots in patchbay-shared.ts) can
      // listen for 'cavi-resize' on the container regardless of which
      // IRenderer is active.
      this.container.dispatchEvent(new CustomEvent('cavi-resize', { detail: { width, height } }));
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.container);
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public getFPS(): number {
    return this.fps;
  }

  public setDebugDrawNodes(enabled: boolean): void {
    this.debugDrawNodes = enabled;
  }

  public getDebugDrawNodes(): boolean {
    return this.debugDrawNodes;
  }

  private addMouseMoveListener(): void {
    this.container.addEventListener('mousemove', (e) => {
      const rect = this.svg.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;

      if (this.isDragging && this.draggedWire !== null && this.draggedEndpoint !== null) {
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

  private syncPoolSize(count: number): void {
    while (this.wirePaths.length < count) {
      const p = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      this.wireLayer.appendChild(p);
      this.wirePaths.push(p);
    }
    while (this.wirePaths.length > count) {
      const p = this.wirePaths.pop()!;
      p.remove();
    }
  }

  private drawAllWires(): void {
    const ptr = this.wasmWorld.wire_data_ptr();
    const len = this.wasmWorld.wire_data_len();
    const wireCount = this.world.getWireCount();
    this.syncPoolSize(wireCount);

    if (len === 0) return;

    const wireData = new Float32Array(Cavi.wasm.memory.buffer, ptr, len);
    const defaultColors = ['#00ff88', '#ff00ff', '#ffaa00'];
    const wires = this.world.getWires();

    let offset = 0;
    for (let wireIdx = 0; wireIdx < wireCount; wireIdx++) {
      const nodeCount = wireData[offset++];
      void nodeCount;
      const radius = wireData[offset++];
      const renderType = wireData[offset++];
      const pathLength = wireData[offset++];

      const pathEl = this.wirePaths[wireIdx];

      if (pathLength >= 2) {
        const wire = wires[wireIdx];
        const wireColor = wire?.getColor() || defaultColors[wireIdx % defaultColors.length];

        let d = `M ${wireData[offset]} ${wireData[offset + 1]}`;
        offset += 2;

        if (renderType === 0) {
          const targetOffset = offset + pathLength - 2;
          while (offset < targetOffset) {
            const x = wireData[offset++];
            const y = wireData[offset++];
            d += ` L ${x} ${y}`;
          }
        } else {
          const targetOffset = offset + pathLength - 2;
          while (offset < targetOffset) {
            const cp1x = wireData[offset++];
            const cp1y = wireData[offset++];
            const cp2x = wireData[offset++];
            const cp2y = wireData[offset++];
            const x = wireData[offset++];
            const y = wireData[offset++];
            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x} ${y}`;
          }
        }

        pathEl.setAttribute('d', d);
        pathEl.setAttribute('stroke', wireColor);
        pathEl.setAttribute('stroke-width', String(radius * 2));
        pathEl.style.display = '';
      } else {
        offset += pathLength;
        pathEl.setAttribute('d', '');
        pathEl.style.display = 'none';
      }
    }
  }

  private drawNodeDebug(): void {
    const wires = this.world.getWires();

    for (const wire of wires) {
      const radius = wire.getRadius();
      const nodeCount = wire.getNodeCount();

      for (let i = 0; i < nodeCount; i++) {
        const node = wire.getNode(i);
        if (!node) continue;

        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(node.x));
        circle.setAttribute('cy', String(node.y));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', '#00ffff');
        circle.setAttribute('stroke-width', '1');
        this.debugLayer.appendChild(circle);
      }
    }
  }

  private makeDashedCircle(cx: number, cy: number, r: number, stroke: string): SVGCircleElement {
    const c = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', stroke);
    c.setAttribute('stroke-width', '2');
    c.setAttribute('stroke-dasharray', '5,5');
    return c;
  }

  private makeLabel(x: number, y: number, text: string): SVGTextElement {
    const t = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('font-family', 'monospace');
    t.setAttribute('font-size', '12');
    t.setAttribute('fill', '#ffffff');
    t.setAttribute('stroke', '#000000');
    t.setAttribute('stroke-width', '3');
    t.setAttribute('paint-order', 'stroke');
    t.textContent = text;
    return t;
  }

  public drawInteractionRadii(mouseX: number, mouseY: number): void {
    const width = Number(this.svg.getAttribute('width')) || 0;
    const height = Number(this.svg.getAttribute('height')) || 0;
    if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;

    const mouseRadius = this.wasmWorld.get_mouse_radius();
    const pointerRadius = this.wasmWorld.get_pointer_radius();

    this.debugLayer.appendChild(this.makeDashedCircle(mouseX, mouseY, pointerRadius, '#ffff00'));
    this.debugLayer.appendChild(this.makeDashedCircle(mouseX, mouseY, mouseRadius, '#ff00ff'));

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(mouseX));
    dot.setAttribute('cy', String(mouseY));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#ffffff');
    this.debugLayer.appendChild(dot);

    this.debugLayer.appendChild(
      this.makeLabel(mouseX + pointerRadius * 0.7, mouseY - pointerRadius * 0.7, `pointer: ${pointerRadius.toFixed(1)}`),
    );
    this.debugLayer.appendChild(
      this.makeLabel(mouseX + mouseRadius * 0.7, mouseY - mouseRadius * 0.7, `mouse: ${mouseRadius.toFixed(1)}`),
    );
  }

  public render(): void {
    const currentTime = performance.now();

    this.fpsFrameCount++;
    if (currentTime - this.lastTime >= 1000) {
      this.fps = this.fpsFrameCount;
      this.fpsFrameCount = 0;
      this.lastTime = currentTime;
    }

    this.world.update();

    this.drawAllWires();

    if (this.debugDrawNodes) {
      this.debugLayer.replaceChildren();
      this.drawNodeDebug();
      this.drawInteractionRadii(this.mouseX, this.mouseY);
    } else if (this.debugLayer.childElementCount > 0) {
      this.debugLayer.replaceChildren();
    }

    this.rafId = requestAnimationFrame(this.render.bind(this));
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
