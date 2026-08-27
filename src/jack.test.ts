import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack } from './jack';
import { Cavi } from './cavi';
import type { Plug } from './plug';
import type { CaviWireElement } from './wirewc';
import { Node } from './node';

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
  // Several trigger-gating tests intentionally start a cable-creation drag
  // without ever finishing it (pointerup/pointercancel), since they only
  // care whether it started — left alone, that would permanently leak
  // Jack's static drag-active counter into every later test in this file.
  (Jack as unknown as { _activeDragCount: number })._activeDragCount = 0;
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

/** A positioned Jack, appended to the document, ready for pointer-driven drag tests. */
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
 * interpolate discarded intermediates) to drive Jack's cable-creation drag
 * without needing a real WASM module in jsdom.
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
  // cable-creation-drag tests (auto-cleanup isn't set), so a stub suffices.
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

function pointerDown(
  target: HTMLElement,
  opts: { clientX: number; clientY: number; button?: number; shiftKey?: boolean; pointerId?: number }
): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: opts.button ?? 0,
      shiftKey: opts.shiftKey ?? false,
      clientX: opts.clientX,
      clientY: opts.clientY,
      pointerId: opts.pointerId ?? 1,
    })
  );
}

function pointerMove(target: HTMLElement, clientX: number, clientY: number, pointerId = 1): void {
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY, pointerId }));
}

function pointerUp(target: HTMLElement, clientX: number, clientY: number, pointerId = 1): void {
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX, clientY, pointerId }));
}

function pointerCancel(target: HTMLElement, pointerId = 1): void {
  target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }));
}

function shiftDown(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
}

function shiftUp(): void {
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
}

/**
 * Moves the globally-tracked pointer position used by Jack's "full jack"
 * hover preview. A document-level pointermove is used (rather than
 * pointerenter/pointerleave on the jack itself) because an attached Plug
 * sits exactly on top of its Jack and would otherwise swallow native hover
 * events before they reach the jack underneath.
 */
function movePointerTo(clientX: number, clientY: number): void {
  document.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, pointerId: 1 }));
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

describe('Jack cable-creation drag — trigger gating', () => {
  it('does nothing on a plain left click (no modifier)', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 0 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('starts on right-click', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).not.toBeNull();
  });

  it('starts on shift+left-click', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 0, shiftKey: true });
    expect(document.querySelector('cavi-wire')).not.toBeNull();
  });

  it('does not start when the jack is already at max-plugs', () => {
    installFakeCavi();
    const jack = makePositionedJack('a', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('does nothing if Cavi is not ready yet', () => {
    const jack = makePositionedJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });
});

describe('Jack cable-creation drag — creates the cable', () => {
  it('attaches the origin plug to this Jack and places the free plug at the cursor', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 50, 60, { type: 'audio' });
    pointerDown(jack, { clientX: 200, clientY: 220, button: 2 });

    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    expect(wireEl).not.toBeNull();
    const wire = wireEl.getWire() as unknown as FakeWire;
    expect(wire.getNodeCount()).toBe(4);

    expect(jack.plugCount).toBe(1);
    const plugs = wireEl.querySelectorAll('cavi-plug');
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
});

describe('Jack cable-creation drag — node count follows distance', () => {
  it('grows as the cursor moves away, and never shrinks back as it comes closer again', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const wire = wireEl.getWire() as unknown as FakeWire;
    expect(wire.getNodeCount()).toBe(4);

    pointerMove(jack, 100, 0); // distance 100 -> 4 + floor(100/30) = 7
    expect(wire.getNodeCount()).toBe(7);

    pointerMove(jack, 400, 0); // distance 400 -> 4 + floor(400/30) = 17
    expect(wire.getNodeCount()).toBe(17);

    pointerMove(jack, 5, 0); // back close -> the cable stays pulled out, no shortening
    expect(wire.getNodeCount()).toBe(17);

    pointerMove(jack, 250, 0); // distance 250 -> 4 + floor(250/30) = 12, still below the 17 already reached
    expect(wire.getNodeCount()).toBe(17);
  });

  it('caps node count at the configured maximum', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const wire = wireEl.getWire() as unknown as FakeWire;

    pointerMove(jack, 5000, 0);
    expect(wire.getNodeCount()).toBe(60);
  });
});

