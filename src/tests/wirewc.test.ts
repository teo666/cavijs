import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cavi } from '../core/cavi';
import { Node } from '../core/node';
import type { Jack } from '../component/jack';
import { CaviWireElement } from '../component/wirewc';

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

  /** Mirrors Wire._setIndex — World.deleteWire() shifts surviving handles in place. */
  _setIndex(index: number): void {
    this.index = index;
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
   * shifts down by one, the deleted handle is invalidated (-1), and every
   * later handle has its index shifted down *in place* — so any wrapper
   * obtained before this call (e.g. cached by a CaviWireElement) keeps
   * pointing at the right data.
   */
  deleteWire(index: number): void {
    this.deletedIndices.push(index);
    this.store.deleteWire(index);
    const [removed] = this.wires.splice(index, 1);
    removed?._setIndex(-1);
    for (let i = index; i < this.wires.length; i++) {
      this.wires[i]._setIndex(i);
    }
  }

  getWireByIndex(index: number): FakeWire | null {
    return this.wires[index] ?? null;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  // Jack.getWorldPosition()'s auto-detect fallback always consults this;
  // not exercised by these tests (no coordinate transform registered), so
  // a stub returning identity suffices.
  getCoordinateTransform(): { scale: number; translateX: number; translateY: number } {
    return { scale: 1, translateX: 0, translateY: 0 };
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

/**
 * Mirrors CaviWireElement.OUTSIDE_FRAMES_BEFORE_CLEANUP — read off the
 * class rather than hardcoded, so tuning the threshold doesn't silently
 * turn these tests into a check of the old value.
 */
const OUTSIDE_FRAMES = (CaviWireElement as unknown as { OUTSIDE_FRAMES_BEFORE_CLEANUP: number })
  .OUTSIDE_FRAMES_BEFORE_CLEANUP;

/**
 * Runs the same private cleanup check the RAF loop calls every frame,
 * `frames` times in a row.
 *
 * Cleanup deliberately requires OUTSIDE_FRAMES_BEFORE_CLEANUP *consecutive*
 * frames outside the container (so a one-frame layout reflow glitch can
 * never delete a cable), so a single call proves nothing either way — the
 * default here runs exactly the number of frames that threshold needs.
 */
function runCleanupCheck(wireEl: CaviWireElement, frames: number = OUTSIDE_FRAMES): void {
  for (let i = 0; i < frames && wireEl.isConnected; i++) {
    (wireEl as unknown as { _cleanupIfOutsideContainer(): void })._cleanupIfOutsideContainer();
  }
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

  it('needs the full consecutive-frame threshold, and resets it if a plug comes back inside', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireEl = makeWireEl({ length: '4', 'auto-cleanup': '' });
    const plugs = wireEl.querySelectorAll('cavi-plug');
    const outside = rect(9999, 9999, 10, 10);
    const p0 = vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(outside);
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(outside);

    // One frame short of the threshold: still alive.
    runCleanupCheck(wireEl, OUTSIDE_FRAMES - 1);
    expect(wireEl.isConnected).toBe(true);

    // A single frame back inside restarts the count from scratch, so the
    // next OUTSIDE_FRAMES - 1 frames outside must not be enough either.
    p0.mockReturnValue(rect(100, 100, 10, 10));
    runCleanupCheck(wireEl, 1);
    p0.mockReturnValue(outside);
    runCleanupCheck(wireEl, OUTSIDE_FRAMES - 1);
    expect(wireEl.isConnected).toBe(true);
    expect(cavi.deletedIndices).toEqual([]);

    // ...and the frame that finally completes the run does delete it.
    runCleanupCheck(wireEl, 1);
    expect(wireEl.isConnected).toBe(false);
  });

  it("does not clean up a cable that left the container but is still inside the renderer's surface", () => {
    const container = makeContainer(0, 0, 500, 500);
    const surface = makeContainer(-1000, -1000, 3000, 3000);
    const cavi = new FakeCavi(container);
    (cavi as unknown as { getSurface(): HTMLElement }).getSurface = () => surface;
    Cavi.shared = cavi as unknown as Cavi;

    const wireEl = makeWireEl({ length: '4', 'auto-cleanup': '' });
    const plugs = wireEl.querySelectorAll('cavi-plug');
    vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(rect(900, 900, 10, 10));
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(rect(900, 900, 10, 10));

    runCleanupCheck(wireEl);
    expect(wireEl.isConnected).toBe(true);

    // ...and does once it leaves the surface too.
    vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    runCleanupCheck(wireEl);
    expect(wireEl.isConnected).toBe(false);
  });

  it('reads auto-cleanup live, so it can be added after the wire was set up', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireEl = makeWireEl({ length: '4' });
    const plugs = wireEl.querySelectorAll('cavi-plug');
    vi.spyOn(plugs[0], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));
    vi.spyOn(plugs[1], 'getBoundingClientRect').mockReturnValue(rect(9999, 9999, 10, 10));

    wireEl.setAttribute('auto-cleanup', '');
    runCleanupCheck(wireEl);
    expect(wireEl.isConnected).toBe(false);
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

  it('keeps a surviving wire correct after an earlier wire is deleted and its WASM index shifts', () => {
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
    // The handle is the very same object: shifted in place, not replaced.
    expect(wireB.getWire()!.getIndex()).toBe(0);
    expect(wireB.getWire()!.getNodeCount()).toBe(4);
    expect(wireB.getWire()!.getNode(0)!.x).toBe(111);
    expect(wireB.getWire()!.getNode(0)!.y).toBe(222);
    // Color is JS-only metadata (never stored in WASM) — it must survive
    // the shift untouched.
    expect(wireB.getWire()!.getColor()).toBe('#123456');

    // The plug's own bound Node must follow too, not just the wire —
    // update() (public, no-op only while dragging) re-syncs the plug's
    // on-screen position from whatever Node it currently holds.
    const plugB0 = wireB.querySelectorAll('cavi-plug')[0] as unknown as {
      update(): void;
    } & HTMLElement;
    plugB0.update();
    expect(plugB0.style.left).toBe('111px');
    expect(plugB0.style.top).toBe('222px');
  });

  it('keeps a grown free plug on its real (shifted) terminal, not the stale creation-time index', () => {
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
    (followPlugB as unknown as { update(): void }).update();
    expect(followPlugB.style.left).toBe(`${originalX}px`);
    expect(followPlugB.style.top).toBe(`${originalY}px`);
  });
});

describe('CaviWireElement lifecycle', () => {
  it('removing a <cavi-wire> from the DOM deletes its WASM wire (no ghost cable left simulated)', async () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    const wireA = makeWireEl({ length: '4' });
    const wireB = makeWireEl({ length: '4' });
    const handleA = wireA.getWire()!;

    wireA.remove();
    await Promise.resolve(); // deletion is deferred by one microtask

    expect(cavi.deletedIndices).toEqual([0]);
    expect(handleA.getIndex()).toBe(-1);
    expect(wireB.getWire()!.getIndex()).toBe(0);
  });

  it('moving a <cavi-wire> within the DOM keeps its wire: neither deleted nor duplicated', async () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;
    const addWire = vi.spyOn(cavi, 'addWire');

    const wireEl = makeWireEl({ length: '4' });
    const handle = wireEl.getWire();
    const otherParent = document.createElement('div');
    document.body.appendChild(otherParent);
    otherParent.appendChild(wireEl);
    await Promise.resolve();

    expect(addWire).toHaveBeenCalledTimes(1);
    expect(cavi.deletedIndices).toEqual([]);
    expect(wireEl.getWire()).toBe(handle);
  });

  it('does not create a wire if removed before caviready fires', () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    const addWire = vi.spyOn(cavi, 'addWire');

    const wireEl = makeWireEl({ length: '4' }); // Cavi.shared is null: waits for caviready
    wireEl.remove();
    document.dispatchEvent(new CustomEvent('caviready', { detail: { cavi } }));

    expect(addWire).not.toHaveBeenCalled();
    expect(wireEl.getWire()).toBeNull();
  });
});

