import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../renderer/renderer';

/**
 * jsdom has no 2D canvas: stub getContext with a recorder, enough to check
 * where the canvas Renderer maps world coordinates to.
 */
let ctx: { setTransform: ReturnType<typeof vi.fn>; [key: string]: unknown };

beforeEach(() => {
  ctx = new Proxy({ setTransform: vi.fn() } as typeof ctx, {
    get: (target, key: string) => (key in target ? target[key] : vi.fn()),
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeFakeWorld(scale = 1) {
  return {
    getWasmWorld: () => ({
      wire_data_ptr: () => 0,
      wire_data_len: () => 0,
      get_mouse_radius: () => 40,
      get_pointer_radius: () => 20,
      set_mouse: vi.fn(),
    }),
    getWires: () => [],
    getWireCount: () => 0,
    update: vi.fn(),
    getCoordinateTransform: () => ({ scale, translateX: 0, translateY: 0 }),
  } as any;
}

function rectAt(left: number, top: number, width = 0): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top,
    width,
    height: 0,
    x: left,
    y: top,
  } as DOMRect;
}

/** The last world->pixel transform the renderer applied, as [a, b, c, d, e, f]. */
function lastTransform(): number[] {
  return ctx.setTransform.mock.calls.at(-1) as number[];
}

describe('Renderer — canvas placement', () => {
  it('creates #wireCanvas in the container when none is given', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new Renderer(container, makeFakeWorld());
    expect(container.querySelector('#wireCanvas')).not.toBeNull();
    renderer.stop();
  });

  it('draws into a given canvas placed anywhere, without creating one', () => {
    const container = document.createElement('div');
    const own = document.createElement('canvas');
    document.body.append(container, own);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectAt(100, 50));
    vi.spyOn(own, 'getBoundingClientRect').mockReturnValue(rectAt(130, 70));

    const renderer = new Renderer(container, makeFakeWorld(), { canvas: own });
    renderer.render();

    expect(container.querySelector('canvas')).toBeNull();
    // World (0,0) sits at client (100,50); the canvas starts at (130,70).
    expect(lastTransform()).toEqual([1, 0, 0, 1, -30, -20]);
    renderer.stop();
  });

  it('applies the zoom itself for a canvas that is not CSS-scaled (e.g. on a surface)', () => {
    const container = document.createElement('div');
    const surface = document.createElement('div');
    document.body.append(surface, container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectAt(130, 70));

    const renderer = new Renderer(container, makeFakeWorld(2), { surface });
    const canvas = surface.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rectAt(10, 20));
    renderer.render();

    expect(lastTransform()).toEqual([2, 0, 0, 2, 120, 50]);
    renderer.stop();
  });

  it('does not double the zoom for a canvas CSS-scaled along with the container', () => {
    const container = document.createElement('div');
    const own = document.createElement('canvas');
    container.appendChild(own);
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectAt(0, 0));
    // Laid out 100px wide, drawn 200px wide on screen: a 2x CSS zoom.
    Object.defineProperty(own, 'offsetWidth', { value: 100 });
    vi.spyOn(own, 'getBoundingClientRect').mockReturnValue(rectAt(0, 0, 200));

    const renderer = new Renderer(container, makeFakeWorld(2), { canvas: own });
    renderer.render();

    expect(lastTransform()).toEqual([1, 0, 0, 1, 0, 0]);
    renderer.stop();
  });
});
