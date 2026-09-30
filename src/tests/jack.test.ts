import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack, type CableSession } from '../component/jack';
import { Cavi } from '../core/cavi';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';
import { Node } from '../core/node';
import { IDENTITY_TRANSFORM, type CoordinateTransform } from '../core/coords';

/**
 * Jack is a pure domain/data element — these tests drive it entirely
 * through its public API (createCable/updateCableSession/
 * finishCableSession/cancelCableSession, setPointerHoverPosition/
 * setDragActive), with no PointerEvent simulation at all. Which gesture
 * (click on an empty/exposed jack vs a spread-out plug, ...) triggers which
 * of these calls is StandardInteractionController's responsibility, tested
 * separately in interaction.test.ts.
 */

function makeJack(attrs: Record<string, string> = {}): Jack {
  const el = document.createElement('cavi-jack') as Jack;
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
  Jack.setPointerHoverPosition(null, null);
});

/**
 * A minimal stand-in for a Plug, exposing just enough of its interface
 * (getBoundingClientRect/setSpreadPosition/snapToJack/getOtherEndCenter)
 * for Jack's hover-spread bookkeeping (_refreshSpread) to run against it
 * without crashing, for tests that only care about capacity/full-state
 * behavior and don't need a real DOM Plug.
 */
function fakePlug(): Plug {
  return {
    getBoundingClientRect: () => rect(0, 0),
    setSpreadPosition: () => {},
    snapToJack: () => {},
    getOtherEndCenter: () => null,
  } as unknown as Plug;
}

function rect(x: number, y: number): DOMRect {
  return {
    left: x,
    top: y,
    right: x,
    bottom: y,
    width: 0,
    height: 0,
    x,
    y,
    toJSON() {
      return this;
    },
  } as unknown as DOMRect;
}

/** A positioned Jack, appended to the document, ready to drive via the public API. */
function makePositionedJack(
  id: string,
  x: number,
  y: number,
  attrs: Record<string, string> = {}
): Jack {
  const jack = makeJack(attrs);
  jack.id = id;
  document.body.appendChild(jack);
  vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rect(x, y));
  return jack;
}

/**
 * Minimal stand-in for the WASM-backed `Wire`, reproducing just enough of
 * `set_node_count`'s real semantics (preserve terminal position/fixed state,
 * interpolate discarded intermediates) to drive Jack's cable-creation
 * session without needing a real WASM module in jsdom.
 */
class FakeWire {
  private nodes: Node[];

  constructor(x1: number, y1: number, x2: number, y2: number, count: number) {
    this.nodes = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const fixed = i === 0 || i === count - 1;
      this.nodes.push(new Node(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, fixed));
    }
  }

  getNode(index: number): Node | null {
    return this.nodes[index] ?? null;
  }

  /** Deletion is a no-op on this fake's FakeCavi; any index >= 0 lets CaviWireElement release it. */
  getIndex(): number {
    return 0;
  }

  getNodeCount(): number {
    return this.nodes.length;
  }

  setNodeCount(count: number): void {
    const first = this.nodes[0];
    const last = this.nodes[this.nodes.length - 1];
    const next: Node[] = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      if (i === 0) {
        next.push(new Node(first.x, first.y, first.fixed));
      } else if (i === count - 1) {
        next.push(new Node(last.x, last.y, last.fixed));
      } else {
        next.push(
          new Node(first.x + (last.x - first.x) * t, first.y + (last.y - first.y) * t, false)
        );
      }
    }
    this.nodes = next;
  }

  /** Mirrors WasmWire::add_node_at's real semantics: a plain Vec::insert — every other node is left untouched. */
  addNodeAt(index: number, x: number, y: number, fixed: boolean): void {
    this.nodes.splice(index, 0, new Node(x, y, fixed));
  }

  setColor(): void {}
}

class FakeCavi {
  public lastWire: FakeWire | null = null;
  // Overridable per-test — defaults match Cavi's own defaults.
  public getCableDropBehavior = (): 'cancel' | 'dangle' | 'detach' => 'detach';
  public getPlugSpreadMode = (): 'towardOther' | 'radial' => 'towardOther';
  public getPlugSpreadRadiusMultiplier = (): number => 1.8;
  public getPlugSpreadRecompactDelayMs = (): number => 500;
  public getCoordinateTransform = (): CoordinateTransform => IDENTITY_TRANSFORM;

  addWire(x1: number, y1: number, x2: number, y2: number, nodes: number): FakeWire {
    this.lastWire = new FakeWire(x1, y1, x2, y2, nodes);
    return this.lastWire;
  }

  // The element every screen<->world conversion is anchored on (see
  // Jack._worldContainer). document.body has an all-zero rect in jsdom, so
  // it acts as a neutral origin; overridable per-test for the cases that
  // care about the container actually being somewhere.
  public getContainer = (): HTMLElement => document.body;

