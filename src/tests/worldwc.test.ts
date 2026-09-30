import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * jsdom implements no ResizeObserver, and <cavi-world> creates one on
 * connect (StandardResizeController) — without this stub every test here
 * dies in connectedCallback before _setup() ever runs, which reads only as
 * a puzzling "getCavi() is null".
 */
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  );
});

vi.mock('../core/cavi', () => {
  class FakeCavi {
    static shared: unknown = null;
    static initWasm = vi.fn(() => Promise.resolve());
    private renderer: unknown = null;
    getRenderer() {
      return this.renderer;
    }
    setRenderer(r: unknown) {
      this.renderer = r;
    }
    getWorld() {
      return {};
    }
    setAcceleration = vi.fn();
    setDebugDrawNodes = vi.fn();
    setCableDropBehavior = vi.fn();
    setPlugSpreadMode = vi.fn();
    setPlugSpreadRadiusMultiplier = vi.fn();
    setPlugSpreadRecompactDelayMs = vi.fn();
    setCoordinateTransformProvider = vi.fn();
  }
  return { Cavi: FakeCavi };
});

vi.mock('../renderer/renderer', () => {
  class FakeRenderer {
    render = vi.fn();
    stop = vi.fn();
    options: unknown;
    constructor(_container: HTMLElement, _world: unknown, options?: unknown) {
      this.options = options;
    }
  }
  return { Renderer: FakeRenderer };
});

// Avoid pulling in the real Jack/CaviWireElement/Plug/interaction custom
// elements — irrelevant to worldwc's own behavior and this file only needs
// '../core/cavi' and '../renderer/renderer' to be the fakes above.
vi.mock('../component/jack', () => ({}));
vi.mock('../component/interactionwc', () => ({}));

import { Cavi } from '../core/cavi';
import type { Renderer } from '../renderer/renderer';
import { CaviWorldElement } from '../component/worldwc';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  (Cavi as unknown as { shared: unknown }).shared = null;
  vi.clearAllMocks();
});

