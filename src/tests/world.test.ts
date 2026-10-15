/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init from 'cavi';
import { World, DEFAULT_WIRE_COLORS } from '../core/world';

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

describe('Wire node handles — follow their node across node edits', () => {
  /** A wire whose last node sits at a recognizable spot. */
  function wireWithMarkedEnd() {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 5, 20, 5);
    const end = wire.getNode(4)!;
    end.setPosition(123, 45);
    return { world, wire, end };
  }

  it('hands out one handle per node', () => {
    const { wire } = wireWithMarkedEnd();
    expect(wire.getNode(2)).toBe(wire.getNode(2));
  });

  it('keeps a terminal handle on the terminal when nodes are inserted before it', () => {
    const { wire, end } = wireWithMarkedEnd();
    wire.addNodeAt(2, 50, 0);
    wire.addNodeAt(4, 70, 0);

    expect(wire.getNodeCount()).toBe(7);
    expect(wire.getNode(6)).toBe(end);
    expect([end.x, end.y]).toEqual([123, 45]);
    end.setPosition(200, 10);
    expect(wire.getNodeX(6)).toBe(200);
  });

  it('follows removals before it, and invalidates the removed node', () => {
    const { wire, end } = wireWithMarkedEnd();
    const middle = wire.getNode(2)!;

    expect(wire.removeNode(2)).toBe(true);

    expect(wire.getNode(3)).toBe(end);
    expect([end.x, end.y]).toEqual([123, 45]);
    // The removed node's handle no longer writes to whatever took its index.
    const occupant = wire.getNodeX(2);
    middle.setPosition(999, 999);
    expect(wire.getNodeX(2)).toBe(occupant);
  });

  it('refuses to go below 2 nodes', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 2, 20, 5);
    expect(wire.removeNode(0)).toBe(false);
    expect(wire.getNodeCount()).toBe(2);
  });

  it('keeps both terminals across setNodeCount, and invalidates the old intermediates', () => {
    const { wire, end } = wireWithMarkedEnd();
    const start = wire.getNode(0)!;
    const middle = wire.getNode(2)!;

    wire.setNodeCount(9);

    expect(wire.getNode(0)).toBe(start);
    expect(wire.getNode(8)).toBe(end);
    expect([end.x, end.y]).toEqual([123, 45]);
    expect(wire.getNode(2)).not.toBe(middle);

    wire.setNodeCount(3);
    expect(wire.getNode(2)).toBe(end);
  });
});

describe('default wire colors', () => {
  it('are given at creation, in order, and stay when an earlier wire is deleted', () => {
    const world = new World();
    const wires = [0, 1, 2, 3].map((i) => world.addWire(0, i * 10, 100, i * 10, 4, 20, 4));
    expect(wires.map((w) => w.getColor())).toEqual([
      ...DEFAULT_WIRE_COLORS,
      DEFAULT_WIRE_COLORS[0],
    ]);

    world.deleteWire(0);
    expect(world.getWires().map((w) => w.getColor())).toEqual([
      DEFAULT_WIRE_COLORS[1],
      DEFAULT_WIRE_COLORS[2],
      DEFAULT_WIRE_COLORS[0],
    ]);
  });
});