  deleteWire(): void {}
}

function installFakeCavi(): FakeCavi {
  const fake = new FakeCavi();
  Cavi.shared = fake as unknown as Cavi;
  return fake;
}

function getFollowPlugEl(wireEl: CaviWireElement): HTMLElement {
  return wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
}

describe('Jack.canAccept', () => {
  it('matches when types are equal', () => {
    const jack = makeJack({ type: 'audio' });
    expect(jack.canAccept('audio')).toBe(true);
  });

  it('does not match on different types', () => {
    const jack = makeJack({ type: 'audio' });
    expect(jack.canAccept('midi')).toBe(false);
  });

  it('does not match when the jack has no type configured', () => {
    const jack = makeJack();
    expect(jack.canAccept('audio')).toBe(false);
  });
});

describe('Jack magnet class', () => {
  it('toggles the default magnet class on the host element', () => {
    const jack = makeJack();
    document.body.appendChild(jack);

    jack.setMagnetActive(true);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);

    jack.setMagnetActive(false);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
  });

  it('uses a custom class name from the magnet-class attribute', () => {
    const jack = makeJack({ 'magnet-class': 'my-highlight' });
    document.body.appendChild(jack);

    jack.setMagnetActive(true);
    expect(jack.classList.contains('my-highlight')).toBe(true);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
  });
});

describe('Jack.registry', () => {
  it('tracks jacks while connected and forgets them once removed', () => {
    const jack = makeJack();
    expect(Jack.registry.has(jack)).toBe(false);

    document.body.appendChild(jack);
    expect(Jack.registry.has(jack)).toBe(true);

    jack.remove();
    expect(Jack.registry.has(jack)).toBe(false);
  });
});

describe('Jack capacity (max-plugs)', () => {
  it('has unlimited capacity when max-plugs is not set', () => {
    const jack = makeJack();
    for (let i = 0; i < 5; i++) {
      jack.attach(fakePlug());
    }
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('stops accepting once max-plugs is reached, and frees up on detach', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    const plug = fakePlug();

    expect(jack.canAcceptMore()).toBe(true);
    jack.attach(plug);
    expect(jack.plugCount).toBe(1);
    expect(jack.canAcceptMore()).toBe(false);

    jack.detach(plug);
    expect(jack.plugCount).toBe(0);
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('ignores an invalid max-plugs value (falls back to unlimited)', () => {
    const jack = makeJack({ 'max-plugs': 'not-a-number' });
    jack.attach(fakePlug());
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('toggles at-capacity-class unconditionally once max-plugs is reached, and clears it on detach', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    const plug = fakePlug();

    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(false);

    jack.attach(plug);
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(true);

    jack.detach(plug);
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(false);
  });

  it('uses a custom class name from the at-capacity-class attribute', () => {
    const jack = makeJack({ 'max-plugs': '1', 'at-capacity-class': 'full-jack' });

    jack.attach(fakePlug());

    expect(jack.classList.contains('full-jack')).toBe(true);
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(false);
  });

  it('applies at-capacity-class regardless of hover or drag state, unlike full-class', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rect(0, 0));

    jack.attach(fakePlug());

    // Not hovered and no drag in progress — full-class (the hover+drag
    // preview) must stay off, but at-capacity-class (unconditional) must
    // be on.
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(true);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('Jack.createCable', () => {
  it('returns null if Cavi is not ready yet', () => {
    const jack = makePositionedJack('a', 0, 0, { type: 'audio' });
    expect(jack.createCable(0, 0)).toBeNull();
  });

  it('returns null when this Jack has no room for another Plug', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach(fakePlug());
    expect(jack.createCable(0, 0)).toBeNull();
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('inserts the new <cavi-wire> into the world container, not next to the jack', () => {
    // Regression: next to the jack, a transformed/positioned wrapper (e.g. a
    // draggable module box) became the plugs' containing block, so their
    // absolute left/top rendered offset by that wrapper's position.
    const fake = installFakeCavi();
    const container = document.createElement('div');
    document.body.appendChild(container);
    fake.getContainer = () => container;
    const module = document.createElement('div');
    module.style.transform = 'translate(100px, 50px)';
    container.appendChild(module);
    const jack = document.createElement('cavi-jack') as Jack;
    jack.setAttribute('type', 'audio');
    jack.setAttribute('x', '0');
    jack.setAttribute('y', '0');
    module.appendChild(jack);

    const session = jack.createCable(0, 0)!;

    expect(session.wireEl.parentElement).toBe(container);
  });

  it('attaches the origin plug to this Jack and places the free plug at the given position', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 50, 60, { type: 'audio' });
    const session = jack.createCable(200, 220)!;

    expect(session).not.toBeNull();
    const wire = session.wire as unknown as FakeWire;
    expect(wire.getNodeCount()).toBe(4);

    expect(jack.plugCount).toBe(1);
    const plugs = session.wireEl.querySelectorAll('cavi-plug');
    expect(plugs.length).toBe(2);
    expect(plugs[0].hasAttribute('plugged')).toBe(true);
    expect(plugs[1].hasAttribute('plugged')).toBe(false);

    expect(wire.getNode(0)!.x).toBe(50);
    expect(wire.getNode(0)!.y).toBe(60);
    expect(wire.getNode(0)!.fixed).toBe(true);
    expect(wire.getNode(3)!.x).toBe(200);
    expect(wire.getNode(3)!.y).toBe(220);
    expect(wire.getNode(3)!.fixed).toBe(true);
  });

  it('applies cable-tension/cable-size/cable-color from the jack to the new wire', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, {
      type: 'audio',
      'cable-tension': '42',
      'cable-size': '9',
      'cable-color': '#ff0000',
    });
    const session = jack.createCable(10, 0)!;

    expect(session.wireEl.getAttribute('tension')).toBe('42');
    expect(session.wireEl.getAttribute('size')).toBe('9');
    expect(session.wireEl.getAttribute('color')).toBe('#ff0000');
  });

  it('leaves tension/size/color unset (default) when the jack does not specify them', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = jack.createCable(10, 0)!;

    expect(session.wireEl.hasAttribute('tension')).toBe(false);
    expect(session.wireEl.hasAttribute('size')).toBe(false);
    expect(session.wireEl.hasAttribute('color')).toBe(false);
  });
});

describe('Jack.updateCableSession — node count follows distance', () => {
  it('grows as the position moves away, and never shrinks back as it comes closer again', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = jack.createCable(10, 0)!;
    const wire = session.wire as unknown as FakeWire;
    expect(wire.getNodeCount()).toBe(4);

    Jack.updateCableSession(session, 100, 0); // distance 100 -> 4 + floor(100/30) = 7
    expect(wire.getNodeCount()).toBe(7);

    Jack.updateCableSession(session, 400, 0); // distance 400 -> 4 + floor(400/30) = 17
    expect(wire.getNodeCount()).toBe(17);

    Jack.updateCableSession(session, 5, 0); // back close -> the cable stays pulled out, no shortening
    expect(wire.getNodeCount()).toBe(17);

    Jack.updateCableSession(session, 250, 0); // distance 250 -> 12, still below the 17 already reached
    expect(wire.getNodeCount()).toBe(17);
  });

  it('caps node count at the configured maximum', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = jack.createCable(10, 0)!;
    const wire = session.wire as unknown as FakeWire;

    Jack.updateCableSession(session, 5000, 0);
    expect(wire.getNodeCount()).toBe(60);
  });
});

