/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';
import { applyCables, captureCables } from '../component/cables';
import { CaviHistory } from '../component/history';

/**
 * The `cavi-change` event at the end of every gesture, and CaviHistory's
 * undo/redo on top of it. Against the real WASM engine.
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

function makeCable(container: HTMLElement, id: string, from: string, to: string): CaviWireElement {
  const el = document.createElement('cavi-wire') as CaviWireElement;
  el.id = id;
  el.setAttribute('type', 'audio');
  el.setAttribute('length', '8');
  for (const [node, jack] of [
    [0, from],
    [7, to],
  ] as const) {
    const plug = document.createElement('cavi-plug');
    plug.setAttribute('node', String(node));
    plug.setAttribute('jack', jack);
    el.appendChild(plug);
  }
  container.appendChild(el);
  return el;
}

function endOf(container: HTMLElement, id: string): Plug {
  return container.querySelectorAll(`cavi-wire#${id} cavi-plug`)[1] as Plug;
}

/** Drags `plug` and drops it on `jack` (null: in empty space), as a controller would. */
function movePlug(plug: Plug, jack: Jack | null): void {
  plug.beginDrag();
  if (jack) plug.endDragAt(jack);
  else plug.cancelDrag();
}

/** Lets microtasks — CaviHistory records a gesture one later — and timers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

/** A world with jacks a, b, c, d and cable w from a to b. */
function setup() {
  const world = makeWorld();
  const jacks = {
    a: makeJack(world.container, 'a', 100, 100),
    b: makeJack(world.container, 'b', 600, 100),
    c: makeJack(world.container, 'c', 400, 300),
    d: makeJack(world.container, 'd', 200, 300),
  };
  makeCable(world.container, 'w', 'a', 'b');
  return { ...world, ...jacks };
}

describe('cavi-change', () => {
  function listen(container: HTMLElement): string[] {
    const seen: string[] = [];
    for (const name of ['cavi-change', 'cavi-cable-end']) {
      container.addEventListener(name, (e) => {
        const detail = (e as CustomEvent).detail;
        seen.push(name === 'cavi-change' ? `${name}:${detail.cause}` : name);
      });
    }
    return seen;
  }

  it('fires when a plug is dropped, on a jack or not', () => {
    const { container, c } = setup();
    const seen = listen(container);

    movePlug(endOf(container, 'w'), c);
    movePlug(endOf(container, 'w'), null);

    expect(seen).toEqual(['cavi-change:plug-drop', 'cavi-change:plug-drop']);
  });

  it('fires right after cavi-cable-end, whatever the result', () => {
    const { container, a, c } = setup();
    const seen = listen(container);

    const session = a.createCable(100, 100)!;
    vi.spyOn(Jack, 'findSnapTarget').mockReturnValue(c);
    Jack.finishCableSession(session);
    Jack.discardCableSession(a.createCable(100, 100)!);

    expect(seen).toEqual([
      'cavi-cable-end',
      'cavi-change:cable-end',
      'cavi-cable-end',
      'cavi-change:cable-end',
    ]);
  });

  it('does not fire for changes made from code', () => {
    const { cavi, container, c } = setup();
    const seen = listen(container);
    const snapshot = captureCables(cavi);

    endOf(container, 'w').connect(c);
    endOf(container, 'w').disconnect();
    applyCables(cavi, snapshot);

    expect(seen).toEqual([]);
  });
});

