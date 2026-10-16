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

describe('SvgRenderer — the path it draws', () => {
  /** What SvgRenderer draws for a still cable of 5 nodes from (0, 0) to (100, 0). */
  function draw(renderType: number) {
    const world = new World();
    world.setAcceleration(0, 0);
    const wire = world.addWire(0, 0, 100, 0, 5, 25, 4, renderType);
    wire.setColor('#abcdef');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const renderer = new SvgRenderer(container, world);
    world.setRenderer(renderer);
    renderer.render();
    const path = container.querySelector('#wireLayer path')!;
    const drawn = {
      d: path.getAttribute('d')!,
      stroke: path.getAttribute('stroke'),
      width: path.getAttribute('stroke-width'),
    };
    renderer.stop();
    return drawn;
  }

  const num = String.raw`-?\d+(?:\.\d+)?(?:e-?\d+)?`;

  it('draws a segments cable as one line per node, through every node', () => {
    const { d } = draw(0);
    expect(d).toMatch(new RegExp(`^M ${num} ${num}(?: L ${num} ${num}){4}$`));
    const xs = [...d.matchAll(new RegExp(`[ML] (${num}) ${num}`, 'g'))].map((m) => Number(m[1]));
    expect(xs[0]).toBeCloseTo(0);
    expect(xs.at(-1)).toBeCloseTo(100);
  });

  it('draws a bezier cable with cubic curves only, ending on the last node', () => {
    const { d } = draw(1);
    expect(d).toMatch(/^M /);
    expect(d).toContain(' C ');
    expect(d).not.toContain(' L ');
    const last = d.trim().split(/[ ,]+/).slice(-2).map(Number);
    expect(last[0]).toBeCloseTo(100);
    expect(last[1]).toBeCloseTo(0);
  });

  it('strokes with the cable color and twice its radius', () => {
    const { stroke, width } = draw(0);
    expect(stroke).toBe('#abcdef');
    expect(width).toBe('8');
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
