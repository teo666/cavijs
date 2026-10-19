// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  RENDER_SEGMENTS,
  World,
  forEachWireRender,
  initWasm,
  isWasmReady,
  nodeCountForDistance,
  svgPathData,
  tracePath,
  wirePath,
  type WireRender,
} from '../core/index';

/**
 * cavijs/core in plain Node — no document, no window, no customElements:
 * importing it touches no DOM, and a World runs and draws without one.
 * Against the real WASM engine.
 */
beforeAll(async () => {
  await initWasm(readFileSync('node_modules/cavi/cavi_bg.wasm'));
});

describe('cavijs/core', () => {
  it('loads and runs where there is no DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof customElements).toBe('undefined');
    expect(isWasmReady()).toBe(true);

    const world = new World();
    const wire = world.addWire(0, 0, 200, 0, 8, 20, 5);
    world.advance(1000 / 60);

    expect(wirePath(world, wire)).toMatch(/^M 0 0 C /);
  });

  it('hands every wire its render data, in index order', () => {
    const world = new World();
    const a = world.addWire(0, 0, 100, 0, 4, 20, 3);
    const b = world.addWire(0, 50, 100, 50, 5, 20, 6, RENDER_SEGMENTS);
    world.advance(0);

    const seen: Pick<WireRender, 'wire' | 'index' | 'radius' | 'renderType'>[] = [];
    forEachWireRender(world, ({ wire, index, radius, renderType, path }) => {
      seen.push({ wire, index, radius, renderType });
      expect([path[0], path[1]]).toEqual([0, index * 50]);
    });

    expect(seen).toEqual([
      { wire: a, index: 0, radius: 3, renderType: 1 },
      { wire: b, index: 1, radius: 6, renderType: RENDER_SEGMENTS },
    ]);
  });

  it('turns a path into SVG path data, or traces it into a canvas path', () => {
    const segments = new Float32Array([0, 0, 10, 0, 20, 5]);
    const bezier = new Float32Array([0, 0, 1, 2, 3, 4, 5, 6]);
    expect(svgPathData(segments, RENDER_SEGMENTS)).toBe('M 0 0 L 10 0 L 20 5');
    expect(svgPathData(bezier, 1)).toBe('M 0 0 C 1 2, 3 4, 5 6');
    expect(svgPathData(new Float32Array(0), 1)).toBe('');

    const calls: string[] = [];
    const target = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
      bezierCurveTo: (...v: number[]) => calls.push(`C${v.join(',')}`),
    };
    expect(tracePath(target, bezier, 1)).toBe(true);
    expect(calls).toEqual(['M0,0', 'C1,2,3,4,5,6']);
  });

  it('sizes cables by distance the way a cable pulled out of a jack grows', () => {
    expect(nodeCountForDistance(0)).toBe(4);
    expect(nodeCountForDistance(300)).toBe(14);
    expect(nodeCountForDistance(1e6)).toBe(60);
    expect(nodeCountForDistance(300, { min: 2, perUnit: 1 / 100, max: 3 })).toBe(3);
  });
});

describe('Wire.growTo / shrinkTo', () => {
  function cable() {
    const world = new World();
    const wire = world.addWire(0, 0, 90, 0, 4, 30, 5);
    return { world, wire };
  }

  it('inserts the missing nodes before the last one, leaving the others be', () => {
    const { wire } = cable();
    const second = wire.getNode(1)!;
    second.setPosition(31, 7);
    const last = wire.getNode(3)!;

    wire.growTo(7);

    expect(wire.getNodeCount()).toBe(7);
    expect([second.x, second.y]).toEqual([31, 7]);
    expect(wire.getNode(1)).toBe(second);
    // The last node's handle follows it; new nodes lie between node 2 (60, 0) and it (90, 0).
    expect(wire.getNode(6)).toBe(last);
    expect(last.x).toBe(90);
    expect([3, 4, 5].map((i) => wire.getNodeX(i))).toEqual([67.5, 75, 82.5]);
  });

  it('stacks new nodes on the one before the last with "stack"', () => {
    const { wire } = cable();
    wire.growTo(6, 'stack');
    expect([2, 3, 4].map((i) => wire.getNodeX(i))).toEqual([60, 60, 60]);
  });

  it('removes nodes before the last one, never below two', () => {
    const { wire } = cable();
    wire.growTo(8);
    const first = wire.getNode(0)!;
    const last = wire.getNode(7)!;

    wire.shrinkTo(5);
    expect(wire.getNodeCount()).toBe(5);
    expect(wire.getNode(0)).toBe(first);
    expect(wire.getNode(4)).toBe(last);
    expect(last.x).toBe(90);

    wire.shrinkTo(0);
    expect(wire.getNodeCount()).toBe(2);
  });

  it('does nothing when there is nothing to grow or shrink', () => {
    const { wire } = cable();
    wire.growTo(3);
    wire.shrinkTo(10);
    expect(wire.getNodeCount()).toBe(4);
  });
});
