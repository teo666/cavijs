import type { WasmWorld } from 'cavi';
import type { IRenderer, RendererOptions } from '../core/types';
import { DEFAULT_WIRE_COLORS, type World } from '../core/world';
import { Cavi } from '../core/cavi';
import { containerOrigin } from '../core/coords';
import { PointerTracker } from './pointer';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * SVG-based alternative to Renderer (src/renderer/renderer.ts): draws one <path> per
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

  /** Feeds the engine's mouse from the page's pointer (see PointerTracker). */
  private pointer: PointerTracker;
  /** performance.now() of the previous frame, null before the first one — see frame(). */
  private lastFrameTime: number | null = null;

  private debugDrawNodes: boolean = false;
  private rafId: number | null = null;
  private running: boolean = false;

  /** Pooled per-wire <path> elements, indexed by wire index — updated in place each frame, only added/removed when wire count changes. */
  private wirePaths: SVGPathElement[] = [];
  /**
   * What each pooled path last showed — its slice of the render buffer and
   * its color — so a cable that didn't change since the previous frame
   * (asleep, or simply at rest) costs a comparison instead of rebuilding
   * its path string and rewriting its attributes. Indexed like wirePaths.
   */
  private wireDrawn: { data: Float32Array; color: string }[] = [];
  /** The viewLayer transform last written (see applyViewTransform). */
  private viewTransform: string = '';
  /** Pooled node circles of the debug overlay, reused frame to frame (see drawNodeDebug). */
  private nodeCircles: SVGCircleElement[] = [];
  /** The interaction-radii overlay (two circles, a dot, two labels), created once. */
  private radii: {
    group: SVGGElement;
    pointer: SVGCircleElement;
    mouse: SVGCircleElement;
    dot: SVGCircleElement;
    pointerLabel: SVGTextElement;
    mouseLabel: SVGTextElement;
  } | null = null;

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
    this.pointer = new PointerTracker(world, container, () => this.svg);

    this.attachResizeObserver();
  }

  // Duck-typed members <cavi-debug> (and the examples' controls.ts) read directly off a
  // renderer instance — last pointer position, in world coordinates.
  public get mouseX(): number {
    return this.pointer.x;
  }

  public get mouseY(): number {
    return this.pointer.y;
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
      // Same event contract as StandardResizeController (src/renderer/resize.ts), so
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
    const transform = `matrix(${scale} 0 0 ${scale} ${(origin.x - rect.left) / c} ${(origin.y - rect.top) / c})`;
    // Only when it changed: an attribute write invalidates the SVG's rendering.
    if (transform !== this.viewTransform) {
      this.viewTransform = transform;
      this.viewLayer.setAttribute('transform', transform);
    }
  }

  private syncPoolSize(count: number): void {
    while (this.wirePaths.length < count) {
      const p = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      this.wireLayer.appendChild(p);
      this.wirePaths.push(p);
      this.wireDrawn.push({ data: new Float32Array(0), color: '' });
    }
    while (this.wirePaths.length > count) {
      const p = this.wirePaths.pop()!;
      this.wireDrawn.pop();
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
    const wires = this.world.getWiresView();

    let offset = 0;
    for (let wireIdx = 0; wireIdx < wireCount; wireIdx++) {
      const start = offset;
      offset++; // node count — unused here
      const radius = wireData[offset++];
      const renderType = wireData[offset++];
      const pathLength = wireData[offset++];
      const end = offset + pathLength;

      const pathEl = this.wirePaths[wireIdx];
      // See Renderer.drawAllWires: colors are fixed at creation.
      const wireColor = wires[wireIdx]?.getColor() || DEFAULT_WIRE_COLORS[0];

      // Same data and color as last frame: nothing to rewrite.
      const slice = wireData.subarray(start, end);
      const drawn = this.wireDrawn[wireIdx];
      if (drawn.color === wireColor && sameValues(drawn.data, slice)) {
        offset = end;
        continue;
      }
      drawn.data = slice.slice();
      drawn.color = wireColor;

      if (pathLength >= 2) {
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

  /**
   * Debug overlay: a circle on every node. The circles are pooled — one
   * element per node, reused frame to frame, only created or removed when
   * the total node count changes — instead of rebuilt every frame.
   */
  private drawNodeDebug(): void {
    const wires = this.world.getWiresView();
    let used = 0;

    // Read straight from WASM rather than through Wire.getNode().
    for (const wire of wires) {
      const wireIndex = wire.getIndex();
      const r = String(wire.getRadius());
      const nodeCount = wire.getNodeCount();

      for (let i = 0; i < nodeCount; i++) {
        let circle = this.nodeCircles[used];
        if (!circle) {
          circle = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
          circle.setAttribute('fill', 'none');
          circle.setAttribute('stroke', '#00ffff');
          circle.setAttribute('stroke-width', '1');
          this.debugLayer.insertBefore(circle, this.radii?.group ?? null);
          this.nodeCircles.push(circle);
        }
        setIfChanged(circle, 'cx', String(this.wasmWorld.get_wire_node_x(wireIndex, i)));
        setIfChanged(circle, 'cy', String(this.wasmWorld.get_wire_node_y(wireIndex, i)));
        setIfChanged(circle, 'r', r);
        used++;
      }
    }
    while (this.nodeCircles.length > used) this.nodeCircles.pop()!.remove();
  }

  /** Removes the debug overlay (node circles and radii). */
  private clearDebug(): void {
    this.debugLayer.replaceChildren();
    this.nodeCircles = [];
    this.radii = null;
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

  /**
   * Draws the mouse/pointer interaction radii around (mouseX, mouseY), in
   * world coordinates — one reused group of elements, hidden while the
   * pointer is off the surface.
   */
  public drawInteractionRadii(mouseX: number, mouseY: number): void {
    if (!this.radii) {
      const group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      const dot = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', '#ffffff');
      this.radii = {
        group,
        pointer: this.makeDashedCircle(0, 0, 0, '#ffff00'),
        mouse: this.makeDashedCircle(0, 0, 0, '#ff00ff'),
        dot,
        pointerLabel: this.makeLabel(0, 0, ''),
        mouseLabel: this.makeLabel(0, 0, ''),
      };
      const r = this.radii;
      group.append(r.pointer, r.mouse, r.dot, r.pointerLabel, r.mouseLabel);
      this.debugLayer.appendChild(group);
    }
    const r = this.radii;
    const visible = this.pointer.inside;
    const display = visible ? '' : 'none';
    if (r.group.style.display !== display) r.group.style.display = display;
    if (!visible) return;

    const mouseRadius = this.wasmWorld.get_mouse_radius();
    const pointerRadius = this.wasmWorld.get_pointer_radius();
    const x = String(mouseX);
    const y = String(mouseY);
    for (const [circle, radius] of [
      [r.pointer, pointerRadius],
      [r.mouse, mouseRadius],
    ] as const) {
      setIfChanged(circle, 'cx', x);
      setIfChanged(circle, 'cy', y);
      setIfChanged(circle, 'r', String(radius));
    }
    setIfChanged(r.dot, 'cx', x);
    setIfChanged(r.dot, 'cy', y);
    for (const [label, radius, name] of [
      [r.pointerLabel, pointerRadius, 'pointer'],
      [r.mouseLabel, mouseRadius, 'mouse'],
    ] as const) {
      setIfChanged(label, 'x', String(mouseX + radius * 0.7));
      setIfChanged(label, 'y', String(mouseY - radius * 0.7));
      const text = `${name}: ${radius.toFixed(1)}`;
      if (label.textContent !== text) label.textContent = text;
    }
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

    // Same fixed-rate stepping as Renderer.frame.
    const elapsed =
      this.lastFrameTime === null
        ? 1000 / this.world.getStepRate()
        : currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;
    this.world.advance(elapsed);

    this.applyViewTransform();
    // DOM work of the world's elements — see Renderer.frame.
    this.world.runFrameTasks();
    this.drawAllWires();

    if (this.debugDrawNodes) {
      this.drawNodeDebug();
      this.drawInteractionRadii(this.mouseX, this.mouseY);
    } else if (this.debugLayer.childElementCount > 0) {
      this.clearDebug();
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
    this.lastFrameTime = null;
    this.pointer.attach();
    this.frame();
  }

  /** Cancels the render loop, its pointer listener and its ResizeObserver, and clears the drawing. */
  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pointer.detach();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.syncPoolSize(0);
    this.clearDebug();
    this.viewTransform = '';
  }
}

/** Whether two buffers hold the same values. */
function sameValues(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** setAttribute, skipped when the attribute already has that value. */
function setIfChanged(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
