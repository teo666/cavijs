import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack, type CableSession } from './jack';
import { Cavi } from './cavi';
import type { Plug } from './plug';
import type { CaviWireElement } from './wirewc';
import { Node } from './node';

/**
 * Jack is a pure domain/data element — these tests drive it entirely
 * through its public API (createCable/updateCableSession/
 * finishCableSession/cancelCableSession, setShiftHeld/
 * setPointerHoverPosition/setDragActive), with no PointerEvent/keyboard
 * simulation at all. Which gesture (click vs right-click vs Shift, hold vs
 * click-to-carry, ...) triggers which of these calls is StandardInteraction
 * Controller's responsibility, tested separately in interaction.test.ts.
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
  Jack.setShiftHeld(false);
  Jack.setPointerHoverPosition(null, null);
});

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
function makePositionedJack(id: string, x: number, y: number, attrs: Record<string, string> = {}): Jack {
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
        next.push(new Node(first.x + (last.x - first.x) * t, first.y + (last.y - first.y) * t, false));
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

  addWire(x1: number, y1: number, x2: number, y2: number, nodes: number): FakeWire {
    this.lastWire = new FakeWire(x1, y1, x2, y2, nodes);
    return this.lastWire;
  }

  // CaviWireElement._setup() always calls this; not exercised by these
  // cable-creation tests (auto-cleanup isn't set), so a stub suffices.
  getContainer(): HTMLElement {
    return document.body;
  }

  deleteWire(): void {}
}

function installFakeCavi(): FakeCavi {
  const fake = new FakeCavi();
  Cavi.shared = fake as unknown as Cavi;
  return fake;
}

function getWireEl(): CaviWireElement {
  return document.querySelector('cavi-wire') as CaviWireElement;
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
      jack.attach({} as unknown as Plug);
    }
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('stops accepting once max-plugs is reached, and frees up on detach', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    const plug = {} as unknown as Plug;

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
    jack.attach({} as unknown as Plug);
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('toggles at-capacity-class unconditionally once max-plugs is reached, and clears it on detach', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    const plug = {} as unknown as Plug;

    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(false);

    jack.attach(plug);
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(true);

    jack.detach(plug);
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(false);
  });

  it('uses a custom class name from the at-capacity-class attribute', () => {
    const jack = makeJack({ 'max-plugs': '1', 'at-capacity-class': 'full-jack' });

    jack.attach({} as unknown as Plug);

    expect(jack.classList.contains('full-jack')).toBe(true);
    expect(jack.classList.contains('cavi-jack-at-capacity')).toBe(false);
  });

  it('applies at-capacity-class regardless of hover or Shift, unlike full-class', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rect(0, 0));

    jack.attach({} as unknown as Plug);

    // Neither hovered nor Shift held — full-class (the hover+Shift preview)
    // must stay off, but at-capacity-class (unconditional) must be on.
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
    jack.attach({} as unknown as Plug);
    expect(jack.createCable(0, 0)).toBeNull();
    expect(document.querySelector('cavi-wire')).toBeNull();
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
    installFakeCavi();
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
  it('finishCableSession leaves the origin attached and the free end unattached and unfixed', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const session = origin.createCable(300, 300)!;
    const followPlugEl = getFollowPlugEl(session.wireEl);
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(9999, 9999));

    Jack.finishCableSession(session);

    expect(origin.plugCount).toBe(1);
    expect(followPlugEl.hasAttribute('plugged')).toBe(false);
    const wire = session.wire as unknown as FakeWire;
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(false);
  });

  it('cancelCableSession behaves the same as finishing away from a jack', () => {
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

describe('Jack "full" hover feedback — Jack.setShiftHeld', () => {
  afterEach(() => {
    Jack.setShiftHeld(false);
    Jack.setPointerHoverPosition(null, null);
  });

  it('shows the forbidden cursor and full-class only once both hovered AND shift-held is true', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);

    Jack.setPointerHoverPosition(0, 0);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');

    Jack.setShiftHeld(true);
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);
    expect(jack.style.cursor).toBe('not-allowed');

    Jack.setShiftHeld(false);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('does not show the forbidden state for a jack with room, even hovered with shift-held true', () => {
    const jack = makePositionedJack('open', 0, 0, { type: 'audio' });
    Jack.setPointerHoverPosition(0, 0);
    Jack.setShiftHeld(true);

    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('clears the forbidden state once the pointer position moves away, even while shift-held stays true', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    Jack.setShiftHeld(true);
    Jack.setPointerHoverPosition(0, 0);
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    Jack.setPointerHoverPosition(9999, 9999);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('does not trigger for a jack far from the current pointer position', () => {
    const jack = makePositionedJack('full', 500, 500, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    Jack.setShiftHeld(true);
    Jack.setPointerHoverPosition(0, 0);

    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('re-evaluates live when the jack frees up while still hovered and shift-held', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    const plug = {} as unknown as Plug;
    jack.attach(plug);
    Jack.setShiftHeld(true);
    Jack.setPointerHoverPosition(0, 0);
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    jack.detach(plug);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('uses a custom class name from the full-class attribute', () => {
    const jack = makePositionedJack('full', 0, 0, {
      type: 'audio',
      'max-plugs': '1',
      'full-class': 'my-forbidden',
    });
    jack.attach({} as unknown as Plug);
    Jack.setShiftHeld(true);
    Jack.setPointerHoverPosition(0, 0);

    expect(jack.classList.contains('my-forbidden')).toBe(true);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('Jack "full" hover feedback — Jack.setDragActive (no shift needed)', () => {
  afterEach(() => {
    Jack.setPointerHoverPosition(null, null);
  });

  it('shows the forbidden cursor and full-class while hovered during a drag, without shift-held', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);

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
    jack.attach({} as unknown as Plug);
    Jack.setPointerHoverPosition(0, 0);

    Jack.setDragActive(true); // first drag starts
    Jack.setDragActive(true); // a second, overlapping drag starts
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    Jack.setDragActive(false); // first drag ends
    expect(jack.classList.contains('cavi-jack-full')).toBe(true); // second still in progress

    Jack.setDragActive(false); // second drag ends
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('keeps showing full-class for an in-progress cable session even after shift-held is cleared', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const target = makePositionedJack('target', 100, 0, { type: 'audio', 'max-plugs': '1' });
    target.attach({} as unknown as Plug);

    // Starting the drag needs Shift...
    Jack.setShiftHeld(true);
    const session: CableSession = origin.createCable(10, 0)!;
    Jack.setDragActive(true);
    // ...but not holding it — you don't need to keep holding it to keep
    // dragging the free end (existing, correct behavior) — so the
    // forbidden preview over a full target must persist too, not just
    // disappear the moment shift-held is cleared.
    Jack.setShiftHeld(false);
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
