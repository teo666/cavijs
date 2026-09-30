import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SvgRenderer } from '../renderer/renderer-svg';

/** jsdom doesn't implement ResizeObserver — stub a no-op one so SvgRenderer's internal resize handling doesn't throw. */
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}
let lastResizeObserver: FakeResizeObserver;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', function () {
    lastResizeObserver = new FakeResizeObserver();
    return lastResizeObserver;
  });
});

function makeFakeWorld() {
  return {
    getWasmWorld: () => ({
      wire_data_ptr: () => 0,
      wire_data_len: () => 0,
      get_mouse_radius: () => 40,
      get_pointer_radius: () => 20,
      set_mouse: vi.fn(),
      set_wire_start: vi.fn(),
      set_wire_end: vi.fn(),
    }),
    getWires: () => [],
    getWireCount: () => 0,
    update: vi.fn(),
    getCoordinateTransform: () => ({ scale: 2, translateX: 0, translateY: 0 }),
  } as any;
}

function clientRect(left: number, top: number): DOMRect {
  return { left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top } as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('SvgRenderer', () => {
  it('creates a default #wireSvg when none is provided', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new SvgRenderer(container, makeFakeWorld());
    const svg = container.querySelector('#wireSvg');
    expect(svg).not.toBeNull();
    expect(svg?.tagName.toLowerCase()).toBe('svg');
    renderer.stop();
  });

  it('reuses an author-provided #wireSvg instead of creating a new one', () => {
    const container = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'wireSvg';
    container.appendChild(svg);
    document.body.appendChild(container);
    const renderer = new SvgRenderer(container, makeFakeWorld());
    expect(container.querySelectorAll('#wireSvg').length).toBe(1);
    expect(container.querySelector('#wireSvg')).toBe(svg);
    renderer.stop();
  });

  it('implements the IRenderer contract plus the duck-typed getFPS/mouseX/mouseY members', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new SvgRenderer(container, makeFakeWorld());
    expect(typeof renderer.render).toBe('function');
    expect(typeof renderer.stop).toBe('function');
    expect(typeof renderer.getContainer).toBe('function');
    expect(typeof renderer.setDebugDrawNodes).toBe('function');
    expect(typeof renderer.getDebugDrawNodes).toBe('function');
    expect(typeof renderer.getFPS).toBe('function');
    expect(renderer.mouseX).not.toBeUndefined();
    expect(renderer.mouseY).not.toBeUndefined();
    renderer.stop();
  });

  it('stop() disconnects its internal ResizeObserver (self-contained deviation from canvas Renderer)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new SvgRenderer(container, makeFakeWorld());
    renderer.stop();
    expect(lastResizeObserver.disconnect).toHaveBeenCalled();
  });

  describe('surface mode', () => {
    it('puts #wireSvg in the surface, not in the (transformed) container', () => {
      const surface = document.createElement('div');
      const container = document.createElement('div');
      surface.appendChild(container);
      document.body.appendChild(surface);

      const renderer = new SvgRenderer(container, makeFakeWorld(), { surface });

      expect(surface.querySelector(':scope > #wireSvg')).not.toBeNull();
      expect(container.querySelector('#wireSvg')).toBeNull();
      expect(renderer.getSurface()).toBe(surface);
      renderer.stop();
    });

    it("maps world coordinates through the zoom and the container's on-screen origin", () => {
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1)
      );
      const surface = document.createElement('div');
      const container = document.createElement('div');
      surface.appendChild(container);
      document.body.appendChild(surface);
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(clientRect(130, 70));

      const renderer = new SvgRenderer(container, makeFakeWorld(), { surface });
      const svg = surface.querySelector('#wireSvg') as SVGSVGElement;
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(clientRect(10, 20));
      renderer.render();

      const view = svg.querySelector('#viewLayer')!;
      expect(view.getAttribute('transform')).toBe('matrix(2 0 0 2 120 50)');
      renderer.stop();
    });

    it('uses the identity transform for the default svg at the container origin', () => {
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1)
      );
      const container = document.createElement('div');
      document.body.appendChild(container);
      const world = makeFakeWorld();
      world.getCoordinateTransform = () => ({ scale: 1, translateX: 0, translateY: 0 });
      const renderer = new SvgRenderer(container, world);
      renderer.render();
      expect(container.querySelector('#viewLayer')!.getAttribute('transform')).toBe(
        'matrix(1 0 0 1 0 0)'
      );
      renderer.stop();
    });

    it('draws into a given svg placed anywhere, aligned through its on-screen position', () => {
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1)
      );
      const container = document.createElement('div');
      const own = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      document.body.append(container, own);
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(clientRect(100, 50));
      vi.spyOn(own, 'getBoundingClientRect').mockReturnValue(clientRect(130, 70));
      const world = makeFakeWorld();
      world.getCoordinateTransform = () => ({ scale: 1, translateX: 0, translateY: 0 });

      const renderer = new SvgRenderer(container, world, { svg: own });
      renderer.render();

      expect(container.querySelector('#wireSvg')).toBeNull(); // nothing created
      expect(own.querySelector('#viewLayer')!.getAttribute('transform')).toBe(
        'matrix(1 0 0 1 -30 -20)'
      );
      renderer.stop();
    });
  });

  it('render() is idempotent and restartable after stop()', () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    document.body.appendChild(container);
    const world = makeFakeWorld();
    const renderer = new SvgRenderer(container, world);

    renderer.render();
    renderer.render();
    expect(world.update).toHaveBeenCalledTimes(1);

    renderer.stop();
    renderer.render();
    expect(world.update).toHaveBeenCalledTimes(2);
    renderer.stop();
  });
});
