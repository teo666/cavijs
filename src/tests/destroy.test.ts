/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IRenderer } from '../core/types';
import type { Jack } from '../component/jack';
import type { CaviWireElement } from '../component/wirewc';
import '../component/jack';

/** Tearing a world down (Cavi.destroy) and replacing its renderer, against the real WASM engine. */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
});

function fakeRenderer(
  container: HTMLElement
): IRenderer & { stop: ReturnType<typeof vi.fn<() => void>> } {
  return {
    render() {},
    stop: vi.fn<() => void>(),
    setDebugDrawNodes() {},
    getDebugDrawNodes: () => false,
    getContainer: () => container,
  };
}

function makeWorld() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cavi = new Cavi();
  const renderer = fakeRenderer(container);
  cavi.setRenderer(renderer);
  return { cavi, container, renderer };
}

describe('Cavi.destroy', () => {
  it('stops the renderer, unregisters the container and clears Cavi.shared', () => {
    const { cavi, container, renderer } = makeWorld();
    Cavi.shared = cavi;
    const el = document.createElement('div');
    container.appendChild(el);
    expect(Cavi.for(el)).toBe(cavi);

    cavi.destroy();

    expect(cavi.isDestroyed()).toBe(true);
    expect(renderer.stop).toHaveBeenCalled();
    expect(Cavi.shared).toBeNull();
    expect(Cavi.for(el)).toBeNull();
    cavi.destroy(); // idempotent
  });

  it('turns every Wire and Node handle into a harmless no-op', () => {
    const { cavi } = makeWorld();
    const wire = cavi.addWire(0, 0, 100, 0, 5, 20, 4);
    const node = wire.getNode(4)!;

    cavi.destroy();

    expect(wire.getIndex()).toBe(-1);
    expect(wire.getNodeCount()).toBe(0);
    expect(() => {
      node.setPosition(10, 10);
      node.fixed = false;
      wire.setRadius(3);
    }).not.toThrow();
  });

  it('lets the elements of a removed world clean up without touching the freed engine', async () => {
    const { cavi, container } = makeWorld();
    const jack = document.createElement('cavi-jack') as Jack;
    jack.id = 'j1';
    jack.setAttribute('type', 'audio');
    container.appendChild(jack);
    const wireEl = document.createElement('cavi-wire') as CaviWireElement;
    wireEl.setAttribute('length', '4');
    wireEl.setAttribute('type', 'audio');
    for (const [node, jackId] of [
      ['0', 'j1'],
      ['3', ''],
    ]) {
      const plug = document.createElement('cavi-plug');
      plug.setAttribute('node', node);
      if (jackId) plug.setAttribute('jack', jackId);
      wireEl.appendChild(plug);
    }
    container.appendChild(wireEl);
    expect(jack.plugCount).toBe(1);

    cavi.destroy();
    container.remove(); // disconnect microtasks: jack releases plugs, wire releases its wire
    await Promise.resolve();
    await Promise.resolve();

    expect(jack.plugCount).toBe(0);
    expect(wireEl.getWire()).toBeNull();
  });
});

describe('Cavi.setRenderer', () => {
  it('stops and unregisters the previous renderer', () => {
    const { cavi, container, renderer } = makeWorld();
    const other = document.createElement('div');
    document.body.appendChild(other);
    const next = fakeRenderer(other);

    cavi.setRenderer(next);

    expect(renderer.stop).toHaveBeenCalled();
    expect(Cavi.for(container)).toBeNull();
    expect(Cavi.for(other)).toBe(cavi);
  });

  it('accepts null: no renderer, container unregistered', () => {
    const { cavi, container, renderer } = makeWorld();
    cavi.setRenderer(null);
    expect(cavi.getRenderer()).toBeNull();
    expect(renderer.stop).toHaveBeenCalled();
    expect(Cavi.for(container)).toBeNull();
  });
});
