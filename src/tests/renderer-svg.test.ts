import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SvgRenderer } from '../renderer/renderer-svg';

/** jsdom doesn't implement ResizeObserver — stub a no-op one so SvgRenderer's internal resize handling doesn't throw. */
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}
let lastResizeObserver: FakeResizeObserver;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    function () {
      lastResizeObserver = new FakeResizeObserver();
      return lastResizeObserver;
    },
  );
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
  } as any;
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
});
