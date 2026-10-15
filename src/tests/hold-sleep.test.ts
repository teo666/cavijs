/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import { World } from '../core/world';
import type { IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';

/**
 * Held wire (World.holdWire, driven by plug drags and cable creation) and
 * sleeping of still wires, against the real WASM engine.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
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

function makeWireEl(container: HTMLElement): CaviWireElement {
  const wireEl = document.createElement('cavi-wire') as CaviWireElement;
  wireEl.setAttribute('length', '4');
  for (const node of ['0', '3']) {
    const plug = document.createElement('cavi-plug');
    plug.setAttribute('node', node);
    wireEl.appendChild(plug);
  }
  container.appendChild(wireEl);
  return wireEl;
}

describe('held wire', () => {
  it('is held while one of its plugs is dragged', () => {
    const { cavi, container } = makeWorld();
    makeWireEl(container);
    const wireEl = makeWireEl(container);
    const plug = wireEl.querySelectorAll('cavi-plug')[1] as Plug;
    const world = cavi.getWorld();

    plug.beginDrag();
    expect(world.getHeldWire()).toBe(wireEl.getWire());
    plug.endDrag();
    expect(world.getHeldWire()).toBeNull();

    plug.beginDrag();
    plug.cancelDrag();
    expect(world.getHeldWire()).toBeNull();
  });

  it('is held while a new cable is pulled out of a jack', () => {
    const { cavi, container } = makeWorld();
    const jack = document.createElement('cavi-jack') as Jack;
    jack.setAttribute('type', 'audio');
    container.appendChild(jack);

    const session = jack.createCable(50, 50)!;
    expect(cavi.getWorld().getHeldWire()).toBe(session.wire);
    Jack.finishCableSession(session);
    expect(cavi.getWorld().getHeldWire()).toBeNull();
  });

  it('is only released by the gesture holding it', () => {
    const world = new World();
    const a = world.addWire(0, 0, 100, 0, 4, 20, 4);
    const b = world.addWire(0, 50, 100, 50, 4, 20, 4);
    world.holdWire(a);
    world.releaseHeldWire(b);
    expect(world.getHeldWire()).toBe(a);
    world.releaseHeldWire();
    expect(world.getHeldWire()).toBeNull();
  });

  it('follows its wire when an earlier wire is deleted', () => {
    const world = new World();
    world.addWire(0, 0, 100, 0, 4, 20, 4);
    const b = world.addWire(0, 50, 100, 50, 4, 20, 4);
    world.holdWire(b);
    world.deleteWire(0);
    expect(world.getHeldWire()).toBe(b);
  });
});

describe('sleeping', () => {
  /** A straight, gravity-free wire, still from the first step. */
  function restingWorld(): { world: World; wire: ReturnType<World['addWire']> } {
    const world = new World();
    world.setAcceleration(0, 0);
    const wire = world.addWire(0, 0, 100, 0, 5, 25, 4);
    return { world, wire };
  }

  it('puts a still wire to sleep after getSleepSteps() steps, and wakes it on changes', () => {
    const { world, wire } = restingWorld();
    expect(world.getSleepEnabled()).toBe(true);
    for (let i = 0; i < world.getSleepSteps(); i++) world.update();
    expect(wire.isSleeping()).toBe(true);
    expect(world.getSleepingWireCount()).toBe(1);

    world.setAcceleration(0, 5);
    world.update();
    expect(wire.isSleeping()).toBe(false);
  });

  it('can be turned off', () => {
    const { world, wire } = restingWorld();
    world.setSleepEnabled(false);
    for (let i = 0; i < 100; i++) world.update();
    expect(wire.isSleeping()).toBe(false);
  });

  it('wakes a wire when one of its plugs is released', () => {
    const { world, wire } = restingWorld();
    for (let i = 0; i < 40; i++) world.update();
    expect(wire.isSleeping()).toBe(true);
    wire.getNode(4)!.fixed = false;
    world.update();
    expect(wire.isSleeping()).toBe(false);
  });
});

describe('link distance', () => {
  it('is separate from the radius', () => {
    const world = new World();
    const wire = world.addWire(0, 0, 100, 0, 5, 25, 4);
    wire.setRadius(10);
    expect(wire.getLinkDistance()).toBe(25);
    wire.setLinkDistance(30);
    expect(wire.getLinkDistance()).toBe(30);
    expect(wire.getRadius()).toBe(10);
  });
});
