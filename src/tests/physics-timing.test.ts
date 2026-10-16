/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { World } from '../core/world';
import { PointerTracker } from '../renderer/pointer';

/**
 * Fixed-rate stepping (World.advance) and the parked engine mouse
 * (World.releaseMouse / PointerTracker), against the real WASM engine.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Runs `frames` advance() calls of `frameMs` each, returning the total steps. */
function run(world: World, frameMs: number, frames: number, jitterMs = 0): number {
  let steps = 0;
  for (let i = 0; i < frames; i++) {
    steps += world.advance(frameMs + (i % 2 === 0 ? jitterMs : -jitterMs));
  }
  return steps;
}

describe('World.advance — fixed step rate', () => {
  it('runs exactly one step per frame on a 60 Hz display, despite timestamp jitter', () => {
    const world = new World();
    const perFrame = Array.from({ length: 120 }, (_, i) =>
      world.advance(1000 / 60 + (i % 2 === 0 ? 0.4 : -0.4))
    );
    expect(new Set(perFrame)).toEqual(new Set([1]));
  });

  it('keeps 60 steps per second on 120 Hz, 144 Hz and 30 Hz displays', () => {
    for (const hz of [120, 144, 30]) {
      const world = new World();
      const steps = run(world, 1000 / hz, hz * 2); // two seconds
      expect(steps, `${hz} Hz`).toBeGreaterThanOrEqual(119);
      expect(steps, `${hz} Hz`).toBeLessThanOrEqual(121);
    }
  });

  it('follows setStepRate', () => {
    const world = new World();
    world.setStepRate(120);
    expect(run(world, 1000 / 60, 60)).toBe(120);
    world.setStepRate(-1); // ignored
    expect(world.getStepRate()).toBe(120);
  });

  it('does not replay a long pause (background tab) as a burst of steps', () => {
    const world = new World();
    expect(world.advance(5000)).toBe(4);
    // ...and the dropped time is gone, not owed to the next frames.
    expect(world.advance(1000 / 60)).toBe(1);
  });

  it('rebuilds the render buffer on every advance, even without a step', () => {
    const world = new World();
    world.setStepRate(30);
    expect(world.advance(1000 / 60)).toBe(0);

    world.addWire(0, 0, 100, 0, 5, 20, 4);
    expect(world.getWasmWorld().wire_data_len()).toBe(0); // stale until rebuilt
    expect(world.advance(1000 / 60)).toBe(1);
    world.addWire(0, 50, 100, 50, 5, 20, 4);
    expect(world.advance(1000 / 60)).toBe(0);
    // Both wires are in the buffer although no step ran since the second.
    expect(world.getWasmWorld().wire_data_len()).toBe(2 * (4 + 2 * 13));
  });

  it('draws a new, interpolated position on every frame of a 120 Hz display', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 200, 0, 9, 20, 4); // falls under gravity
    world.advance(1000 / 60);

    const drawnY: number[] = [];
    const physicsY: number[] = [];
    for (let i = 0; i < 8; i++) {
      world.advance(1000 / 120);
      drawnY.push(wire.getNode(4)!.getRenderPosition().y);
      physicsY.push(wire.getNode(4)!.y);
    }
    // Physics steps every other frame (4 steps: 5 states counting the first
    // frame's); what is drawn moves on every frame.
    expect(new Set(physicsY).size).toBe(5);
    expect(new Set(drawnY).size).toBe(8);
    // ...always between the last two physics states, never ahead of them.
    for (let i = 1; i < 8; i++) expect(drawnY[i]).toBeLessThanOrEqual(physicsY[i]! + 1e-3);
  });

  it('exposes the engine step parameters, with the defaults of the old hardcoded values', () => {
    const world = new World();
    expect(world.getTimeStep()).toBeCloseTo(0.3);
    expect([world.getSubsteps(), world.getConstraintIterations()]).toEqual([2, 1]);
    world.setTimeStep(0.2);
    world.setSubsteps(3);
    world.setConstraintIterations(4);
    expect(world.getTimeStep()).toBeCloseTo(0.2);
    expect([world.getSubsteps(), world.getConstraintIterations()]).toEqual([3, 4]);
    world.setSubsteps(0);
    expect(world.getSubsteps()).toBe(1);
  });
});

describe('engine mouse', () => {
  /** Interior node positions of a gravity-free cable through the origin, after a few steps. */
  function simulate(configure: (world: World) => void): number[] {
    const world = new World();
    world.setAcceleration(0, 0);
    configure(world);
    const wire = world.addWire(-60, 0, 60, 0, 13, 10, 4);
    for (let i = 0; i < 5; i++) world.update();
    const ys: number[] = [];
    for (let i = 1; i < wire.getNodeCount() - 1; i++) ys.push(wire.getNode(i)!.y);
    return ys;
  }

  const farAway = (world: World) => world.setMouse(-1e7, -1e7);

  it('starts parked, so it does not push cables at the world origin around', () => {
    expect(simulate(() => {})).toEqual(simulate(farAway));
  });

  it('pushes cables while set, and stops once released', () => {
    expect(simulate((w) => w.setMouse(0, 1))).not.toEqual(simulate(farAway));
    expect(
      simulate((w) => {
        w.setMouse(0, 1);
        w.releaseMouse();
      })
    ).toEqual(simulate(farAway));
  });
});

describe('PointerTracker', () => {
  function setup() {
    const world = {
      setMouse: vi.fn(),
      releaseMouse: vi.fn(),
      getCoordinateTransform: () => ({ scale: 1, translateX: 0, translateY: 0 }),
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 200));
    const tracker = new PointerTracker(world as unknown as World, container, () => container);
    tracker.attach();
    return { world, tracker };
  }

  const move = (x: number, y: number, pointerType = 'mouse') =>
    document.dispatchEvent(
      new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType })
    );

  it('feeds the mouse while over the surface and releases it once on the way out', () => {
    const { world, tracker } = setup();
    move(50, 60);
    expect(world.setMouse).toHaveBeenLastCalledWith(50, 60);
    expect(tracker.inside).toBe(true);

    move(500, 500);
    move(600, 600);
    expect(world.releaseMouse).toHaveBeenCalledTimes(1);
    expect(tracker.inside).toBe(false);
    tracker.detach();
  });

  it('releases when a touch ends, but not when a mouse button is released', () => {
    const { world, tracker } = setup();
    move(50, 60);
    document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse' }));
    expect(world.releaseMouse).not.toHaveBeenCalled();
    document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }));
    expect(world.releaseMouse).toHaveBeenCalledTimes(1);
    tracker.detach();
  });

  it('releases when the pointer leaves the window', () => {
    const { world, tracker } = setup();
    move(50, 60);
    document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }));
    expect(world.releaseMouse).toHaveBeenCalledTimes(1);
    tracker.detach();
  });

  it('stops listening once detached', () => {
    const { world, tracker } = setup();
    tracker.detach();
    world.setMouse.mockClear();
    move(50, 60);
    expect(world.setMouse).not.toHaveBeenCalled();
  });
});
