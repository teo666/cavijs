import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cavi } from './cavi';
import { Node } from './node';
import type { CaviWireElement } from './wirewc';
import type { Jack } from './jack';
import './wirewc';

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    x,
    y,
    toJSON() {
      return this;
    },
  } as unknown as DOMRect;
}

function buildNodes(x1: number, y1: number, x2: number, y2: number, count: number): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const fixed = i === 0 || i === count - 1;
    nodes.push(new Node(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, fixed));
  }
  return nodes;
}

/**
 * Stand-in for the real WasmWorld's wire storage: node data lives here,
 * addressed purely by index — exactly like the real `world.get_wire_node`,
 * so a FakeWire wrapper holding a stale index will read the wrong (or
 * missing) data after a deletion shifts things, just like the real bug.
 */
class FakeWireStore {
  private wireNodes: Node[][] = [];

  addWire(x1: number, y1: number, x2: number, y2: number, count: number): number {
    this.wireNodes.push(buildNodes(x1, y1, x2, y2, count));
    return this.wireNodes.length - 1;
  }

  deleteWire(index: number): void {
    this.wireNodes.splice(index, 1);
  }

  addNodeAt(wireIndex: number, nodeIndex: number, node: Node): void {
    this.wireNodes[wireIndex]?.splice(nodeIndex, 0, node);
  }

  getNode(wireIndex: number, nodeIndex: number): Node | null {
    return this.wireNodes[wireIndex]?.[nodeIndex] ?? null;
  }

  getNodeCount(wireIndex: number): number {
    return this.wireNodes[wireIndex]?.length ?? 0;
  }
}

/** Minimal stand-in for the WASM-backed Wire, enough to drive CaviWireElement's setup. */
class FakeWire {
  private store: FakeWireStore;
  private index: number;

  constructor(store: FakeWireStore, index: number) {
    this.store = store;
    this.index = index;
  }

  getNode(nodeIndex: number): Node | null {
    return this.store.getNode(this.index, nodeIndex);
  }

  getNodeCount(): number {
    return this.store.getNodeCount(this.index);
  }

  getIndex(): number {
    return this.index;
  }

  /** Mirrors WasmWire::add_node_at — a plain insert that leaves every other node untouched. */
  addNodeAt(nodeIndex: number, x: number, y: number, fixed: boolean): void {
    this.store.addNodeAt(this.index, nodeIndex, new Node(x, y, fixed));
  }

  meta: Record<string, unknown> = {};

  setColor(color: string): void {
    this.meta.color = color;
  }

  getColor(): string | undefined {
    return this.meta.color as string | undefined;
  }
}

/** Minimal stand-in for Cavi, enough to drive CaviWireElement's setup + auto-cleanup. */
class FakeCavi {
  public deletedIndices: number[] = [];
  private store = new FakeWireStore();
  private wires: FakeWire[] = [];
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  addWire(x1: number, y1: number, x2: number, y2: number, nodes: number): FakeWire {
    const index = this.store.addWire(x1, y1, x2, y2, nodes);
    const wire = new FakeWire(this.store, index);
    this.wires.push(wire);
    return wire;
  }

  /**
   * Mirrors World.deleteWire()'s real reindexing: the underlying data
   * shifts down by one, and every later wire gets a brand new wrapper
   * object at its new index — any wrapper obtained *before* this call
   * (e.g. cached by a CaviWireElement) keeps its old, now-wrong index.
   * Also mirrors the metadata-carry-over fix: a fresh wrapper starts with
   * empty meta (color lives only in JS, never in the fake "WASM" store), so
   * it must be copied over by hand or it would silently reset.
   */
  deleteWire(index: number): void {
    this.deletedIndices.push(index);
    this.store.deleteWire(index);
    this.wires.splice(index, 1);
    for (let i = index; i < this.wires.length; i++) {
      const meta = this.wires[i].meta;
      const wire = new FakeWire(this.store, i);
      wire.meta = { ...meta };
      this.wires[i] = wire;
    }
  }

