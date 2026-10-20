/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';
import { applyCables, captureCables, type CablesSnapshot } from '../component/cables';

/**
 * Saving the cables of a world as plain data and putting them back
 * (captureCables/applyCables), and the pieces it rests on: cable ids,
 * Plug.connect/disconnect, CaviWireElement.delete. Against the real WASM
 * engine.
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

function makeJack(
  container: HTMLElement,
  id: string,
  x: number,
  y: number,
  attrs: Record<string, string> = {}
): Jack {
  const jack = document.createElement('cavi-jack') as Jack;
  jack.id = id;
  jack.setAttribute('type', 'audio');
  jack.setAttribute('x', String(x));
  jack.setAttribute('y', String(y));
  for (const [name, value] of Object.entries(attrs)) jack.setAttribute(name, value);
  container.appendChild(jack);
  return jack;
}

/** A declarative cable from jack `from` to jack `to` (null: a free end). */
function makeCable(
  container: HTMLElement,
  id: string | null,
  from: string | null,
  to: string | null,
  length = 8
): CaviWireElement {
  const el = document.createElement('cavi-wire') as CaviWireElement;
  if (id) el.id = id;
  el.setAttribute('type', 'audio');
  el.setAttribute('length', String(length));
  for (const [node, jack] of [
    [0, from],
    [length - 1, to],
  ] as const) {
    const plug = document.createElement('cavi-plug');
    plug.setAttribute('node', String(node));
    if (jack) plug.setAttribute('jack', jack);
    el.appendChild(plug);
  }
  container.appendChild(el);
  return el;
}

function plugsOf(el: Element): [Plug, Plug] {
  const plugs = el.querySelectorAll('cavi-plug');
  return [plugs[0] as Plug, plugs[1] as Plug];
}

function cable(container: HTMLElement, id: string): CaviWireElement {
  return container.querySelector(`cavi-wire#${id}`) as CaviWireElement;
}