describe('Jack.updateCableSession — world-mouse interaction', () => {
  it('keeps feeding the world-mouse position on every update', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = jack.createCable(10, 0)!;
    const setMouseSpy = vi.spyOn(Node.prototype, 'setMousePosition');
    try {
      Jack.updateCableSession(session, 42, 7);
      // Guards against a regression: whoever drives this must keep feeding
      // the free node's mouse position directly, since the interaction
      // controller suppresses the native mousemove Renderer would
      // otherwise use, to avoid interfering with the drag gesture itself.
      expect(setMouseSpy).toHaveBeenCalledWith(42, 7);
    } finally {
      setMouseSpy.mockRestore();
    }
  });
});

describe('Jack.updateCableSession — incremental node insertion', () => {
  it('leaves an already-settled intermediate node untouched by a later growth step', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = jack.createCable(10, 0)!;
    const wire = session.wire as unknown as FakeWire;

    Jack.updateCableSession(session, 100, 0); // grows 4 -> 7
    expect(wire.getNodeCount()).toBe(7);

    // Simulate physics having settled this intermediate node somewhere far
    // from wherever it was placed on insertion.
    wire.getNode(2)!.setPosition(999, 888);

    Jack.updateCableSession(session, 400, 0); // grows further, 7 -> 17
    expect(wire.getNodeCount()).toBe(17);

    const settled = wire.getNode(2)!;
    expect(settled.x).toBe(999);
    expect(settled.y).toBe(888);
  });

  it('spawns newly-inserted nodes interpolated toward the target position by default', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = jack.createCable(10, 0)!;
    const wire = session.wire as unknown as FakeWire;

    const anchor = wire.getNode(2)!; // last settled node before the free terminal
    const anchorX = anchor.x;
    const anchorY = anchor.y;

    Jack.updateCableSession(session, 30, 0); // distance 30 -> desired 5, exactly one new node
    expect(wire.getNodeCount()).toBe(5);

    const inserted = wire.getNode(3)!; // inserted right before the shifted free terminal
    expect(inserted.x).toBeCloseTo((anchorX + 30) / 2);
    expect(inserted.y).toBeCloseTo(anchorY / 2);
  });

  it('spawns newly-inserted nodes stacked on the last settled node with cable-node-spawn="stack"', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio', 'cable-node-spawn': 'stack' });
    const session = jack.createCable(10, 0)!;
    const wire = session.wire as unknown as FakeWire;

    const anchor = wire.getNode(2)!;
    const anchorX = anchor.x;
    const anchorY = anchor.y;

    Jack.updateCableSession(session, 30, 0);
    expect(wire.getNodeCount()).toBe(5);

    const inserted = wire.getNode(3)!;
    expect(inserted.x).toBe(anchorX);
    expect(inserted.y).toBe(anchorY);
  });
});

