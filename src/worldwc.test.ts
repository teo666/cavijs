import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cavi', () => {
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
    setDragMode = vi.fn();
  }
  return { Cavi: FakeCavi };
});

vi.mock('./renderer', () => {
  class FakeRenderer {
    render = vi.fn();
    stop = vi.fn();
    constructor(container: HTMLElement, world: unknown) {}
  }
  return { Renderer: FakeRenderer };
});

// Avoid pulling in the real Jack/CaviWireElement/Plug/interaction custom
// elements — irrelevant to worldwc's own behavior and this file only needs
// './cavi' and './renderer' to be the fakes above.
vi.mock('./jack', () => ({}));
vi.mock('./interactionwc', () => ({}));

import { Cavi } from './cavi';
import type { Renderer } from './renderer';
import { CaviWorldElement } from './worldwc';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
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

  it('reads gravity-x/gravity-y/debug-nodes/drag-mode attributes into Cavi at setup', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    world.setAttribute('gravity-x', '3');
    world.setAttribute('gravity-y', '12');
    world.setAttribute('debug-nodes', '');
    world.setAttribute('drag-mode', 'click');
    document.body.appendChild(world);
    await flushMicrotasks();

    const cavi = world.getCavi()!;
    expect(cavi.setAcceleration).toHaveBeenCalledWith(3, 12);
    expect(cavi.setDebugDrawNodes).toHaveBeenCalledWith(true);
    expect(cavi.setDragMode).toHaveBeenCalledWith('click');
  });

  it('stops the renderer loop on disconnect', async () => {
    const world = document.createElement('cavi-world') as CaviWorldElement;
    document.body.appendChild(world);
    await flushMicrotasks();

    const renderer = world.getCavi()!.getRenderer() as Renderer;
    world.remove();

    expect(renderer.stop).toHaveBeenCalledTimes(1);
  });
});