describe('cable ids', () => {
  it('gives every <cavi-wire> without an id one of its own, and keeps an author id', () => {
    const { container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    makeJack(container, 'b', 600, 100);
    const named = makeCable(container, 'mine', 'a', 'b');
    const anonymous = makeCable(container, null, 'a', 'b');
    const pulled = (container.querySelector('#a') as Jack).createCable(100, 100)!.wireEl;

    expect(named.id).toBe('mine');
    expect(anonymous.id).not.toBe('');
    expect(pulled.id).not.toBe('');
    expect(pulled.id).not.toBe(anonymous.id);
  });
});

describe('Plug.connect / disconnect', () => {
  it('moves a plug to another jack, pinning its node there', () => {
    const { container } = makeWorld();
    const a = makeJack(container, 'a', 100, 100);
    makeJack(container, 'b', 600, 100);
    const c = makeJack(container, 'c', 400, 300);
    const el = makeCable(container, 'w', 'a', 'b');
    const [, end] = plugsOf(el);

    expect(end.connect(c)).toBe(true);
    expect(end.jack).toBe(c);
    expect(end.getAttribute('jack')).toBe('c');
    expect((container.querySelector('#b') as Jack).plugCount).toBe(0);
    expect([end.node!.x, end.node!.y, end.node!.fixed]).toEqual([400, 300, true]);
    expect(a.plugCount).toBe(1);
  });

  it('refuses a full jack or one of another type, changing nothing', () => {
    const { container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    makeJack(container, 'b', 600, 100);
    const full = makeJack(container, 'full', 400, 300, { 'max-plugs': '1' });
    const video = makeJack(container, 'video', 400, 500, { type: 'video' });
    makeCable(container, 'other', 'a', 'full');
    const [, end] = plugsOf(makeCable(container, 'w', 'a', 'b'));

    expect(end.connect(full)).toBe(false);
    expect(end.connect(video)).toBe(false);
    expect(end.jack!.id).toBe('b');
  });

  it('pulls a plug out and lets its end go', () => {
    const { container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    const [, end] = plugsOf(makeCable(container, 'w', 'a', 'b'));

    end.disconnect();
    expect(end.jack).toBe(null);
    expect(end.hasAttribute('jack')).toBe(false);
    expect(end.hasAttribute('plugged')).toBe(false);
    expect(end.node!.fixed).toBe(false);
    expect(b.plugCount).toBe(0);
  });
});

describe('CaviWireElement.delete', () => {
  it('frees its jacks right away, unlike a plain remove()', () => {
    const { container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100, { 'max-plugs': '1' });
    const el = makeCable(container, 'w', 'a', 'b');

    el.delete();
    expect(el.isConnected).toBe(false);
    expect(el.getWire()).toBe(null);
    expect(b.plugCount).toBe(0);
    const [, end] = plugsOf(makeCable(container, 'next', 'a', 'b'));
    expect(end.jack).toBe(b);
  });
});

describe('captureCables', () => {
  it('reads each cable as its jacks and attributes', () => {
    const { cavi, container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    makeJack(container, 'b', 600, 100);
    const el = makeCable(container, 'w', 'a', 'b', 12);
    el.setAttribute('color', '#ff0000');
    el.setAttribute('render-type', 'segments');

    expect(captureCables(cavi)).toEqual({
      version: 1,
      wires: [
        {
          id: 'w',
          ends: ['a', 'b'],
          type: 'audio',
          color: '#ff0000',
          length: 12,
          renderType: 'segments',
        },
      ],
    });
  });

  it('reads a free end as null, and leaves out a cable plugged into nothing', () => {
    const { cavi, container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    makeCable(container, 'half', 'a', null);
    makeCable(container, 'none', null, null);

    expect(captureCables(cavi).wires.map((w) => [w.id, w.ends])).toEqual([['half', ['a', null]]]);
  });

  it('reads a cable pulled out of a jack, its length as grown', () => {
    const { cavi, container } = makeWorld();
    const a = makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    const session = a.createCable(100, 100)!;
    Jack.updateCableSession(session, 600, 100);
    vi.spyOn(Jack, 'findSnapTarget').mockReturnValue(b);
    Jack.finishCableSession(session);

    const [state] = captureCables(cavi).wires;
    expect(state!.id).toBe(session.wireEl.id);
    expect(state!.ends).toEqual(['a', 'b']);
    expect(state!.length).toBe(session.wire.getNodeCount());
  });

  it('counts an end in a jack just removed as free already', () => {
    const { cavi, container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100);
    makeCable(container, 'w', 'a', 'b');

    b.remove(); // its plugs are let go a microtask later
    expect(captureCables(cavi).wires[0]!.ends).toEqual(['a', null]);
  });

  it('only reads the cables of its own world', () => {
    const one = makeWorld();
    const two = makeWorld();
    makeJack(one.container, 'a', 100, 100);
    makeJack(two.container, 'a', 100, 100);
    makeCable(one.container, 'w1', 'a', null);
    makeCable(two.container, 'w2', 'a', null);

    expect(captureCables(one.cavi).wires.map((w) => w.id)).toEqual(['w1']);
  });
});

describe('applyCables', () => {
  /** A world with jacks a, b, c and cable w from a to b. */
  function setup() {
    const world = makeWorld();
    const jacks = {
      a: makeJack(world.container, 'a', 100, 100),
      b: makeJack(world.container, 'b', 600, 100),
      c: makeJack(world.container, 'c', 400, 300),
    };
    makeCable(world.container, 'w', 'a', 'b');
    return { ...world, ...jacks };
  }

  it('puts back cables deleted since, from a JSON round trip', () => {
    const { cavi, container, a, b } = setup();
    const saved = JSON.stringify(captureCables(cavi));

    cable(container, 'w').delete();
    expect(a.plugCount).toBe(0);
    applyCables(cavi, JSON.parse(saved));

    const el = cable(container, 'w');
    expect(el.getWire()).not.toBe(null);
    expect(plugsOf(el).map((p) => p.jack)).toEqual([a, b]);
    expect(captureCables(cavi)).toEqual(JSON.parse(saved));
  });

  it('leaves a cable that did not change alone, physics state and all', () => {
    const { cavi, container } = setup();
    const before = cable(container, 'w').getWire();
    const node = before!.getNode(3)!;
    node.setPosition(321, 123);

    applyCables(cavi, captureCables(cavi));

    expect(cable(container, 'w').getWire()).toBe(before);
    expect([node.x, node.y]).toEqual([321, 123]);
  });

  it('moves only the end that changed jack', () => {
    const { cavi, container, a, b, c } = setup();
    const before = cable(container, 'w').getWire();

    applyCables(cavi, { version: 1, wires: [{ id: 'w', ends: ['a', 'c'], type: 'audio' }] });

    const el = cable(container, 'w');
    expect(el.getWire()).toBe(before);
    expect(plugsOf(el).map((p) => p.jack)).toEqual([a, c]);
    expect(b.plugCount).toBe(0);
  });

  it('updates the attributes of a cable it keeps, live', () => {
    const { cavi, container } = setup();
    const el = cable(container, 'w');

    applyCables(cavi, {
      version: 1,
      wires: [{ id: 'w', ends: ['a', 'b'], type: 'audio', color: '#00ffff', length: 14 }],
    });

    expect(el.getWire()!.getColor()).toBe('#00ffff');
    expect(el.getWire()!.getNodeCount()).toBe(14);
    expect(plugsOf(el)[1].getAttribute('node')).toBe('13');
  });

  it('deletes cables the snapshot does not have', () => {
    const { cavi, container, a } = setup();

    applyCables(cavi, { version: 1, wires: [] });

    expect(container.querySelector('cavi-wire')).toBe(null);
    expect(a.plugCount).toBe(0);
  });

  it('hands a jack at max-plugs over to the cable that takes it', () => {
    const { cavi, container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100, { 'max-plugs': '1' });
    makeCable(container, 'old', 'a', 'b');

    applyCables(cavi, { version: 1, wires: [{ id: 'new', ends: ['a', 'b'], type: 'audio' }] });

    expect(cable(container, 'old')).toBe(null);
    expect(plugsOf(cable(container, 'new'))[1].jack).toBe(b);
  });

  it('swaps two cables between jacks at max-plugs', () => {
    const { cavi, container } = makeWorld();
    makeJack(container, 'a', 100, 100);
    const b = makeJack(container, 'b', 600, 100, { 'max-plugs': '1' });
    const c = makeJack(container, 'c', 400, 300, { 'max-plugs': '1' });
    makeCable(container, 'x', 'a', 'b');
    makeCable(container, 'y', 'a', 'c');

    applyCables(cavi, {
      version: 1,
      wires: [
        { id: 'x', ends: ['a', 'c'], type: 'audio' },
        { id: 'y', ends: ['a', 'b'], type: 'audio' },
      ],
    });

    expect(plugsOf(cable(container, 'x'))[1].jack).toBe(c);
    expect(plugsOf(cable(container, 'y'))[1].jack).toBe(b);
  });

  it('leaves free an end whose jack is not there, and skips a cable with neither', () => {
    const { cavi, container, a } = setup();

    applyCables(cavi, {
      version: 1,
      wires: [
        { id: 'w', ends: ['a', 'gone'], type: 'audio' },
        { id: 'ghost', ends: ['gone', 'also-gone'], type: 'audio' },
      ],
    });

    const [first, end] = plugsOf(cable(container, 'w'));
    expect(first.jack).toBe(a);
    expect(end.jack).toBe(null);
    expect(end.node!.fixed).toBe(false);
    expect(cable(container, 'ghost')).toBe(null);
  });

  it('hangs a restored free end straight down from the end plugged in', () => {
    const { cavi, container } = setup();

    applyCables(cavi, {
      version: 1,
      wires: [{ id: 'hanging', ends: ['c', null], type: 'audio', length: 6, tension: 20 }],
    });

    const wire = cable(container, 'hanging').getWire()!;
    expect([wire.getNodeX(5), wire.getNodeY(5)]).toEqual([400, 300 + 5 * 20]);
    expect(wire.getNode(5)!.fixed).toBe(false);
    // Not in the snapshot, so gone.
    expect(cable(container, 'w')).toBe(null);
  });

  it('rejects anything but a version 1 snapshot', () => {
    const { cavi } = setup();
    expect(() => applyCables(cavi, { version: 2, wires: [] } as unknown as CablesSnapshot)).toThrow(
      /version 1/
    );
  });
});