describe('Jack cable session — magnet preview and snap on finish', () => {
  it('highlights a compatible jack within range while updating, and snaps to it on finish', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const target = makePositionedJack('target', 100, 0, { type: 'audio' });

    const session = origin.createCable(10, 0)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    const followRect = vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(90, 0));

    Jack.updateCableSession(session, 90, 0);
    expect(target.classList.contains('cavi-magnet-target')).toBe(true);
    expect(followPlugEl.classList.contains('cavi-magnet-active')).toBe(true);

    followRect.mockReturnValue(rect(100, 0));
    Jack.finishCableSession(session);

    expect(target.plugCount).toBe(1);
    expect(origin.plugCount).toBe(1);
    expect(followPlugEl.hasAttribute('plugged')).toBe(true);
    expect(target.classList.contains('cavi-magnet-target')).toBe(false);

    const wire = session.wire as unknown as FakeWire;
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(true);
    expect(followNode.x).toBe(100);
    expect(followNode.y).toBe(0);
  });

  it('does not offer this same Jack as its own snap target', () => {
    const fake = installFakeCavi();
    fake.getCableDropBehavior = () => 'dangle'; // isolate the snap-target check from the drop-behavior default
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio', 'max-plugs': '2' });
    const session = origin.createCable(5, 0)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(1, 0));

    Jack.finishCableSession(session);

    expect(origin.plugCount).toBe(1); // only the origin terminal, not both
    expect(followPlugEl.hasAttribute('plugged')).toBe(false);
  });
});

describe('Jack cable session — finish/cancel away from any jack', () => {
  it("finishCableSession defaults to 'detach': both ends end up unattached and unfixed", () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = origin.createCable(300, 300)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(9999, 9999));

    Jack.finishCableSession(session);

    expect(origin.plugCount).toBe(0);
    expect(followPlugEl.hasAttribute('plugged')).toBe(false);
    const wire = session.wire as unknown as FakeWire;
    expect(wire.getNode(0)!.fixed).toBe(false);
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(false);
    expect(document.querySelector('cavi-wire')).not.toBeNull(); // not removed, just detached
    // ...but marked for auto-cleanup, so it doesn't stay simulated forever.
    expect(session.wireEl.hasAttribute('auto-cleanup')).toBe(true);
  });

  it("'dangle' behavior leaves only the free end unfixed, origin stays attached", () => {
    const fake = installFakeCavi();
    fake.getCableDropBehavior = () => 'dangle';
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = origin.createCable(300, 300)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(9999, 9999));

    Jack.finishCableSession(session);

    expect(origin.plugCount).toBe(1);
    expect(session.wireEl.hasAttribute('auto-cleanup')).toBe(false); // still tethered
    expect(followPlugEl.hasAttribute('plugged')).toBe(false);
    const wire = session.wire as unknown as FakeWire;
    expect(wire.getNode(0)!.fixed).toBe(true);
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(false);
  });

  it("'cancel' behavior removes the in-progress wire outright", () => {
    const fake = installFakeCavi();
    fake.getCableDropBehavior = () => 'cancel';
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = origin.createCable(300, 300)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(9999, 9999));

    Jack.finishCableSession(session);

    expect(origin.plugCount).toBe(0);
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('cancelCableSession always leaves the free end unfixed regardless of cableDropBehavior', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = origin.createCable(300, 300)!;

    Jack.cancelCableSession(session);

    expect(origin.plugCount).toBe(1);
    const wire = session.wire as unknown as FakeWire;
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(false);
  });
});

