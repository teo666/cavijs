/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from 'cavi';
import { World } from '../core/world';

/**
 * Runs against the real `cavi` WASM build (not a fake), since the bug these
 * cover lives exactly at the JS-handle <-> WASM-index boundary.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

describe('World.deleteWire — handle stability', () => {
  it('shifts surviving Wire handles in place, so references held elsewhere stay valid', () => {
    const world = new World();
    const a = world.addWire(0, 0, 100, 0, 5, 20, 5);
    const b = world.addWire(0, 200, 100, 200, 7, 20, 5);
    b.setColor('#123456');

    world.deleteWire(a.getIndex());

    expect(world.getWireByIndex(0)).toBe(b);
    expect(b.getIndex()).toBe(0);
    expect(b.getNodeCount()).toBe(7);
    expect(b.getColor()).toBe('#123456');
  });

  it('keeps a Node obtained before the deletion bound to its own wire', () => {
    const world = new World();
    const a = world.addWire(0, 0, 100, 0, 5, 20, 5);
    const b = world.addWire(0, 200, 100, 200, 5, 20, 5);
    const bStart = b.getNode(0)!;

    world.deleteWire(a.getIndex());
    bStart.setPosition(42, 242);

    expect(world.getWasmWorld().get_wire_node_x(0, 0)).toBe(42);
    expect(world.getWasmWorld().get_wire_node_y(0, 0)).toBe(242);
    expect(bStart.x).toBe(42);
  });

  it('turns the deleted handle into a no-op instead of hitting whichever wire takes its index', () => {
    const world = new World();
    const a = world.addWire(0, 0, 100, 0, 5, 20, 5);
    const aStart = a.getNode(0)!;
    world.addWire(0, 200, 100, 200, 5, 20, 5);

    world.deleteWire(a.getIndex());
    aStart.setPosition(999, 999);
    a.setRadius(50);

    expect(a.getIndex()).toBe(-1);
    expect(world.getWasmWorld().get_wire_node_x(0, 0)).toBe(0);
    expect(world.getWireByIndex(0)!.getRadius()).toBe(5);
  });
});

describe('Node — live view of a WASM node', () => {
  it('reads `fixed` from WASM, not a value cached at creation', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 5, 20, 5);
    const middle = wire.getNode(2)!;
    const again = wire.getNode(2)!;

    middle.fixed = true;

    expect(again.fixed).toBe(true);
    expect(wire.getNode(0)!.fixed).toBe(true); // terminals start fixed
  });

  it('returns null for an out-of-range index', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 5, 20, 5);
    expect(wire.getNode(5)).toBeNull();
    expect(wire.getNode(-1)).toBeNull();
  });
});
