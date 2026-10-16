/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';

/**
 * Cables created by dragging are reflected in the markup, so they come back
 * intact when their <cavi-wire> is set up again. Against the real WASM engine.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
  vi.restoreAllMocks();
});

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

function makeJack(container: HTMLElement, id: string, x: number, y: number): Jack {
  const jack = document.createElement('cavi-jack') as Jack;
  jack.id = id;
  jack.setAttribute('type', 'audio');
  jack.setAttribute('x', String(x));
  jack.setAttribute('y', String(y));
  container.appendChild(jack);
  return jack;
}

/** Removes `el` and puts it back in a later task — not a mere DOM move: it is set up again. */
async function removeAndReinsert(el: Element, parent: Element): Promise<void> {
  el.remove();
  await new Promise((resolve) => setTimeout(resolve));
  parent.appendChild(el);
}

describe('a cable created by dragging', () => {
  /** Pulls a cable out of `from`, far enough to grow it, and drops it on `to` (null: empty space). */
  function pullCable(from: Jack, to: Jack | null) {
    const session = from.createCable(100, 100)!;
    Jack.updateCableSession(session, 600, 100);
    if (to) {
      vi.spyOn(Jack, 'findSnapTarget').mockReturnValue(to);
      session.followNode.setPosition(...(Object.values(to.getWorldPosition()) as [number, number]));
    }
    Jack.finishCableSession(session);
    vi.restoreAllMocks();
    return session;
  }

  it('keeps its markup in step with its state', () => {
    const { container } = makeWorld();
    const a = makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    const session = pullCable(a, b);

    const length = Number(session.wireEl.getAttribute('length'));
    expect(length).toBe(session.wire.getNodeCount());
    expect(length).toBeGreaterThan(4);
    expect(session.originPlug.getAttribute('jack')).toBe('a');
    expect(session.followPlug.getAttribute('jack')).toBe('b');
    expect(session.followPlug.getAttribute('node')).toBe(String(length - 1));
  });

  it('comes back plugged into the same jacks when set up again', async () => {
    const { container } = makeWorld();
    const a = makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    const session = pullCable(a, b);

    await removeAndReinsert(session.wireEl, container);

    const wireEl = session.wireEl as CaviWireElement;
    const wire = wireEl.getWire()!;
    expect(wire).not.toBe(session.wire);
    expect(a.plugCount).toBe(1);
    expect(b.plugCount).toBe(1);
    expect((wireEl.querySelectorAll('cavi-plug')[1] as Plug).jack).toBe(b);
    expect(wire.getNodeX(wire.getNodeCount() - 1)).toBe(600);
  });

  it('brings a free end back where it was, still free', async () => {
    const { cavi, container } = makeWorld();
    cavi.setCableDropBehavior('dangle');
    const a = makeJack(container, 'a', 100, 100);
    const session = pullCable(a, null);
    session.followNode.setPosition(420, 260);
    const length = session.wire.getNodeCount();

    await removeAndReinsert(session.wireEl, container);

    const wire = (session.wireEl as CaviWireElement).getWire()!;
    expect(wire.getNodeCount()).toBe(length);
    expect([wire.getNodeX(length - 1), wire.getNodeY(length - 1)]).toEqual([420, 260]);
    expect(wire.getNode(length - 1)!.fixed).toBe(false);
    expect(a.plugCount).toBe(1); // the origin end is still plugged in
  });

  it('forgets a jack it was pulled out of', () => {
    const { container } = makeWorld();
    const a = makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    const session = pullCable(a, b);

    session.followPlug.beginDrag();
    expect(session.followPlug.hasAttribute('jack')).toBe(false);
    session.followPlug.cancelDrag();
  });

  it('keeps a removed jack in the markup only when the whole cable left with it', async () => {
    const { container } = makeWorld();
    const a = makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    const session = pullCable(a, b);

    b.remove(); // just the jack: its plug is let go
    await Promise.resolve();
    expect(session.followPlug.hasAttribute('jack')).toBe(false);
    expect(session.originPlug.getAttribute('jack')).toBe('a');
  });
});