describe('Jack "full" hover feedback — Jack.setDragActive', () => {
  afterEach(() => {
    Jack.setPointerHoverPosition(null, null);
  });

  it('shows the forbidden cursor and full-class while hovered during a drag', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach(fakePlug());

    Jack.setPointerHoverPosition(0, 0);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);

    Jack.setDragActive(true);
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);
    expect(jack.style.cursor).toBe('not-allowed');

    Jack.setDragActive(false);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('stays active while multiple overlapping drags are in progress, clearing only once all end', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach(fakePlug());
    Jack.setPointerHoverPosition(0, 0);

    Jack.setDragActive(true); // first drag starts
    Jack.setDragActive(true); // a second, overlapping drag starts
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    Jack.setDragActive(false); // first drag ends
    expect(jack.classList.contains('cavi-jack-full')).toBe(true); // second still in progress

    Jack.setDragActive(false); // second drag ends
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('keeps showing full-class for the full duration of an in-progress cable session', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const target = makePositionedJack('target', 100, 0, { type: 'audio', 'max-plugs': '1' });
    target.attach(fakePlug());

    const session: CableSession = origin.createCable(10, 0)!;
    Jack.setDragActive(true);
    Jack.updateCableSession(session, 100, 0);
    // In the real system a single pointermove feeds both the cable
    // session's geometry and the global hover-position tracker — here
    // they're two independent domain entry points, so both must be driven.
    Jack.setPointerHoverPosition(100, 0);

    expect(target.classList.contains('cavi-jack-full')).toBe(true);
    expect(target.style.cursor).toBe('not-allowed');

    Jack.finishCableSession(session); // no compatible target under the free end right now
    Jack.setDragActive(false);
    expect(target.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('Jack hover-spread mechanic', () => {
  /** Like rect(), but with a real width/height so _hoverRadius() has something to work with. */
  function rectSized(x: number, y: number, size: number): DOMRect {
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

  afterEach(() => {
    Jack.setPointerHoverPosition(null, null);
  });

  it('does nothing for a jack with no plugs', () => {
    const jack = makePositionedJack('empty', 0, 0, { type: 'audio' });
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));

    Jack.setPointerHoverPosition(0, 0);

    expect(jack.isSpread()).toBe(false);
  });

  it('never spreads while a drag is active, so it does not fight an in-progress gesture', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', -100, 0, { type: 'audio' });
    vi.spyOn(origin, 'getBoundingClientRect').mockReturnValue(rectSized(-100, 0, 24));
    const target = makePositionedJack('target', 0, 0, { type: 'audio' });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));

    const session = origin.createCable(-100, 0)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));
    Jack.finishCableSession(session);
    expect(target.plugCount).toBe(1);

    Jack.setDragActive(true);
    Jack.setPointerHoverPosition(0, 0);
    expect(target.isSpread()).toBe(false);

    Jack.setDragActive(false);
  });

  it('spreads an attached plug away from center on hover, and recompacts it after the configured timeout', () => {
    vi.useFakeTimers();
    try {
      const fake = installFakeCavi();
      fake.getPlugSpreadRecompactDelayMs = () => 300;
      const origin = makePositionedJack('origin', -100, 0, { type: 'audio' });
      vi.spyOn(origin, 'getBoundingClientRect').mockReturnValue(rectSized(-100, 0, 24));
      const target = makePositionedJack('target', 0, 0, { type: 'audio' });
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));

      const session = origin.createCable(-100, 0)!;
      const followPlugEl = getFollowPlugEl(session.wireEl);
      vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));
      Jack.finishCableSession(session);
      expect(target.plugCount).toBe(1);

      const wire = session.wire as unknown as FakeWire;
      const followNode = wire.getNode(wire.getNodeCount() - 1)!;
      expect(followNode.x).toBe(0);
      expect(followNode.y).toBe(0);

      Jack.setPointerHoverPosition(0, 0); // hover right over target's center
      expect(target.isSpread()).toBe(true);
      // The plug's node moved away from the jack's exact center to become
      // individually clickable.
      expect(Math.hypot(followNode.x, followNode.y)).toBeGreaterThan(0);

      Jack.setPointerHoverPosition(9999, 9999); // pointer leaves the expanded area
      vi.advanceTimersByTime(299);
      expect(target.isSpread()).toBe(true); // not yet — timeout hasn't fired

      vi.advanceTimersByTime(2);
      expect(target.isSpread()).toBe(false);
      expect(followNode.x).toBe(0); // recompacted back to the jack's center
      expect(followNode.y).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the recompact timeout if the pointer re-enters the expanded area before it fires', () => {
    vi.useFakeTimers();
    try {
      const fake = installFakeCavi();
      fake.getPlugSpreadRecompactDelayMs = () => 300;
      const origin = makePositionedJack('origin', -100, 0, { type: 'audio' });
      vi.spyOn(origin, 'getBoundingClientRect').mockReturnValue(rectSized(-100, 0, 24));
      const target = makePositionedJack('target', 0, 0, { type: 'audio' });
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));

      const session = origin.createCable(-100, 0)!;
      const followPlugEl = getFollowPlugEl(session.wireEl);
      vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));
      Jack.finishCableSession(session);

      Jack.setPointerHoverPosition(0, 0);
      expect(target.isSpread()).toBe(true);

      Jack.setPointerHoverPosition(9999, 9999); // leaves — starts the recompact timer
      vi.advanceTimersByTime(250);
      Jack.setPointerHoverPosition(0, 0); // re-enters before it fires — resets it
      vi.advanceTimersByTime(250); // would have fired by now had it not reset (250 + 250 > 300)

      expect(target.isSpread()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses 'radial' plugSpreadMode to distribute plugs evenly regardless of cable direction", () => {
    const fake = installFakeCavi();
    fake.getPlugSpreadMode = () => 'radial';
    const target = makePositionedJack('target', 0, 0, { type: 'audio', 'max-plugs': '2' });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rectSized(0, 0, 24));

    const a = document.createElement('cavi-plug') as Plug;
    const b = document.createElement('cavi-plug') as Plug;
    document.body.appendChild(a);
    document.body.appendChild(b);
    const nodeA = new Node(0, 0, true);
    const nodeB = new Node(0, 0, true);
    a.setNode(nodeA);
    b.setNode(nodeB);
    a.attach(target);
    b.attach(target);

    Jack.setPointerHoverPosition(0, 0);

    expect(target.isSpread()).toBe(true);
    // Two plugs evenly distributed around the jack land on (roughly)
    // opposite sides of it.
    expect(Math.hypot(nodeA.x, nodeA.y)).toBeGreaterThan(0);
    expect(Math.hypot(nodeB.x, nodeB.y)).toBeGreaterThan(0);
    expect(nodeA.x).toBeCloseTo(-nodeB.x, 5);
    expect(nodeA.y).toBeCloseTo(-nodeB.y, 5);
  });
});

