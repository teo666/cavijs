/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import { World } from '../core/world';
import type { IRenderer } from '../core/types';
import type { CaviWireElement } from '../component/wirewc';
import '../component/wirewc';

/**
 * Bend stiffness and end directions (Wire.setBendStiffness/setEndDirection,
 * <cavi-wire bend>), against the real WASM engine.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
});

/** The largest turn between consecutive links of `wire`, in radians. */
function sharpestTurn(world: World, index: number): number {
  const wire = world.getWireByIndex(index)!;
  let sharpest = 0;
  for (let i = 1; i < wire.getNodeCount() - 1; i++) {
    const d1 = Math.atan2(
      wire.getNodeY(i) - wire.getNodeY(i - 1),
      wire.getNodeX(i) - wire.getNodeX(i - 1)
    );
    const d2 = Math.atan2(
      wire.getNodeY(i + 1) - wire.getNodeY(i),
      wire.getNodeX(i + 1) - wire.getNodeX(i)
    );
    let turn = Math.abs(d2 - d1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    sharpest = Math.max(sharpest, turn);
  }
  return sharpest;
}

describe('Wire bend stiffness', () => {
  it('is 0 by default, clamped to 0..1', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 5, 25, 4);
    expect(wire.getBendStiffness()).toBe(0);
    wire.setBendStiffness(3);
    expect(wire.getBendStiffness()).toBe(1);
    wire.setBendStiffness(0.25);
    expect(wire.getBendStiffness()).toBe(0.25);
  });

  it('makes a cable hanging from a point curve instead of folding', () => {
    const world = new World();
    world.setAcceleration(0, 5);
    world.setSleepEnabled(false);
    world.setConstraintIterations(4);
    // 240 of rope from (0, 0) down to (40, 200).
    world.addWire(0, 0, 40, 200, 13, 20, 4);
    world.addWire(0, 0, 40, 200, 13, 20, 4).setBendStiffness(0.3);
    for (let i = 0; i < 600; i++) world.update();

    expect(sharpestTurn(world, 0)).toBeGreaterThan(1.5); // a chain folds
    expect(sharpestTurn(world, 1)).toBeLessThan(0.6);
  });
});

describe('Wire end directions', () => {
  it('are normalized, per end, and cleared with null', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 5, 25, 4);
    expect(wire.getEndDirection(0)).toBe(null);
    wire.setEndDirection(1, { x: 0, y: -4 });
    expect(wire.getEndDirection(1)).toEqual({ x: 0, y: -1 });
    expect(wire.getEndDirection(0)).toBe(null);
    wire.setEndDirection(1, null);
    expect(wire.getEndDirection(1)).toBe(null);
  });

  it('make a stiff cable leave its ends along them', () => {
    const world = new World();
    world.setAcceleration(0, 0);
    const wire = world.addWire(0, 0, 100, 0, 5, 25, 4);
    wire.setBendStiffness(0.5);
    wire.setEndDirection(0, { x: 0, y: 1 });
    wire.setEndDirection(1, { x: 0, y: 1 });
    for (let i = 0; i < 20; i++) world.update();

    expect(wire.getNodeY(1)).toBeGreaterThan(1);
    expect(wire.getNodeY(3)).toBeGreaterThan(1);
  });
});

describe('<cavi-wire bend>', () => {
  function makeWorld(): { cavi: Cavi; container: HTMLElement } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const cavi = new Cavi();
    const renderer: IRenderer = {
      render() {},
      stop() {},
      setDebugDrawNodes() {},
      getDebugDrawNodes: () => false,
      getContainer: () => container,
    };
    cavi.setRenderer(renderer);
    return { cavi, container };
  }

  it('sets the bend stiffness at setup, and live', () => {
    const { container } = makeWorld();
    const el = document.createElement('cavi-wire') as CaviWireElement;
    el.setAttribute('bend', '0.4');
    container.appendChild(el);
    const wire = el.getWire()!;
    expect(wire.getBendStiffness()).toBeCloseTo(0.4);

    el.setAttribute('bend', '0.1');
    expect(wire.getBendStiffness()).toBeCloseTo(0.1);
    el.removeAttribute('bend');
    expect(wire.getBendStiffness()).toBe(0);
  });

  it('leaves a cable without it a chain', () => {
    const { container } = makeWorld();
    const el = document.createElement('cavi-wire') as CaviWireElement;
    container.appendChild(el);
    expect(el.getWire()!.getBendStiffness()).toBe(0);
  });
});