describe('Jack cable-creation drag — world-mouse interaction', () => {
  it('keeps feeding the world-mouse position on every pointermove', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const setMouseSpy = vi.spyOn(Node.prototype, 'setMousePosition');
    try {
      pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });

      pointerMove(jack, 42, 7);

      // Guards against a regression to the bug this call fixes: Jack's own
      // preventDefault() in handlePointerDown (needed to suppress text
      // selection during Shift+drag) suppresses the native mousemove that
      // Renderer's world-mouse listener relies on for the rest of the
      // interaction, freezing physics repulsion of other wires unless the
      // free node's setMousePosition keeps feeding it directly.
      expect(setMouseSpy).toHaveBeenCalledWith(42, 7);
    } finally {
      setMouseSpy.mockRestore();
    }
  });
});

describe('Jack cable-creation drag — incremental node insertion', () => {
  it('leaves an already-settled intermediate node untouched by a later growth step', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const wire = wireEl.getWire() as unknown as FakeWire;

    pointerMove(jack, 100, 0); // grows 4 -> 7
    expect(wire.getNodeCount()).toBe(7);

    // Simulate physics having settled this intermediate node somewhere far
    // from wherever it was placed on insertion.
    wire.getNode(2)!.setPosition(999, 888);

    pointerMove(jack, 400, 0); // grows further, 7 -> 17
    expect(wire.getNodeCount()).toBe(17);

    const settled = wire.getNode(2)!;
    expect(settled.x).toBe(999);
    expect(settled.y).toBe(888);
  });

  it('spawns newly-inserted nodes interpolated toward the cursor by default', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const wire = wireEl.getWire() as unknown as FakeWire;

    const anchor = wire.getNode(2)!; // last settled node before the free terminal
    const anchorX = anchor.x;
    const anchorY = anchor.y;

    pointerMove(jack, 30, 0); // distance 30 -> desired 5, exactly one new node
    expect(wire.getNodeCount()).toBe(5);

    const inserted = wire.getNode(3)!; // inserted right before the shifted free terminal
    expect(inserted.x).toBeCloseTo((anchorX + 30) / 2);
    expect(inserted.y).toBeCloseTo(anchorY / 2);
  });

  it('spawns newly-inserted nodes stacked on the last settled node with cable-node-spawn="stack"', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio', 'cable-node-spawn': 'stack' });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const wire = wireEl.getWire() as unknown as FakeWire;

    const anchor = wire.getNode(2)!;
    const anchorX = anchor.x;
    const anchorY = anchor.y;

    pointerMove(jack, 30, 0);
    expect(wire.getNodeCount()).toBe(5);

    const inserted = wire.getNode(3)!;
    expect(inserted.x).toBe(anchorX);
    expect(inserted.y).toBe(anchorY);
  });
});

describe('Jack cable-creation drag — magnet preview and snap on release', () => {
  it('highlights a compatible jack within range while dragging, and snaps to it on release', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const target = makePositionedJack('target', 100, 0, { type: 'audio' });

    pointerDown(origin, { clientX: 10, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const followPlugEl = wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
    const followRect = vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(90, 0));

    pointerMove(origin, 90, 0);
    expect(target.classList.contains('cavi-magnet-target')).toBe(true);
    expect(followPlugEl.classList.contains('cavi-magnet-active')).toBe(true);

    followRect.mockReturnValue(rect(100, 0));
    pointerUp(origin, 100, 0);

    expect(target.plugCount).toBe(1);
    expect(origin.plugCount).toBe(1);
    expect(followPlugEl.hasAttribute('plugged')).toBe(true);
    expect(target.classList.contains('cavi-magnet-target')).toBe(false);

    const wire = wireEl.getWire() as unknown as FakeWire;
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(true);
    expect(followNode.x).toBe(100);
    expect(followNode.y).toBe(0);
  });

  it('does not offer this same Jack as its own snap target', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio', 'max-plugs': '2' });
    pointerDown(origin, { clientX: 5, clientY: 0, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const followPlugEl = wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(1, 0));

    pointerUp(origin, 1, 0);

    expect(origin.plugCount).toBe(1); // only the origin terminal, not both
    expect(followPlugEl.hasAttribute('plugged')).toBe(false);
  });
});