describe('Jack.getWorldPosition — explicit x/y (unchanged behavior)', () => {
  it('reproduces parseFloat(getAttribute(...)) exactly, ignoring the rendered box', () => {
    const jack = makePositionedJack('a', 999, 999, { x: '50', y: '60' });
    expect(jack.getWorldPosition()).toEqual({ x: 50, y: 60 });
  });

  it('defaults a missing y (or x) to 0, same as updatePosition() always has', () => {
    const jack = makePositionedJack('a', 999, 999, { x: '50' });
    expect(jack.getWorldPosition()).toEqual({ x: 50, y: 0 });
  });

  it('ignores a registered coordinate transform — explicit numbers are taken literally', () => {
    const fake = installFakeCavi();
    fake.getCoordinateTransform = () => ({ scale: 2, translateX: 100, translateY: 100 });
    const jack = makePositionedJack('a', 999, 999, { x: '50', y: '60' });
    expect(jack.getWorldPosition()).toEqual({ x: 50, y: 60 });
  });
});

describe('Jack.getWorldPosition — auto-detect (no x/y attributes)', () => {
  it('derives position from the rendered box (getBoundingClientRect) when no coordinate transform is registered', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 120, 80);
    // makePositionedJack mocks getBoundingClientRect to a zero-size rect at
    // (120, 80) — getCenter() of a zero-size rect is that same point.
    expect(jack.getWorldPosition()).toEqual({ x: 120, y: 80 });
  });

  it('falls back to identity (no Cavi.shared at all) rather than throwing', () => {
    const jack = makePositionedJack('a', 120, 80);
    expect(jack.getWorldPosition()).toEqual({ x: 120, y: 80 });
  });

  it("un-applies a registered zoom/pan transform's scale so the result stays a stable logical value", () => {
    const fake = installFakeCavi();
    fake.getCoordinateTransform = () => ({ scale: 2, translateX: 10, translateY: 20 });
    // A zoom/pan transform is applied to an ancestor shared by both this
    // Jack and its offsetParent, so the transform's translate cancels out
    // of (jackScreenCenter - offsetParentScreenRect) before scale is ever
    // considered — only the scale needs dividing back out. Concretely: a
    // Jack at world-logical (55, 40) with offsetParent's own local origin
    // at world (0, 0), both under transform {scale:2, translateX:10,
    // translateY:20} (screen = translate + scale*world), render on screen
    // at jack=(10+2*55, 20+2*40)=(120,100) and offsetParent.left/top=(10,20).
    const jack = makePositionedJack('a', 120, 100);
    const bodyRectSpy = vi
      .spyOn(document.body, 'getBoundingClientRect')
      .mockReturnValue(rect(10, 20));
    try {
      expect(jack.getWorldPosition()).toEqual({ x: 55, y: 40 });
    } finally {
      // document.body is shared across every test in this file (unlike a
      // per-test jack element) — must restore explicitly or this spy leaks
      // into unrelated later tests.
      bodyRectSpy.mockRestore();
    }
  });

  it('keeps working after switching from explicit to auto mode (x/y attributes removed)', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 200, 150, { x: '1', y: '2' });
    expect(jack.getWorldPosition()).toEqual({ x: 1, y: 2 });

    jack.removeAttribute('x');
    jack.removeAttribute('y');
    expect(jack.getWorldPosition()).toEqual({ x: 200, y: 150 });
  });
});

