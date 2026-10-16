/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { World } from '../core/world';
import type { IRenderer } from '../core/types';

beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function worldWithRenderer(): { world: World; container: HTMLElement; surface: HTMLElement } {
  const container = document.createElement('div');
  const surface = document.createElement('div');
  document.body.append(surface, container);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 300));
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 800));
  const world = new World();
  world.setRenderer({
    render() {},
    stop() {},
    setDebugDrawNodes() {},
    getDebugDrawNodes: () => false,
    getContainer: () => container,
    getSurface: () => surface,
  } satisfies IRenderer);
  return { world, container, surface };
}

describe('World frame tasks', () => {
  it('runs every read before any write', () => {
    const world = new World();
    const calls: string[] = [];
    for (const name of ['a', 'b']) {
      world.addFrameTask({
        read: () => calls.push(`read ${name}`),
        write: () => calls.push(`write ${name}`),
      });
    }
    world.runFrameTasks();
    expect(calls).toEqual(['read a', 'read b', 'write a', 'write b']);
  });

  it('measures the view once per frame, only if asked, in world coordinates', () => {
    const { world, container } = worldWithRenderer();
    const seen: unknown[] = [];
    world.addFrameTask({ read: (ctx) => seen.push(ctx.viewBounds) });
    world.addFrameTask({ read: (ctx) => seen.push(ctx.viewBounds) });

    world.runFrameTasks();

    expect(seen[0]).toBe(seen[1]);
    // Container origin is world (0, 0); the surface extends beyond it.
    expect(seen[0]).toEqual([
      { left: 0, top: 0, right: 400, bottom: 300 },
      { left: -100, top: -50, right: 900, bottom: 750 },
    ]);
    // clientToWorld reads the container's rect again for each corner, but
    // no other element is measured.
    expect(container.getBoundingClientRect).toHaveBeenCalled();
  });

  it('reports no view bounds without a renderer', () => {
    const world = new World();
    let bounds: unknown = null;
    world.addFrameTask({ read: (ctx) => (bounds = ctx.viewBounds) });
    world.runFrameTasks();
    expect(bounds).toEqual([]);
  });

  it('skips the write of a task unregistered during the frame, and stops running it', () => {
    const world = new World();
    const write = vi.fn();
    let stopB: () => void = () => {};
    world.addFrameTask({ write: () => stopB() });
    stopB = world.addFrameTask({ write });

    world.runFrameTasks();
    world.runFrameTasks();

    expect(write).not.toHaveBeenCalled();
  });
});