describe('CaviWireElement declarative jack wiring — auto-detected position (no x/y attributes)', () => {
  it("seeds the wire endpoint from a jack-bound plug whose jack has no x/y, using the jack's rendered position", () => {
    const container = makeContainer(0, 0, 500, 500);
    const cavi = new FakeCavi(container);
    Cavi.shared = cavi as unknown as Cavi;

    // No x/y attributes: this jack is positioned purely by CSS (or, here,
    // by a mocked rendered box) — exactly the case getWorldPosition()'s
    // auto-detect fallback exists for.
    const jack = document.createElement('cavi-jack') as Jack;
    jack.id = 'j1';
    jack.setAttribute('type', 'audio');
    document.body.appendChild(jack);
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rect(123, 45, 0, 0));

    const wireEl = document.createElement('cavi-wire') as CaviWireElement;
    wireEl.setAttribute('length', '4');
    wireEl.setAttribute('type', 'audio');
    const origin = document.createElement('cavi-plug');
    origin.setAttribute('node', '0');
    origin.setAttribute('jack', 'j1');
    const free = document.createElement('cavi-plug');
    free.setAttribute('node', '3');
    wireEl.appendChild(origin);
    wireEl.appendChild(free);
    document.body.appendChild(wireEl);

    const wire = wireEl.getWire()!;
    expect(wire.getNode(0)!.x).toBe(123);
    expect(wire.getNode(0)!.y).toBe(45);
    expect(wire.getNode(0)!.fixed).toBe(true);
    expect(jack.plugCount).toBe(1);
  });
});