describe('CaviWorldElement', () => {
  it('creates a default #wireCanvas and a positioning context when neither is provided', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    document.body.appendChild(world);
    await flushMicrotasks();

    const canvas = world.querySelector('#wireCanvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.tagName.toLowerCase()).toBe('canvas');
    expect(world.style.position).toBe('relative');
  });

  it('reuses an author-provided #wireCanvas instead of creating a new one', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    const canvas = document.createElement('canvas');
    canvas.id = 'wireCanvas';
    world.appendChild(canvas);
    document.body.appendChild(world);
    await flushMicrotasks();

    expect(world.querySelectorAll('#wireCanvas').length).toBe(1);
    expect(world.querySelector('#wireCanvas')).toBe(canvas);
  });

  it('initializes a Cavi instance, publishes it as Cavi.shared, and dispatches caviready', async () => {
    const readyHandler = vi.fn();
    document.addEventListener('caviready', readyHandler, { once: true });

    const world = document.createElement('cavi-world') as CaviWorldElement;
    document.body.appendChild(world);
    await flushMicrotasks();

    expect(world.getCavi()).not.toBeNull();
    expect(Cavi.shared).toBe(world.getCavi());
    expect(readyHandler).toHaveBeenCalledTimes(1);
  });

  it('reads gravity-x/gravity-y/debug-nodes attributes into Cavi at setup', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('gravity-x', '3');
    world.setAttribute('gravity-y', '12');
    world.setAttribute('debug-nodes', '');
    document.body.appendChild(world);
    await flushMicrotasks();

    const cavi = world.getCavi()!;
    expect(cavi.setAcceleration).toHaveBeenCalledWith(3, 12);
    expect(cavi.setDebugDrawNodes).toHaveBeenCalledWith(true);
  });

  it('reads cable-drop-behavior/plug-spread-* attributes into Cavi at setup', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('cable-drop-behavior', 'cancel');
    world.setAttribute('plug-spread-mode', 'radial');
    world.setAttribute('plug-spread-radius', '2.5');
    world.setAttribute('plug-spread-timeout', '750');
    document.body.appendChild(world);
    await flushMicrotasks();

    const cavi = world.getCavi()!;
    expect(cavi.setCableDropBehavior).toHaveBeenCalledWith('cancel');
    expect(cavi.setPlugSpreadMode).toHaveBeenCalledWith('radial');
    expect(cavi.setPlugSpreadRadiusMultiplier).toHaveBeenCalledWith(2.5);
    expect(cavi.setPlugSpreadRecompactDelayMs).toHaveBeenCalledWith(750);
  });

  it('stops the renderer loop on disconnect', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    document.body.appendChild(world);
    await flushMicrotasks();

    const renderer = world.getCavi()!.getRenderer() as Renderer;
    world.remove();

    expect(renderer.stop).toHaveBeenCalledTimes(1);
  });

  it('resumes the render loop when reconnected after a DOM move', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    document.body.appendChild(world);
    await flushMicrotasks();

    const renderer = world.getCavi()!.getRenderer() as Renderer;
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(world);

    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('creates only one Cavi when reconnected while WASM init is still in flight', async () => {
    const readyHandler = vi.fn();
    document.addEventListener('caviready', readyHandler);

    const world = document.createElement('cavi-world') as CaviWorldElement;
    document.body.appendChild(world);
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(world); // before WASM init resolves
    await flushMicrotasks();

    document.removeEventListener('caviready', readyHandler);
    expect(readyHandler).toHaveBeenCalledTimes(1);
  });

  it('with surface="…", creates the canvas in that element and hands it to the renderer', async () => {
    const frame = document.createElement('div');
    frame.id = 'frame';
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('surface', '#frame');
    frame.appendChild(world);
    document.body.appendChild(frame);
    await flushMicrotasks();

    const canvas = frame.querySelector(':scope > #wireCanvas');
    expect(canvas).not.toBeNull();
    expect(world.querySelector('#wireCanvas')).toBeNull();
    expect(frame.style.position).toBe('relative');
    const renderer = world.getCavi()!.getRenderer() as unknown as { options: unknown };
    expect(renderer.options).toEqual({ canvas, surface: frame });
  });

  it('removes the surface canvas when the world is removed for good', async () => {
    const frame = document.createElement('div');
    frame.id = 'frame';
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('surface', '#frame');
    frame.appendChild(world);
    document.body.appendChild(frame);
    await flushMicrotasks();

    world.remove();
    await flushMicrotasks();
    expect(frame.querySelector('#wireCanvas')).toBeNull();
  });

  it('keeps a coordinate transform set before the world is ready, and applies it at setup', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    const provider = () => ({ scale: 2, translateX: 0, translateY: 0 });
    world.setCoordinateTransform(provider);
    document.body.appendChild(world);
    await flushMicrotasks();

    expect(world.getCavi()!.setCoordinateTransformProvider).toHaveBeenCalledWith(provider);
  });

  it('draws into the canvas named by the `canvas` attribute and never removes it', async () => {
    const own = document.createElement('canvas');
    own.id = 'myCanvas';
    const frame = document.createElement('div');
    frame.id = 'frame';
    document.body.append(own, frame);
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('canvas', '#myCanvas');
    world.setAttribute('surface', '#frame');
    frame.appendChild(world);
    await flushMicrotasks();

    expect(document.querySelectorAll('canvas').length).toBe(1); // none created
    const renderer = world.getCavi()!.getRenderer() as unknown as { options: { canvas: unknown } };
    expect(renderer.options.canvas).toBe(own);

    world.remove();
    await flushMicrotasks();
    expect(own.isConnected).toBe(true);
  });

  it('accepts a canvas through the `.canvas` property too', async () => {
    const own = document.createElement('canvas');
    document.body.appendChild(own);
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.canvas = own;
    document.body.appendChild(world);
    await flushMicrotasks();

    expect(world.querySelector('canvas')).toBeNull();
    const renderer = world.getCavi()!.getRenderer() as unknown as { options: { canvas: unknown } };
    expect(renderer.options.canvas).toBe(own);
  });

  it('falls back to creating a canvas when the `canvas` selector matches nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('canvas', '#missing');
    document.body.appendChild(world);
    await flushMicrotasks();

    expect(world.querySelector('#wireCanvas')).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