describe('CaviHistory', () => {
  it('starts with nothing to undo, and records nothing that did not change', async () => {
    const { cavi } = setup();
    const history = new CaviHistory(cavi);

    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    expect(history.commit()).toBe(false);
    expect(await history.undo()).toBe(false);
  });

  it('records a gesture, and undoes and redoes it', async () => {
    const { cavi, container, b, c } = setup();
    const history = new CaviHistory(cavi);

    movePlug(endOf(container, 'w'), c);
    await settle();
    expect(history.canUndo).toBe(true);

    expect(await history.undo()).toBe(true);
    expect(endOf(container, 'w').jack).toBe(b);
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);

    expect(await history.redo()).toBe(true);
    expect(endOf(container, 'w').jack).toBe(c);
  });

  it('records nothing for a gesture that put things back as they were', async () => {
    const { cavi, container, b } = setup();
    const history = new CaviHistory(cavi);

    movePlug(endOf(container, 'w'), b);
    await settle();

    expect(history.canUndo).toBe(false);
  });

  it('drops the steps undone once a new one is recorded', async () => {
    const { cavi, container, c, d } = setup();
    const history = new CaviHistory(cavi);
    movePlug(endOf(container, 'w'), c);
    await settle();
    await history.undo();

    movePlug(endOf(container, 'w'), d);
    await settle();

    expect(history.canRedo).toBe(false);
    await history.undo();
    expect(endOf(container, 'w').jack!.id).toBe('b');
  });

  it('waits for every gesture in progress to end before recording', async () => {
    const { cavi, container, c, d } = setup();
    makeCable(container, 'v', 'a', 'd');
    const history = new CaviHistory(cavi);

    // Two fingers: v's plug is being dragged while w's is dropped on c.
    Jack.setDragActive(true, cavi);
    endOf(container, 'v').beginDrag();
    movePlug(endOf(container, 'w'), c);
    await settle();
    expect(history.canUndo).toBe(false);

    endOf(container, 'v').endDragAt(d);
    Jack.setDragActive(false, cavi);
    await settle();
    expect(history.canUndo).toBe(true);
  });

  it('refuses to undo while a gesture is in progress', async () => {
    const { cavi, container, c } = setup();
    const history = new CaviHistory(cavi);
    movePlug(endOf(container, 'w'), c);
    await settle();

    Jack.setDragActive(true, cavi);
    expect(await history.undo()).toBe(false);
    Jack.setDragActive(false, cavi);
    expect(await history.undo()).toBe(true);
  });

  it('undoes a change not recorded yet before anything else', async () => {
    const { cavi, container, b, c } = setup();
    const history = new CaviHistory(cavi);

    endOf(container, 'w').connect(c); // from code: no cavi-change, no commit

    expect(await history.undo()).toBe(true);
    expect(endOf(container, 'w').jack).toBe(b);
  });

  it('keeps no step for a cable put back by undo coming last in the page', async () => {
    const { cavi, container } = setup();
    makeCable(container, 'v', 'c', 'd');
    makeCable(container, 'u', 'a', 'd');
    const history = new CaviHistory(cavi);

    container.querySelector<CaviWireElement>('cavi-wire#v')!.delete();
    history.commit();
    await history.undo();

    expect(container.querySelector('cavi-wire:last-of-type')!.id).toBe('v');
    expect(history.commit()).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('folds everything done inside batch() into one step', async () => {
    const { cavi, container, c, d } = setup();
    const history = new CaviHistory(cavi);

    history.batch(() => {
      endOf(container, 'w').connect(c);
      history.commit();
      endOf(container, 'w').connect(d);
    });

    expect(endOf(container, 'w').jack).toBe(d);
    await history.undo();
    expect(endOf(container, 'w').jack!.id).toBe('b');
    expect(history.canUndo).toBe(false);
  });

  it('records an async batch once it settles', async () => {
    const { cavi, container, c } = setup();
    const history = new CaviHistory(cavi);

    const done = history.batch(async () => {
      await settle();
      endOf(container, 'w').connect(c);
    });
    expect(history.canUndo).toBe(false);
    await done;
    expect(history.canUndo).toBe(true);
  });

  describe('with the page state', () => {
    /** A page whose state is the list of jacks it has, rebuilt by restore(). */
    function page(container: HTMLElement) {
      const positions: Record<string, [number, number]> = {
        a: [100, 100],
        b: [600, 100],
        c: [400, 300],
        d: [200, 300],
      };
      const order: string[] = [];
      const app = {
        capture: () => Array.from(container.querySelectorAll('cavi-jack')).map((j) => j.id),
        restore: async (ids: string[]) => {
          await settle(); // a framework rendering on its next tick
          for (const jack of container.querySelectorAll('cavi-jack')) {
            if (!ids.includes(jack.id)) jack.remove();
          }
          for (const id of ids) {
            if (!container.querySelector(`cavi-jack#${id}`)) {
              makeJack(container, id, ...positions[id]!);
            }
          }
          order.push(`restore, w plugged: ${endOf(container, 'w')?.jack?.id ?? 'no'}`);
        },
      };
      return { app, order };
    }

    it('puts the jacks back before the cables that need them', async () => {
      const { cavi, container, b } = setup();
      const { app, order } = page(container);
      const history = new CaviHistory(cavi, { app });

      // The page removes a module: its jack and, with it, the cable's end.
      history.batch(() => b.remove());
      await settle();
      expect(endOf(container, 'w').jack).toBe(null);

      expect(await history.undo()).toBe(true);
      expect(order).toEqual(['restore, w plugged: no']);
      const jack = container.querySelector<Jack>('cavi-jack#b')!;
      expect(jack).not.toBe(b);
      expect(endOf(container, 'w').jack).toBe(jack);

      expect(await history.redo()).toBe(true);
      expect(container.querySelector('cavi-jack#b')).toBe(null);
      expect(endOf(container, 'w').jack).toBe(null);
    });

    it('hands restore() a copy: changing what capture() returned later changes no entry', async () => {
      const { cavi, container, c } = setup();
      const state = { tag: 'first' };
      const restored: unknown[] = [];
      const history = new CaviHistory(cavi, {
        app: { capture: () => state, restore: (s) => void restored.push(s) },
      });

      state.tag = 'changed';
      endOf(container, 'w').connect(c);
      history.commit();
      await history.undo();

      expect(restored).toEqual([{ tag: 'first' }]);
      expect(restored[0]).not.toBe(state);
    });
  });

  it('loads a saved state as a step of its own', async () => {
    const { cavi, container, b, c } = setup();
    const history = new CaviHistory(cavi);
    const saved = JSON.stringify(history.capture());

    endOf(container, 'w').connect(c);
    history.commit();
    expect(await history.load(JSON.parse(saved))).toBe(true);

    expect(endOf(container, 'w').jack).toBe(b);
    await history.undo();
    expect(endOf(container, 'w').jack).toBe(c);
  });

  it('keeps at most `limit` steps to undo', async () => {
    const { cavi, container, a, c, d } = setup();
    const history = new CaviHistory(cavi, { limit: 2 });

    for (const jack of [c, d, a]) {
      endOf(container, 'w').connect(jack);
      history.commit();
    }

    expect(await history.undo()).toBe(true);
    expect(await history.undo()).toBe(true);
    expect(await history.undo()).toBe(false);
    expect(endOf(container, 'w').jack).toBe(c);
  });

  it('dispatches change whenever canUndo/canRedo may have changed', async () => {
    const { cavi, container, c } = setup();
    const history = new CaviHistory(cavi);
    const onChange = vi.fn();
    history.addEventListener('change', onChange);

    endOf(container, 'w').connect(c);
    history.commit();
    await history.undo();
    await history.redo();
    history.clear();

    expect(onChange).toHaveBeenCalledTimes(4);
    expect(history.canUndo).toBe(false);
  });

  it('runs undo calls one after the other', async () => {
    const { cavi, container, b, c, d } = setup();
    const history = new CaviHistory(cavi);
    for (const jack of [c, d]) {
      endOf(container, 'w').connect(jack);
      history.commit();
    }

    const results = await Promise.all([history.undo(), history.undo(), history.undo()]);

    expect(results).toEqual([true, true, false]);
    expect(endOf(container, 'w').jack).toBe(b);
  });

  it('stops recording once destroyed', async () => {
    const { cavi, container, c } = setup();
    const history = new CaviHistory(cavi);
    history.destroy();

    movePlug(endOf(container, 'w'), c);
    await settle();

    expect(history.canUndo).toBe(false);
    expect(history.commit()).toBe(false);
  });
});