/** Extracts just the `:host { ... }` rule body, since `.base`/`.hex`/`.inner` also use `position: absolute` for unrelated reasons. */
function hostRuleOf(jack: Jack): string {
  const style = jack.shadowRoot!.innerHTML;
  return style.slice(style.indexOf(':host {'), style.indexOf('.base {'));
}

describe('Jack rendering — position mode affects :host CSS', () => {
  it('explicit x/y mode keeps absolute positioning + centering transform', () => {
    const jack = makePositionedJack('a', 0, 0, { x: '10', y: '20' });
    const hostRule = hostRuleOf(jack);
    expect(hostRule).toContain('position: absolute;');
    expect(hostRule).toContain('transform: translate(-50%, -50%)');
  });

  it('auto mode leaves positioning entirely to the page CSS', () => {
    const jack = makePositionedJack('a', 0, 0);
    const hostRule = hostRuleOf(jack);
    expect(hostRule).not.toContain('position: absolute;');
    expect(hostRule).not.toContain('transform: translate(-50%, -50%)');
  });
});

describe('Jack auto-position re-sync (ResizeObserver + cavi-transform-change)', () => {
  let resizeCallbacks: (() => void)[];

  function stubResizeObserver() {
    resizeCallbacks = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resizeCallbacks.push(cb);
        }
        observe() {}
        disconnect() {}
      }
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-glues an attached plug when its own ResizeObserver fires', () => {
    stubResizeObserver();
    installFakeCavi();
    const jack = makePositionedJack('a', 42, 24);
    const snapToJack = vi.fn();
    jack.attach({ ...fakePlug(), snapToJack } as unknown as Plug);

    expect(resizeCallbacks.length).toBeGreaterThan(0);
    resizeCallbacks.forEach((cb) => cb());

    // Re-glued through Plug.snapToJack(), which reads this Jack's
    // getWorldPosition() — the single container-anchored, zoom-corrected
    // conversion every position in the library now goes through.
    expect(snapToJack).toHaveBeenCalled();
  });

  it('does not create a ResizeObserver for a Jack with explicit x/y', () => {
    stubResizeObserver();
    installFakeCavi();
    makePositionedJack('a', 0, 0, { x: '10', y: '20' });
    expect(resizeCallbacks.length).toBe(0);
  });

  it('re-glues an attached plug when Cavi fires cavi-transform-change on the container', () => {
    stubResizeObserver();
    const fake = installFakeCavi();
    const jack = makePositionedJack('a', 42, 24);
    const snapToJack = vi.fn();
    jack.attach({ ...fakePlug(), snapToJack } as unknown as Plug);

    (fake.getContainer() as HTMLElement).dispatchEvent(new CustomEvent('cavi-transform-change'));

    expect(snapToJack).toHaveBeenCalled();
  });
});

/**
 * Regression coverage for the screen/world mix-up that made everything
 * drift as soon as a consumer applied its own pan/zoom (see
 * demo-patchbay-zoom.html): world coordinates are now defined once, as
 * "unscaled px from the renderer container's padding-box origin", and every
 * conversion in Jack/Plug goes through that single anchor.
 */
