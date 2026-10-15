/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import { World } from '../core/world';
import { SvgRenderer } from '../renderer/renderer-svg';

/**
 * SvgRenderer only touches the DOM for what changed: unchanged cables keep
 * their path untouched, debug circles are reused. Real WASM world.
 */
beforeAll(async () => {
  Cavi.wasm = await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

let nextFrame: FrameRequestCallback | null = null;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    nextFrame = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Runs the renderer's next frame. */
function frame(): void {
  const cb = nextFrame;
  nextFrame = null;
  cb?.(performance.now());
}

/** A world with one straight, slack-free, gravity-free cable: nothing moves. */
function stillWorld() {
  const world = new World();
  world.setAcceleration(0, 0);
  const wire = world.addWire(0, 0, 100, 0, 5, 25, 4);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const renderer = new SvgRenderer(container, world);
  world.setRenderer(renderer);
  return { world, wire, renderer, container };
}

describe('SvgRenderer — writes only what changed', () => {
  it('leaves the path of an unchanged cable alone, and redraws it once it moves', () => {
    const { wire, renderer, container } = stillWorld();
    renderer.render(); // first frame: draws
    const path = container.querySelector('#wireLayer path')!;
    expect(path.getAttribute('d')).toMatch(/^M 0 0 /);
    const set = vi.spyOn(path, 'setAttribute');

    frame();
    frame();
    expect(set).not.toHaveBeenCalled();

    wire.getNode(4)!.setPosition(100, 40);
    frame();
    expect(set).toHaveBeenCalledWith('d', expect.any(String));
    renderer.stop();
  });

  it('redraws a cable whose color changed', () => {
    const { wire, renderer, container } = stillWorld();
    renderer.render();
    const path = container.querySelector('#wireLayer path')!;

    wire.setColor('#123456');
    frame();

    expect(path.getAttribute('stroke')).toBe('#123456');
    renderer.stop();
  });

  it('reuses the debug overlay elements from frame to frame', () => {
    const { wire, renderer, container } = stillWorld();
    renderer.setDebugDrawNodes(true);
    renderer.render();
    const circles = () => [...container.querySelectorAll('#debugLayer > circle')];
    const first = circles();
    expect(first).toHaveLength(5);

    frame();
    expect(circles()).toEqual(first);
    expect(circles().every((c, i) => c === first[i])).toBe(true);

    wire.addNodeAt(2, 50, 0);
    frame();
    expect(circles()).toHaveLength(6);

    renderer.setDebugDrawNodes(false);
    frame();
    expect(container.querySelector('#debugLayer')!.childElementCount).toBe(0);
    renderer.stop();
  });
});

describe('World.getWiresView', () => {
  it('is the live list, while getWires() is a copy', () => {
    const world = new World();
    world.addWire(0, 0, 100, 0, 4, 20, 4);
    expect(world.getWiresView()).toBe(world.getWiresView());
    expect(world.getWires()).not.toBe(world.getWires());
    expect(world.getWires()).toEqual(world.getWiresView());
  });
});
