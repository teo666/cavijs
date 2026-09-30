/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import { Plug } from '../component/plug';
import { StandardInteractionController } from '../interaction/interaction';

/**
 * Several worlds on one page: every element must resolve its own Cavi
 * (Cavi.for) instead of the global Cavi.shared singleton.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
});

function fakeRenderer(container: HTMLElement): IRenderer {
  return {
    render() {},
    stop() {},
    setDebugDrawNodes() {},
    getDebugDrawNodes: () => false,
    getContainer: () => container,
  };
}

/** A Cavi rendering into a fresh container appended to the body. */
function makeWorld(): { cavi: Cavi; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cavi = new Cavi();
  cavi.setRenderer(fakeRenderer(container));
  return { cavi, container };
}

function rectAt(x: number, y: number, size = 24): DOMRect {
  return {
    left: x - size / 2,
    top: y - size / 2,
    right: x + size / 2,
    bottom: y + size / 2,
    width: size,
    height: size,
    x: x - size / 2,
    y: y - size / 2,
    toJSON() {
      return this;
    },
  } as unknown as DOMRect;
}

function addJack(parent: HTMLElement, x: number, y: number): Jack {
  const jack = document.createElement('cavi-jack') as Jack;
  jack.setAttribute('type', 'audio');
  jack.setAttribute('x', String(x));
  jack.setAttribute('y', String(y));
  parent.appendChild(jack);
  return jack;
}

describe('Cavi.for', () => {
  it('resolves each element to the Cavi whose renderer container encloses it', () => {
    const a = makeWorld();
    const b = makeWorld();
    const inner = document.createElement('span');
    b.container.appendChild(inner);
    Cavi.shared = a.cavi;

    expect(Cavi.for(a.container)).toBe(a.cavi);
    expect(Cavi.for(inner)).toBe(b.cavi);
  });

  it('falls back to Cavi.shared outside any registered container', () => {
    const a = makeWorld();
    Cavi.shared = a.cavi;
    const stray = document.createElement('div');
    document.body.appendChild(stray);

    expect(Cavi.for(stray)).toBe(a.cavi);
  });

  it('returns null inside a <cavi-world> that is not ready yet, instead of borrowing another world', () => {
    const a = makeWorld();
    Cavi.shared = a.cavi;
    const pendingWorld = document.createElement('cavi-world');
    const child = document.createElement('div');
    pendingWorld.appendChild(child);
    document.body.appendChild(pendingWorld);

    expect(Cavi.for(child)).toBeNull();
  });

  it("whenReady waits for the element's own world, ignoring another world's caviready", () => {
    const pendingWorld = document.createElement('cavi-world');
    const child = document.createElement('div');
    pendingWorld.appendChild(child);
    const otherWorld = document.createElement('cavi-world');
    document.body.append(pendingWorld, otherWorld);
    const fn = vi.fn();

    Cavi.whenReady(child, fn);
    otherWorld.dispatchEvent(new CustomEvent('caviready', { detail: { cavi: {} }, bubbles: true }));
    expect(fn).not.toHaveBeenCalled();

    const own = new Cavi();
    own.setRenderer(fakeRenderer(pendingWorld));
    pendingWorld.dispatchEvent(
      new CustomEvent('caviready', { detail: { cavi: own }, bubbles: true })
    );
    expect(fn).toHaveBeenCalledWith(own);
  });
});

describe('Isolation between worlds', () => {
  it('findSnapTarget never snaps to a jack of another world', () => {
    const a = makeWorld();
    const b = makeWorld();
    const foreignJack = addJack(b.container, 0, 0);
    vi.spyOn(foreignJack, 'getBoundingClientRect').mockReturnValue(rectAt(0, 0));

    const plug = document.createElement('cavi-plug') as Plug;
    a.container.appendChild(plug);
    vi.spyOn(plug, 'getBoundingClientRect').mockReturnValue(rectAt(0, 0));

    expect(Jack.findSnapTarget(plug, 'audio')).toBeNull();

    const ownJack = addJack(a.container, 0, 0);
    expect(Jack.findSnapTarget(plug, 'audio')).toBe(ownJack);
  });

  it("a world's interaction controller ignores pointerdowns on another world's jacks", () => {
    const a = makeWorld();
    const b = makeWorld();
    const jackA = addJack(a.container, 50, 50);
    const jackB = addJack(b.container, 50, 50);
    const createA = vi.spyOn(jackA, 'createCable').mockReturnValue(null);
    const createB = vi.spyOn(jackB, 'createCable').mockReturnValue(null);

    const controller = new StandardInteractionController();
    controller.attach(a.cavi);
    const down = (target: HTMLElement) =>
      target.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 })
      );
    down(jackB);
    down(jackA);
    controller.detach();

    expect(createB).not.toHaveBeenCalled();
    expect(createA).toHaveBeenCalledTimes(1);
  });
});

describe('Plug — DOM move', () => {
  it('stays attached to its jack when moved in the DOM, detaches once really removed', async () => {
    const a = makeWorld();
    Cavi.shared = a.cavi;
    const jack = addJack(a.container, 0, 0);
    const plug = document.createElement('cavi-plug') as Plug;
    a.container.appendChild(plug);
    plug.attach(jack);

    const other = document.createElement('div');
    a.container.appendChild(other);
    other.appendChild(plug);
    await Promise.resolve();
    expect(jack.plugCount).toBe(1);

    plug.remove();
    await Promise.resolve();
    expect(jack.plugCount).toBe(0);
  });
});
