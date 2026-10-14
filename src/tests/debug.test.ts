/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import init from 'cavi';
import { Cavi } from '../core/cavi';
import type { IRenderer } from '../core/types';
import { Jack } from '../component/jack';
import { Plug } from '../component/plug';
import { CaviDebugElement } from '../debug/debugwc';
import { collectStats } from '../debug/stats';
import { describeDetail } from '../debug/format';

beforeAll(async () => {
  await init({ module_or_path: readFileSync('node_modules/cavi/cavi_bg.wasm') });
});

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
  localStorage.clear();
});

function makeWorld(): { cavi: Cavi; container: HTMLElement } {
  const container = document.createElement('div');
  container.id = 'world';
  document.body.appendChild(container);
  const cavi = new Cavi();
  const renderer: IRenderer & { getFPS(): number } = {
    render() {},
    stop() {},
    setDebugDrawNodes() {},
    getDebugDrawNodes: () => false,
    getContainer: () => container,
    getFPS: () => 58,
  };
  cavi.setRenderer(renderer);
  return { cavi, container };
}

function makeJack(parent: HTMLElement, id: string): Jack {
  const jack = document.createElement('cavi-jack') as Jack;
  jack.id = id;
  parent.appendChild(jack);
  return jack;
}

function makePlug(parent: HTMLElement): Plug {
  const plug = document.createElement('cavi-plug') as Plug;
  parent.appendChild(plug);
  return plug;
}

/** Waits for <cavi-debug>'s rAF-batched log render. */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe('domain events', () => {
  it('dispatches cavi-plug-attach/-detach on the world container', () => {
    const { container } = makeWorld();
    const jack = makeJack(container, 'j1');
    const plug = makePlug(container);
    const seen: string[] = [];
    container.addEventListener('cavi-plug-attach', (e) => {
      const { plug: p, jack: j } = (e as CustomEvent).detail;
      seen.push(`attach ${p === plug} ${j === jack}`);
    });
    container.addEventListener('cavi-plug-detach', () => seen.push('detach'));

    plug.attach(jack);
    plug.attach(jack); // already attached: no duplicate event
    plug.detach();
    plug.detach(); // already detached: no event

    expect(seen).toEqual(['attach true true', 'detach']);
  });

  it('emits a detach for the old jack when a plug moves to another one', () => {
    const { container } = makeWorld();
    const a = makeJack(container, 'a');
    const b = makeJack(container, 'b');
    const plug = makePlug(container);
    const seen: string[] = [];
    for (const type of ['cavi-plug-attach', 'cavi-plug-detach']) {
      container.addEventListener(type, (e) =>
        seen.push(`${type} ${(e as CustomEvent).detail.jack.id}`)
      );
    }

    plug.attach(a);
    plug.attach(b);

    expect(seen).toEqual(['cavi-plug-attach a', 'cavi-plug-detach a', 'cavi-plug-attach b']);
  });

  it('bubbles from the jack itself when there is no world', () => {
    const jack = makeJack(document.body, 'lonely');
    const plug = makePlug(document.body);
    let target: EventTarget | null = null;
    document.addEventListener('cavi-plug-attach', (e) => (target = e.target), { once: true });

    plug.attach(jack);

    expect(target).toBe(jack);
  });
});

describe('collectStats', () => {
  it('counts wires, nodes, free ends, jacks and plugs of its own world only', () => {
    const { cavi, container } = makeWorld();
    const other = makeWorld();
    const w1 = cavi.addWire(0, 0, 100, 0, 5, 20, 4);
    const w2 = cavi.addWire(0, 50, 300, 50, 9, 20, 6);
    // New wires start with both ends fixed: leave only w1's start fixed.
    w1.getNode(4)!.fixed = false;
    w2.getNode(0)!.fixed = false;
    w2.getNode(8)!.fixed = false;
    w1.setColor('#ff0000');
    const jack = makeJack(container, 'j');
    makeJack(other.container, 'elsewhere');
    makePlug(container).attach(jack);
    makePlug(container);

    const stats = collectStats(cavi);

    expect(stats.fps).toBe(58);
    expect(stats.wires).toBe(2);
    expect(stats.nodes).toBe(14);
    expect(stats.minNodes).toBe(5);
    expect(stats.maxNodes).toBe(9);
    expect(stats.freeEnds).toBe(3);
    expect(stats.orphanWires).toBe(1);
    expect(stats.jacks).toBe(1);
    expect(stats.plugs).toBe(2);
    expect(stats.pluggedPlugs).toBe(1);
    expect(stats.wireList[0]).toMatchObject({
      index: 0,
      nodes: 5,
      color: '#ff0000',
      startFixed: true,
      endFixed: false,
    });
    expect(stats.wireList[0].length).toBeGreaterThan(0);
    expect(stats.bufferBytes % 4).toBe(0);
  });
});