describe('Jack cable-creation drag — release away from any jack', () => {
  it('leaves the origin attached and the free end unattached and unfixed', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(origin, { clientX: 300, clientY: 300, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const followPlugEl = wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(9999, 9999));

    pointerUp(origin, 300, 300);

    expect(origin.plugCount).toBe(1);
    expect(followPlugEl.hasAttribute('plugged')).toBe(false);
    const wire = wireEl.getWire() as unknown as FakeWire;
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(false);
  });

  it('pointercancel behaves the same as releasing away from a jack', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(origin, { clientX: 300, clientY: 300, button: 2 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;

    pointerCancel(origin);

    expect(origin.plugCount).toBe(1);
    const wire = wireEl.getWire() as unknown as FakeWire;
    const followNode = wire.getNode(wire.getNodeCount() - 1)!;
    expect(followNode.fixed).toBe(false);
  });
});

describe('Jack "full" hover feedback while Shift is held', () => {
  afterEach(() => {
    shiftUp(); // avoid leaking "shift held" state into other tests
    movePointerTo(-99999, -99999); // avoid leaking the last hover position too
  });

  it('shows the forbidden cursor and full-class only once both hovered AND Shift is held', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);

    movePointerTo(0, 0);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');

    shiftDown();
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);
    expect(jack.style.cursor).toBe('not-allowed');

    shiftUp();
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('does not show the forbidden state for a jack with room, even hovered with Shift held', () => {
    const jack = makePositionedJack('open', 0, 0, { type: 'audio' });
    movePointerTo(0, 0);
    shiftDown();

    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('clears the forbidden state once the pointer moves away, even while Shift stays held', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    shiftDown();
    movePointerTo(0, 0);
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    movePointerTo(9999, 9999);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    expect(jack.style.cursor).toBe('');
  });

  it('does not trigger for a jack far from the current pointer position', () => {
    const jack = makePositionedJack('full', 500, 500, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    shiftDown();
    movePointerTo(0, 0);

    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('re-evaluates live when the jack frees up while still hovered and Shift held', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    const plug = {} as unknown as Plug;
    jack.attach(plug);
    shiftDown();
    movePointerTo(0, 0);
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
    shiftDown();
    movePointerTo(0, 0);

    expect(jack.classList.contains('my-forbidden')).toBe(true);
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('Jack "full" hover feedback while a drag is active (no Shift needed)', () => {
  // Each test below balances every setDragActive(true) with a matching
  // (false) itself — don't add an unconditional cleanup call here, it would
  // double-decrement an already-balanced counter and desync the next test.
  afterEach(() => {
    movePointerTo(-99999, -99999);
  });

  it('shows the forbidden cursor and full-class while hovered during a drag, without Shift', () => {
    const jack = makePositionedJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);

    movePointerTo(0, 0);
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
    movePointerTo(0, 0);

    Jack.setDragActive(true); // first drag starts
    Jack.setDragActive(true); // a second, overlapping drag starts
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    Jack.setDragActive(false); // first drag ends
    expect(jack.classList.contains('cavi-jack-full')).toBe(true); // second still in progress

    Jack.setDragActive(false); // second drag ends
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('keeps showing full-class for an in-progress cable-creation drag even after Shift is released', () => {
    installFakeCavi();
    const origin = makePositionedJack('origin', 0, 0, { type: 'audio' });
    const target = makePositionedJack('target', 100, 0, { type: 'audio', 'max-plugs': '1' });
    target.attach({} as unknown as Plug);

    // Holding Shift and clicking starts the cable-creation drag...
    shiftDown();
    pointerDown(origin, { clientX: 10, clientY: 0, button: 0, shiftKey: true });
    // ...then Shift is released while the drag is still going — you don't
    // need to keep holding it to keep dragging the free end (existing,
    // correct behavior) — so the forbidden preview over a full target must
    // persist too, not just disappear the moment Shift comes up.
    shiftUp();
    pointerMove(origin, 100, 0);

    expect(target.classList.contains('cavi-jack-full')).toBe(true);
    expect(target.style.cursor).toBe('not-allowed');

    pointerUp(origin, 9999, 9999); // release away from the (full) target
    expect(target.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('Jack cable-creation drag — style inherited from the jack', () => {
  it('applies cable-tension/cable-size/cable-color from the jack to the new wire', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, {
      type: 'audio',
      'cable-tension': '42',
      'cable-size': '9',
      'cable-color': '#ff0000',
    });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });

    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    expect(wireEl.getAttribute('tension')).toBe('42');
    expect(wireEl.getAttribute('size')).toBe('9');
    expect(wireEl.getAttribute('color')).toBe('#ff0000');
  });

  it('leaves tension/size/color unset (default) when the jack does not specify them', () => {
    installFakeCavi();
    const jack = makePositionedJack('origin', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 10, clientY: 0, button: 2 });

    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    expect(wireEl.hasAttribute('tension')).toBe(false);
    expect(wireEl.hasAttribute('size')).toBe(false);
    expect(wireEl.hasAttribute('color')).toBe(false);
  });
});