describe('Jack coordinate space under zoom/pan', () => {
  /** A rect centered on (x, y), like a real jack's box (getCenter() reads the center). */
  function centeredRect(x: number, y: number, size: number): DOMRect {
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

  /** A stand-in <cavi-world> container with a mocked screen rect. */
  function makeContainer(left: number, top: number): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(left, top));
    return el;
  }

  it('regression: anchors on the renderer container, not the jack offsetParent', () => {
    // The bug this pins down: a page that nests any `position: relative`
    // wrapper (a CSS-Grid panel, a draggable module box) between
    // <cavi-world> and its jacks made that wrapper the jacks' offsetParent
    // while <cavi-plug> and the canvas kept resolving against the
    // container — so every jack in such a wrapper reported a position
    // short by the wrapper's offset, and its cable rendered detached from
    // it. Only the container is consulted now.
    const fake = installFakeCavi();
    fake.getContainer = () => makeContainer(10, 20);

    const jack = makePositionedJack('a', 120, 100);
    expect(jack.getWorldPosition()).toEqual({ x: 110, y: 80 });
  });

  it('reports the same world position at any zoom level', () => {
    const fake = installFakeCavi();
    const container = makeContainer(0, 0);
    fake.getContainer = () => container;

    const jack = makePositionedJack('a', 0, 0);
    const at = (scale: number, screenX: number, screenY: number) => {
      fake.getCoordinateTransform = () => ({ scale, translateX: 0, translateY: 0 });
      vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(
        centeredRect(screenX, screenY, 24 * scale)
      );
      return jack.getWorldPosition();
    };

    // World (55, 40) rendered at 1x, 2x and 0.5x — the same logical point
    // every time, which is exactly what the physics engine must be fed.
    expect(at(1, 55, 40)).toEqual({ x: 55, y: 40 });
    expect(at(2, 110, 80)).toEqual({ x: 55, y: 40 });
    expect(at(0.5, 27.5, 20)).toEqual({ x: 55, y: 40 });
  });

  it('regression: spreads plugs by a world-space radius, not a zoom-scaled one', () => {
    // _applySpreadPositions derives its radius from getBoundingClientRect()
    // (screen px, so already multiplied by the zoom) but hands the result
    // to setSpreadPosition, which takes *world* coordinates. Left
    // unconverted, hovering a jack at 2x flung its plugs twice as far out
    // as it should — the most visible symptom of the whole mix-up.
    const spreadAt = (scale: number): { x: number; y: number } => {
      const fake = installFakeCavi();
      const container = makeContainer(0, 0);
      fake.getContainer = () => container;
      fake.getCoordinateTransform = () => ({ scale, translateX: 0, translateY: 0 });

      const jack = makePositionedJack('a', 0, 0, { type: 'audio' });
      vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(centeredRect(0, 0, 24 * scale));

      const setSpreadPosition = vi.fn();
      jack.attach({ ...fakePlug(), setSpreadPosition } as unknown as Plug);

      Jack.setPointerHoverPosition(0, 0); // dead center of the jack
      expect(jack.isSpread()).toBe(true);
      expect(setSpreadPosition).toHaveBeenCalledTimes(1);

      const [x, y] = setSpreadPosition.mock.calls[0];
      jack.remove();
      return { x, y };
    };

    // 24px jack -> half-size 12 -> 12 * 1.8 (the default multiplier).
    const expected = 21.6;
    expect(spreadAt(1).x).toBeCloseTo(expected, 5);
    expect(spreadAt(2).x).toBeCloseTo(expected, 5);
    expect(spreadAt(0.5).x).toBeCloseTo(expected, 5);
  });

  it('regression: snaps by world distance, so the snap ring tracks what is drawn', () => {
    // CABLE_SNAP_DISTANCE is 20 *world* px. Compared in raw screen px (as
    // it used to be) the ring silently shrinks to a fraction of a jack when
    // zoomed in — here a plug 15 world px away, which visually overlaps the
    // jack, sits 30 screen px away at 2x and would refuse to connect.
    const fake = installFakeCavi();
    const container = makeContainer(0, 0);
    fake.getContainer = () => container;
    fake.getCoordinateTransform = () => ({ scale: 2, translateX: 0, translateY: 0 });

    const jack = makePositionedJack('target', 0, 0, { type: 'audio' });
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(centeredRect(0, 0, 48));

    const plug = {
      ...fakePlug(),
      getBoundingClientRect: () => centeredRect(30, 0, 24),
    } as unknown as Plug;

    expect(Jack.findSnapTarget(plug, 'audio')).toBe(jack);

    // ...and something genuinely out of world range still doesn't snap.
    const farPlug = {
      ...fakePlug(),
      getBoundingClientRect: () => centeredRect(100, 0, 24),
    } as unknown as Plug;
    expect(Jack.findSnapTarget(farPlug, 'audio')).toBeNull();
  });

  it('places a new cable under the cursor at any zoom/pan', () => {
    const fake = installFakeCavi();
    // A container that has itself been panned/zoomed on screen: its client
    // rect already carries the pan, so only the scale is left to divide out.
    const container = makeContainer(300, -40);
    fake.getContainer = () => container;
    fake.getCoordinateTransform = () => ({ scale: 2, translateX: 300, translateY: -40 });

    const jack = makePositionedJack('origin', 300, -40, { type: 'audio' });
    // Cursor at world (55, 40) => screen (300 + 110, -40 + 80).
    const session = jack.createCable(410, 40)!;
    const wire = session.wire as unknown as FakeWire;

    expect(wire.getNode(0)!.x).toBe(0); // the jack itself, world (0, 0)
    expect(wire.getNode(0)!.y).toBe(0);
    expect(session.followNode.x).toBe(55);
    expect(session.followNode.y).toBe(40);
  });
});
