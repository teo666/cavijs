import type { WasmWorld } from 'cavi';
import type { IRenderer, RendererOptions } from '../core/types';
import type { World } from '../core/world';
import { Cavi } from '../core/cavi';
import { clientToWorld, containerOrigin } from '../core/coords';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * SVG-based alternative to Renderer (src/renderer.ts): draws one <path> per
 * wire instead of stroking a canvas. Self-contained by design — unlike
 * Renderer (which expects a consumer, e.g. worldwc.ts, to keep the
 * #wireCanvas sized for it), this class creates its own #wireSvg if none
 * exists and manages its own sizing via an internal ResizeObserver, so
 * `new SvgRenderer(container, world)` is a drop-in swap for
 * `new Renderer(container, world)` anywhere without further wiring. Takes
 * the same RendererOptions (see `surface` for pan/zoom setups).
 */
export class SvgRenderer implements IRenderer {
  private container: HTMLElement;
  /** See RendererOptions.surface — null means the svg lives in `container`. */
  private surface: HTMLElement | null;
  private svg: SVGSVGElement;
  /** Holds every drawn layer; carries the world->surface transform in surface mode. */
  private viewLayer: SVGGElement;
  private wireLayer: SVGGElement;
  private debugLayer: SVGGElement;
  private world: World;
  private wasmWorld: WasmWorld;

  private lastTime = performance.now();
  private fpsFrameCount = 0;
  private fps = 0;

  // Duck-typed members controls.ts reads directly off a renderer instance
  // (getFPS() guarded with typeof, mouseX/mouseY read unguarded) — last
  // pointer position, in world coordinates.
  public mouseX: number = 200;
  public mouseY: number = 200;
  private pointerInside: boolean = false;

  private debugDrawNodes: boolean = false;
  private rafId: number | null = null;
  private running: boolean = false;

  /** Pooled per-wire <path> elements, indexed by wire index — updated in place each frame, only added/removed when wire count changes. */
  private wirePaths: SVGPathElement[] = [];

  private resizeObserver: ResizeObserver | null = null;

  /**
   * Uses `options.svg` — any `<svg>`, anywhere on the page — else the
   * `#wireSvg` found in the host (the surface if given, else `container`),
   * creating one there if there is none. Its on-screen placement is
   * measured every frame (see applyViewTransform).
   */
  constructor(
    container: HTMLElement,
    world: World,
    options: RendererOptions & { svg?: SVGSVGElement } = {}
  ) {
    this.container = container;
    this.surface = options.surface ?? null;
    this.world = world;
    this.wasmWorld = world.getWasmWorld();

    this.svg = options.svg ?? this.ensureSvg();
    this.viewLayer = this.ensureGroup(this.svg, 'viewLayer');
    this.wireLayer = this.ensureGroup(this.viewLayer, 'wireLayer');
    this.debugLayer = this.ensureGroup(this.viewLayer, 'debugLayer');

    this.attachResizeObserver();
  }

  private ensureSvg(): SVGSVGElement {
    const host = this.surface ?? this.container;
    let svg = this.surface
      ? host.querySelector<SVGSVGElement>(':scope > #wireSvg')
      : host.querySelector<SVGSVGElement>('#wireSvg');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.id = 'wireSvg';
      svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;';
      host.insertBefore(svg, host.firstChild);
    }
    return svg;
  }

  private ensureGroup(parent: SVGElement, id: string): SVGGElement {
    let g = parent.querySelector<SVGGElement>(`:scope > #${id}`);
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      g.id = id;
      parent.appendChild(g);
    }
    return g;
  }

  private attachResizeObserver(): void {
    if (this.resizeObserver) return;
    const resizeSvg = () => {
      const host = this.surface ?? this.container;
      this.svg.setAttribute('width', String(host.clientWidth));
      this.svg.setAttribute('height', String(host.clientHeight));
    };
    resizeSvg();
    this.resizeObserver = new ResizeObserver((entries) => {
      resizeSvg();
      // Same event contract as StandardResizeController (src/resize.ts), so
      // consumers (e.g. repositionJacksFromSlots in patchbay-shared.ts) can
      // listen for 'cavi-resize' on the container regardless of which
      // IRenderer is active.
      if (entries.some((entry) => entry.target === this.container)) {
        this.container.dispatchEvent(
          new CustomEvent('cavi-resize', {
            detail: { width: this.container.clientWidth, height: this.container.clientHeight },
          })
        );
      }
    });
    this.resizeObserver.observe(this.container);
    if (this.surface) this.resizeObserver.observe(this.surface);
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public getSurface(): HTMLElement {
    return this.surface ?? this.container;
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

  /** Same as Renderer.handlePointerMove: feeds the physics mouse position, in world space. */
  private handlePointerMove = (e: PointerEvent): void => {
    const rect = this.svg.getBoundingClientRect();
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
   * Maps world coordinates onto the svg wherever it is on screen — same
   * derivation as Renderer.applyViewTransform (minus the device-pixel
   * ratio, which SVG doesn't need): world -> client through the registered
   * zoom and the container's on-screen origin, then client -> svg user
   * units through the svg's own on-screen position and scale. For the
   * default svg at the container's top-left this is the identity.
   */
  private applyViewTransform(): void {
    const rect = this.svg.getBoundingClientRect();
    const width = Number(this.svg.getAttribute('width')) || 0;
    const c = width > 0 ? rect.width / width || 1 : 1;
    const t = this.world.getCoordinateTransform();
    const origin = containerOrigin(this.container, t.scale);
    const scale = t.scale / c;
    this.viewLayer.setAttribute(
      'transform',
      `matrix(${scale} 0 0 ${scale} ${(origin.x - rect.left) / c} ${(origin.y - rect.top) / c})`
    );
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
      offset++; // node count — unused here
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

    // Read straight from WASM rather than through Wire.getNode(), which
    // would allocate a wrapper per node per frame.
    for (const wire of wires) {
      const wireIndex = wire.getIndex();
      const radius = wire.getRadius();
      const nodeCount = wire.getNodeCount();

      for (let i = 0; i < nodeCount; i++) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(this.wasmWorld.get_wire_node_x(wireIndex, i)));
        circle.setAttribute('cy', String(this.wasmWorld.get_wire_node_y(wireIndex, i)));
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

  /** Draws the mouse/pointer interaction radii around (mouseX, mouseY), in world coordinates. */
  public drawInteractionRadii(mouseX: number, mouseY: number): void {
    if (!this.pointerInside) return;

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
      this.makeLabel(
        mouseX + pointerRadius * 0.7,
        mouseY - pointerRadius * 0.7,
        `pointer: ${pointerRadius.toFixed(1)}`
      )
    );
    this.debugLayer.appendChild(
      this.makeLabel(
        mouseX + mouseRadius * 0.7,
        mouseY - mouseRadius * 0.7,
        `mouse: ${mouseRadius.toFixed(1)}`
      )
    );
  }

  private frame = (): void => {
    if (!this.running) return;
    const currentTime = performance.now();

    this.fpsFrameCount++;
    if (currentTime - this.lastTime >= 1000) {
      this.fps = this.fpsFrameCount;
      this.fpsFrameCount = 0;
      this.lastTime = currentTime;
    }

    this.world.update();

    this.applyViewTransform();
    this.drawAllWires();

    if (this.debugDrawNodes) {
      this.debugLayer.replaceChildren();
      this.drawNodeDebug();
      this.drawInteractionRadii(this.mouseX, this.mouseY);
    } else if (this.debugLayer.childElementCount > 0) {
      this.debugLayer.replaceChildren();
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  /**
   * Starts the render loop. Idempotent while running; can be called again
   * after stop() (re-attaching the resize observer stop() disconnected).
   */
  public render(): void {
    if (this.running) return;
    this.running = true;
    this.attachResizeObserver();
    document.addEventListener('pointermove', this.handlePointerMove);
    this.frame();
  }

  /** Cancels the render loop, its pointer listener and its ResizeObserver, and clears the drawing. */
  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener('pointermove', this.handlePointerMove);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.syncPoolSize(0);
    this.debugLayer.replaceChildren();
  }
}