describe('describeDetail', () => {
  it('summarizes elements, wires, numbers and nested objects', () => {
    const el = document.createElement('cavi-jack');
    el.id = 'in1';
    const wire = { getIndex: () => 3, getNodeCount: () => 10 };
    expect(describeDetail({ jack: el, wire, k: 1.23456, size: { w: 10, h: 2.5 } })).toBe(
      'jack: <cavi-jack#in1>  wire: wire#3  k: 1.23  size: {w: 10, h: 2.50}'
    );
    expect(describeDetail(undefined)).toBe('');
  });
});

describe('<cavi-debug>', () => {
  function makeDebug(attrs: Record<string, string> = {}): CaviDebugElement {
    const el = document.createElement('cavi-debug');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  }

  function logText(el: CaviDebugElement): string[] {
    return [...el.shadowRoot!.querySelectorAll('#log li:not(.empty) .name')].map(
      (li) => li.textContent ?? ''
    );
  }

  it('binds to the world named by `for` and logs its events, coalescing bursts', async () => {
    const { cavi, container } = makeWorld();
    const debug = makeDebug({ for: 'world', open: '' });
    container.dispatchEvent(new CustomEvent('cavi-resize', { bubbles: true }));
    container.dispatchEvent(new CustomEvent('cavi-resize', { bubbles: true }));
    cavi.notifyCoordinateTransformChanged();
    await nextFrame();

    expect(debug.cavi).toBe(cavi);
    expect(logText(debug)).toEqual(['cavi-transform-change', 'cavi-resize ×2']);
    expect(debug.shadowRoot!.getElementById('wires')!.textContent).toBe('0');
  });

  it('keeps distinct events of the same name as separate entries', async () => {
    const { container } = makeWorld();
    const debug = makeDebug({ for: 'world' });
    const a = makeJack(container, 'a');
    const b = makeJack(container, 'b');
    makePlug(container).attach(a);
    makePlug(container).attach(b);
    await nextFrame();

    expect(logText(debug)).toEqual(['cavi-plug-attach', 'cavi-plug-attach']);
  });

  it('waits for a `for` world that is not ready yet', () => {
    const debug = makeDebug({ for: 'later' });
    const world = document.createElement('div');
    world.id = 'later';
    document.body.appendChild(world);
    const cavi = new Cavi();
    world.dispatchEvent(new CustomEvent('caviready', { detail: { cavi }, bubbles: true }));

    expect(debug.cavi).toBe(cavi);
  });

  it('logs extra `events`, manual entries, and clears', async () => {
    const { container } = makeWorld();
    const debug = makeDebug({ for: 'world', events: 'my-app-event' });
    container.dispatchEvent(new CustomEvent('my-app-event', { detail: { n: 1 } }));
    debug.log('note', 'hello');
    await nextFrame();
    expect(logText(debug)).toEqual(['note', 'my-app-event']);

    debug.clearLog();
    await nextFrame();
    expect(logText(debug)).toEqual([]);
  });

  it('toggles open with the hotkey, but not while typing', () => {
    const debug = makeDebug({ hotkey: 'alt+shift+d' });
    const press = (target: EventTarget) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'D',
          code: 'KeyD',
          altKey: true,
          shiftKey: true,
          bubbles: true,
        })
      );

    press(document.body);
    expect(debug.open).toBe(true);

    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input);
    expect(debug.open).toBe(true);

    press(document.body);
    expect(debug.open).toBe(false);
  });

  it('shows the launcher only while closed', () => {
    const debug = makeDebug();
    const win = debug.shadowRoot!.getElementById('window')!;
    const launcher = debug.shadowRoot!.getElementById('launcher')!;
    expect(win.hidden).toBe(true);
    expect(launcher.hidden).toBe(false);

    debug.show();
    expect(win.hidden).toBe(false);
    expect(launcher.hidden).toBe(true);
  });

  it('switches between floating and docked panel', () => {
    const debug = makeDebug({ open: '' });
    const win = debug.shadowRoot!.getElementById('window')!;
    expect(win.classList.contains('floating')).toBe(true);

    (debug.shadowRoot!.getElementById('dockBtn') as HTMLButtonElement).click();

    expect(debug.mode).toBe('panel');
    expect(win.classList.contains('panel')).toBe(true);
  });
});
