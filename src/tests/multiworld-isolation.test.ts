/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IInteractionController, IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';
import { CaviInteractionElement } from '../component/interactionwc';

/**
 * Several worlds on one page never step on each other: readiness, jack
 * lookup by id, pointer/drag state, interaction controllers. Real WASM.
 */
beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
  Jack._resetInteractionState();
  vi.restoreAllMocks();
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

/** A ready world whose container is a (plain, undefined) <cavi-world> element. */
function makeWorld(): { cavi: Cavi; container: HTMLElement } {
  const container = document.createElement('cavi-world');
  document.body.appendChild(container);
  const cavi = new Cavi();
  cavi.setRenderer(fakeRenderer(container));
  return { cavi, container };
}

function makeJack(parent: Node, id: string, attrs: Record<string, string> = {}): Jack {
  const jack = document.createElement('cavi-jack') as Jack;
  jack.id = id;
  for (const [k, v] of Object.entries(attrs)) jack.setAttribute(k, v);
  parent.appendChild(jack);
  return jack;
}

function makeCable(parent: Node, startJack: string, endJack?: string): CaviWireElement {
  const wireEl = document.createElement('cavi-wire') as CaviWireElement;
  wireEl.setAttribute('length', '4');
  for (const [node, jack] of [
    ['0', startJack],
    ['3', endJack],
  ]) {
    const plug = document.createElement('cavi-plug');
    plug.setAttribute('node', node!);
    if (jack) plug.setAttribute('jack', jack);
    wireEl.appendChild(plug);
  }
  parent.appendChild(wireEl);
  return wireEl;
}

const plugsOf = (wireEl: CaviWireElement) =>
  [...wireEl.querySelectorAll('cavi-plug')] as unknown as Plug[];

describe('Cavi.whenReady', () => {
  it('waits for its own world across shadow roots, ignoring other worlds getting ready', () => {
    const a = document.createElement('cavi-world');
    const b = document.createElement('cavi-world');
    document.body.append(a, b);
    const host = document.createElement('div');
    b.appendChild(host);
    const el = document.createElement('div');
    host.attachShadow({ mode: 'open' }).appendChild(el);
    const fn = vi.fn();

    Cavi.whenReady(el, fn);

    const cavi = new Cavi(); // world A gets ready first
    cavi.setRenderer(fakeRenderer(a));
    a.dispatchEvent(new CustomEvent('caviready', { detail: { cavi }, bubbles: true }));
    expect(fn).not.toHaveBeenCalled();

    const cavb = new Cavi();
    cavb.setRenderer(fakeRenderer(b));
    b.dispatchEvent(new CustomEvent('caviready', { detail: { cavi: cavb }, bubbles: true }));
    expect(fn).toHaveBeenCalledExactlyOnceWith(cavb);
  });
});

describe('jack="id"', () => {
  it("plugs into its own world's jack when another world has one with the same id", () => {
    const a = makeWorld();
    const b = makeWorld();
    const jackA = makeJack(a.container, 'j1');
    const jackB = makeJack(b.container, 'j1');

    const cable = makeCable(b.container, 'j1');

    expect(plugsOf(cable)[0]!.jack).toBe(jackB);
    expect(jackA.plugCount).toBe(0);
  });

  it('finds a jack inside a shadow root', () => {
    const { container } = makeWorld();
    const host = document.createElement('div');
    container.appendChild(host);
    const jack = makeJack(host.attachShadow({ mode: 'open' }), 'deep');

    const cable = makeCable(container, 'deep');

    expect(plugsOf(cable)[0]!.jack).toBe(jack);
  });

  it('plugs in a jack inserted after its cable, on the next frame', () => {
    const { cavi, container } = makeWorld();
    const cable = makeCable(container, 'late');
    expect(plugsOf(cable)[0]!.jack).toBeNull();

    const jack = makeJack(container, 'late', { x: '40', y: '60' });
    cavi.getWorld().runFrameTasks();

    expect(plugsOf(cable)[0]!.jack).toBe(jack);
    const wire = cable.getWire()!;
    expect([wire.getNodeX(0), wire.getNodeY(0)]).toEqual([40, 60]);
    expect(wire.getNode(0)!.fixed).toBe(true);
  });

  it('leaves a plug unplugged rather than overfilling a full jack', () => {
    const { container } = makeWorld();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const jack = makeJack(container, 'one', { 'max-plugs': '1' });
    makeCable(container, 'one');

    const second = makeCable(container, 'one');

    expect(jack.plugCount).toBe(1);
    expect(plugsOf(second)[0]!.jack).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already full'));
  });
});

describe('pointer and drag state', () => {
  /** A full jack (max-plugs 1, one plug) at (50, 50) in a new world. */
  function fullJack() {
    const world = makeWorld();
    const jack = makeJack(world.container, `full${Math.random()}`, {
      x: '50',
      y: '50',
      'max-plugs': '1',
    });
    jack.attach({
      unplug() {},
      getBoundingClientRect: () => new DOMRect(9999, 9999, 0, 0),
      setSpreadPosition() {},
      snapToJack() {},
      getOtherEndCenter: () => null,
    } as unknown as Plug);
    return { ...world, jack };
  }

  it('is kept per world: a drag in one world leaves the other alone', () => {
    const a = fullJack();
    const b = fullJack();
    Jack.setPointerHoverPosition(50, 50, a.cavi);
    Jack.setPointerHoverPosition(50, 50, b.cavi);

    Jack.setDragActive(true, a.cavi);

    expect(a.jack.classList.contains('cavi-jack-full')).toBe(true);
    expect(b.jack.classList.contains('cavi-jack-full')).toBe(false);

    Jack.setDragActive(false, a.cavi);
    expect(a.jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('only measures the jacks of the world it is for', () => {
    const a = fullJack();
    const b = fullJack();
    const measureA = vi.spyOn(a.jack, 'getBoundingClientRect');
    const measureB = vi.spyOn(b.jack, 'getBoundingClientRect');

    Jack.setPointerHoverPosition(10, 10, a.cavi);

    expect(measureA).toHaveBeenCalled();
    expect(measureB).not.toHaveBeenCalled();
  });

  it('without a world, still applies to every world', () => {
    const a = fullJack();
    const b = fullJack();
    Jack.setPointerHoverPosition(50, 50);
    Jack.setDragActive(true);

    expect(a.jack.classList.contains('cavi-jack-full')).toBe(true);
    expect(b.jack.classList.contains('cavi-jack-full')).toBe(true);
    Jack.setDragActive(false);
  });
});

describe('<cavi-interaction>', () => {
  function element(): { el: CaviInteractionElement; controller: IInteractionController } {
    const el = document.createElement('cavi-interaction') as CaviInteractionElement;
    const controller = { attach: vi.fn(), detach: vi.fn() };
    el.controller = controller;
    return { el, controller };
  }

  it('lets a single controller drive a world: a second one stays inactive', () => {
    const { cavi, container } = makeWorld();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = element();
    const second = element();

    container.appendChild(first.el);
    container.appendChild(second.el);

    expect(first.controller.attach).toHaveBeenCalledWith(cavi);
    expect(second.controller.attach).not.toHaveBeenCalled();
    expect(CaviInteractionElement.attachedTo(cavi)).toBe(first.el);

    first.el.remove();
    expect(CaviInteractionElement.attachedTo(cavi)).toBeNull();
  });
});