  getWireByIndex(index: number): FakeWire | null {
    return this.wires[index] ?? null;
  }

  getContainer(): HTMLElement {
    return this.container;
  }
}

function makeContainer(x: number, y: number, width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(x, y, width, height));
  return el;
}

function makeWireEl(attrs: Record<string, string> = {}): CaviWireElement {
  const el = document.createElement('cavi-wire') as CaviWireElement;
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  const nodeCount = parseInt(attrs['length'] ?? '10', 10);
  const p0 = document.createElement('cavi-plug');
  p0.setAttribute('node', '0');
  const p1 = document.createElement('cavi-plug');
  p1.setAttribute('node', String(nodeCount - 1));
  el.appendChild(p0);
  el.appendChild(p1);
  document.body.appendChild(el);
  return el;
}

/** Runs the same private cleanup check the RAF loop calls every frame. */
function runCleanupCheck(wireEl: CaviWireElement): void {
  (wireEl as unknown as { _cleanupIfOutsideContainer(): void })._cleanupIfOutsideContainer();
}

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
});

describe('CaviWireElement auto-cleanup (auto-cleanup attribute)', () => {
  it('does nothing when auto-cleanup is absent, even if every plug is outside the container', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireEl = makeWireEl({ length: '4' });
    const plugs = wireEl.querySelectorAll('cavi-plug');
    vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));

    runCleanupCheck(wireEl);

    expect(wireEl.isConnected).toBe(true);
    expect(cavi.deletedIndices).toEqual([]);
  });

  it('deletes the wire and removes the DOM once every plug is outside the container', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireEl = makeWireEl({ length: '4', 'auto-cleanup': '' });
    const wireIndex = wireEl.getWire()!.getIndex();
    const plugs = wireEl.querySelectorAll('cavi-plug');
    vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));

    runCleanupCheck(wireEl);

    expect(wireEl.isConnected).toBe(false);
    expect(cavi.deletedIndices).toEqual([wireIndex]);
  });

  it('does not clean up while at least one plug still overlaps the container', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireEl = makeWireEl({ length: '4', 'auto-cleanup': '' });
    const plugs = wireEl.querySelectorAll('cavi-plug');
    vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(rect(100, 100, 10, 10)); // inside
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10)); // outside

    runCleanupCheck(wireEl);

    expect(wireEl.isConnected).toBe(true);
    expect(cavi.deletedIndices).toEqual([]);
  });

  it('removing the wire detaches its plugs from their jacks (cascading disconnectedCallback)', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const jack = document.createElement('cavi-jack') as Jack;
    jack.id = 'j1';
    jack.setAttribute('type', 'audio');
    jack.setAttribute('x', '0');
    jack.setAttribute('y', '0');
    document.body.appendChild(jack);

    // Declarative jack wiring is read once at connect time, so the `jack`
    // attribute must be set on the origin plug before the wire is inserted.
    const wireEl = document.createElement('cavi-wire') as CaviWireElement;
    wireEl.setAttribute('length', '4');
    wireEl.setAttribute('type', 'audio');
    wireEl.setAttribute('auto-cleanup', '');
    const origin = document.createElement('cavi-plug');
    origin.setAttribute('node', '0');
    origin.setAttribute('jack', 'j1');
    const free = document.createElement('cavi-plug');
    free.setAttribute('node', '3');
    wireEl.appendChild(origin);
    wireEl.appendChild(free);
    document.body.appendChild(wireEl);

    expect(jack.plugCount).toBe(1);

    const plugEls = wireEl.querySelectorAll('cavi-plug');
    vi.spyOn(plugEls[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugEls[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));

    runCleanupCheck(wireEl);

    expect(jack.plugCount).toBe(0);
  });

  it('rebinds a surviving wire whose WASM index shifts after an earlier wire is deleted', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    // wireA is created first (index 0, will be deleted), wireB second
    // (index 1, must survive with correct data after wireA is removed).
    const wireA = makeWireEl({ length: '4', 'auto-cleanup': '' });
    const wireB = makeWireEl({ length: '4' });

    const bIndexBefore = wireB.getWire()!.getIndex();
    expect(bIndexBefore).toBe(1);

    const bNode0 = wireB.getWire()!.getNode(0)!;
    bNode0.setPosition(111, 222);
    wireB.getWire()!.setColor('#123456');

    const plugsA = wireA.querySelectorAll('cavi-plug');
    vi.spyOn(plugsA[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugsA[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));

    runCleanupCheck(wireA);

    expect(wireA.isConnected).toBe(false);
    expect(cavi.deletedIndices).toEqual([0]);

    // wireB's own cached Wire (and its plugs' Nodes) must now reflect the
    // shifted index (0) and still return the correct, un-corrupted data —
    // not the stale index 1, which no longer maps to wireB after deletion.
    expect(wireB.getWire()!.getIndex()).toBe(0);
    expect(wireB.getWire()!.getNodeCount()).toBe(4);
    expect(wireB.getWire()!.getNode(0)!.x).toBe(111);
    expect(wireB.getWire()!.getNode(0)!.y).toBe(222);
    // Regression: World.deleteWire() recreates wrapper objects for shifted
    // wires — color (JS-only metadata, never stored in WASM) must be
    // carried over onto the fresh wrapper, or it silently resets.
    expect(wireB.getWire()!.getColor()).toBe('#123456');

    // The plug's own bound Node must have been rebound too, not just the
    // wire — update() (public, no-op only while dragging) re-syncs the
    // plug's on-screen position from whatever Node it currently holds.
    const plugB0 = wireB.querySelectorAll('cavi-plug')[0] as unknown as { update(): void } & HTMLElement;
    plugB0.update();
    expect(plugB0.style.left).toBe('111px');
    expect(plugB0.style.top).toBe('222px');
  });

  it('rebinds a grown free plug to its real (shifted) terminal, not the stale creation-time index', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireA = makeWireEl({ length: '4', 'auto-cleanup': '' });
    const wireB = makeWireEl({ length: '4' });

    // Simulate Jack._growCable growing wireB's free end from node 3 to
    // node 5, by inserting two nodes right before the current last node —
    // exactly like the real cable-creation drag does — then updating the
    // free plug's `node` attribute to match, as Jack now does on every
    // growth step. Without that attribute update, the rebind below would
    // snap the plug back to the stale index 3 (now a mid-cable node)
    // instead of the real terminal (5) — this is the bug the user reported
    // as "il plug mi compare a metà cavo" after deleting a cable.
    const wireBWire = wireB.getWire()!;
    const originalTerminal = wireBWire.getNode(3)!;
    const originalX = originalTerminal.x;
    const originalY = originalTerminal.y;
    wireBWire.addNodeAt(3, -1, -1, false);
    wireBWire.addNodeAt(4, -2, -2, false);
    const followPlugB = wireB.querySelectorAll('cavi-plug')[1] as HTMLElement;
    followPlugB.setAttribute('node', String(wireBWire.getNodeCount() - 1));

    const plugsA = wireA.querySelectorAll('cavi-plug');
    vi.spyOn(plugsA[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugsA[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));

    runCleanupCheck(wireA);

    expect(wireB.getWire()!.getIndex()).toBe(0);
    expect(wireB.getWire()!.getNodeCount()).toBe(6);
    // _rebindAfterIndexShift already calls Plug.setNode -> updatePosition
    // synchronously, so the DOM position reflects the rebind immediately.
    expect(followPlugB.style.left).toBe(`${originalX}px`);
    expect(followPlugB.style.top).toBe(`${originalY}px`);
  });
});
