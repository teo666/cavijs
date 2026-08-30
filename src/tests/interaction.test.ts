import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack } from '../component/jack';
import { Plug } from '../component/plug';
import { Node } from '../core/node';
import { Cavi } from '../core/cavi';
import { StandardInteractionController } from '../interaction/interaction';
import type { CaviWireElement } from '../component/wirewc';

/**
 * StandardInteractionController is the only thing in this codebase that
 * still listens for real pointer events — these tests dispatch real
 * PointerEvent objects against a document with a controller attached, and
 * assert on the resulting Jack/Plug domain state. Jack/Plug's own domain
 * behavior (given a call to their public API, including the hover-spread
 * mechanic itself) is covered without any event simulation in
 * jack.test.ts/plug.test.ts — here we only care about which gesture
 * (a click on a Jack, a docked Plug, or a spread-out Plug) triggers which
 * domain call. Every gesture is plain left-click (button 0) or a touch tap
 * — there is no right-click or modifier-key branch, and mouse/pen always
 * use click-to-carry (touch keeps press-and-drag).
 */

function rect(x: number, y: number, size = 0): DOMRect {
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

function makeJack(id: string, x: number, y: number, attrs: Record<string, string> = {}): Jack {
  const el = document.createElement('cavi-jack') as Jack;
  el.id = id;
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(x, y));
  return el;
}

function makePlug(x: number, y: number, type = 'audio'): { plug: Plug; node: Node } {
  const el = document.createElement('cavi-plug') as Plug;
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(x, y));
  el.setType(type);

  const node = new Node(x, y, false);
  el.setNode(node);
  return { plug: el, node };
}

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
  addNodeAt(index: number, x: number, y: number, fixed: boolean): void {
    this.nodes.splice(index, 0, new Node(x, y, fixed));
  }
  setColor(): void {}
}

class FakeCavi {
  public getCableDropBehavior = (): 'cancel' | 'dangle' | 'detach' => 'detach';
  public getPlugSpreadMode = (): 'towardOther' | 'radial' => 'towardOther';
  public getPlugSpreadRadiusMultiplier = (): number => 1.8;
  public getPlugSpreadRecompactDelayMs = (): number => 500;
  addWire(x1: number, y1: number, x2: number, y2: number, nodes: number): FakeWire {
    return new FakeWire(x1, y1, x2, y2, nodes);
  }
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
  opts: { clientX: number; clientY: number; button?: number; pointerId?: number; pointerType?: string }
): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      button: opts.button ?? 0,
      clientX: opts.clientX,
      clientY: opts.clientY,
      pointerId: opts.pointerId ?? 1,
      pointerType: opts.pointerType ?? 'mouse',
    })
  );
}

function pointerMove(target: HTMLElement, clientX: number, clientY: number, pointerId = 1): void {
  target.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, composed: true, clientX, clientY, pointerId })
  );
}

function pointerUp(target: HTMLElement, clientX: number, clientY: number, pointerId = 1): void {
  target.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, composed: true, clientX, clientY, pointerId })
  );
}

let controller: StandardInteractionController;

afterEach(() => {
  // A couple of trigger-gating tests intentionally start a click-to-carry
  // gesture (plug drag or cable creation) without ever finishing it — left
  // alone, that would both leak Jack's static drag-active counter and, more
  // subtly, leave that gesture's document-level pointerdown/pointermove/
  // pointercancel listeners attached forever, silently hijacking the very
  // next test's first pointerdown (the capture-phase "finish" listener has
  // no pointerId filter and calls stopPropagation()). A broadcast
  // pointercancel cleanly unwinds any such straggler via its own
  // onCarryCancel handler; harmless no-op if nothing is in progress.
  document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
  controller?.detach();
  document.body.innerHTML = '';
  Cavi.shared = null;
  (Jack as unknown as { _activeDragCount: number })._activeDragCount = 0;
});

function attachController(): StandardInteractionController {
  controller = new StandardInteractionController();
  controller.attach(Cavi.shared as Cavi);
  return controller;
}

describe('StandardInteractionController — Plug drag (unattached plug, always click-to-carry)', () => {
  it('picks up on a click (no release needed), follows document pointermove, and snaps on the next click', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio');

    pointerDown(plug, { clientX: 500, clientY: 500 });
    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 40 }));
    expect(node.x).toBe(60);
    expect(node.y).toBe(40);

    vi.spyOn(plug, 'getBoundingClientRect').mockReturnValue(rect(101, 100));
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 0 }));

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(true);
    expect(jack.plugCount).toBe(1);
  });

  it('ignores a non-primary-button click while carrying — only a primary click finishes it', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(500, 500, 'audio');

    pointerDown(plug, { clientX: 500, clientY: 500 });
    vi.spyOn(plug, 'getBoundingClientRect').mockReturnValue(rect(101, 100));

    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 2 }));
    expect(jack.plugCount).toBe(0);

    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, bubbles: true, button: 0 }));
    expect(jack.plugCount).toBe(1);
  });

  it('keeps using hold-mode (press-drag-release) for touch even though mouse/pen always click-to-carry', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');

    pointerDown(plug, { clientX: 101, clientY: 100, pointerType: 'touch' });

    // A document-level click — which would finish a click-to-carry — must
    // NOT end a touch drag.
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 0 }));
    expect(jack.plugCount).toBe(0);

    // Only releasing on the plug itself, like hold mode, does.
    pointerUp(plug, 101, 100);
    expect(jack.plugCount).toBe(1);
  });

  it('regression: re-dragging an already-plugged, unspread plug forwards to its jack instead of moving it', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio', 'max-plugs': '2' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 0 }));
    expect(jack.plugCount).toBe(1);

    // The plug never spread (no hover happened) — clicking it again lands
    // on a docked Plug sitting on its Jack, so it forwards to a new cable
    // instead of picking the existing one up.
    pointerDown(plug, { clientX: 101, clientY: 100, pointerId: 3 });

    expect(document.querySelector('cavi-wire')).not.toBeNull();
    expect(jack.plugCount).toBe(2);
  });

  it('freeze-on-drop keeps the node fixed in place on a cancelled drag', () => {
    installFakeCavi();
    attachController();
    const { plug, node } = makePlug(500, 500, 'audio');
    plug.setAttribute('freeze-on-drop', '');

    pointerDown(plug, { clientX: 500, clientY: 500 });
    plug.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });
});

describe('StandardInteractionController — docked Plug forwards to its Jack', () => {
  it('forwards a click on an attached, never-spread plug to start a new cable from its jack', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio', 'max-plugs': '2' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 0 }));
    expect(jack.plugCount).toBe(1);

    pointerDown(plug, { clientX: 101, clientY: 100, pointerId: 3 });

    expect(document.querySelector('cavi-wire')).not.toBeNull();
    expect(jack.plugCount).toBe(2); // the pre-existing plug, plus the new cable's origin terminal
  });

  it('does not forward a click on a plug that is not attached to any jack — it drags the plug itself', () => {
    installFakeCavi();
    attachController();
    makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio'); // never dragged/snapped

    pointerDown(plug, { clientX: 500, clientY: 500 });

    expect(document.querySelector('cavi-wire')).toBeNull();
    expect(node.fixed).toBe(true); // picked up for its own drag instead
  });
});

describe('StandardInteractionController — Jack cable-creation trigger gating', () => {
  it('starts a new cable on a plain left click on an empty jack', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0 });
    expect(document.querySelector('cavi-wire')).not.toBeNull();
    expect(jack.plugCount).toBe(1);
  });

  it('does not start when the jack is already at max-plugs', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio', 'max-plugs': '1' });
    const { plug } = makePlug(0, 0, 'audio');
    plug.attach(jack);
    pointerDown(jack, { clientX: 0, clientY: 0 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('does nothing if Cavi is not ready yet', () => {
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('ignores a right-click on a jack — right-click is not part of the interaction anymore', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });
});

describe('StandardInteractionController — Jack cable creation (always click-to-carry for mouse)', () => {
  it('starts on a click (no release needed), grows via document pointermove, and snaps on the next click', () => {
    installFakeCavi();
    attachController();
    const origin = makeJack('origin', 0, 0, { type: 'audio' });
    const target = makeJack('target', 100, 0, { type: 'audio' });

    pointerDown(origin, { clientX: 10, clientY: 0 });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    expect(wireEl).not.toBeNull();

    const followPlugEl = wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(100, 0));

    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 0 }));
    expect(target.classList.contains('cavi-magnet-target')).toBe(true);

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 0 }));

    expect(target.plugCount).toBe(1);
    expect(origin.plugCount).toBe(1);
    expect(followPlugEl.hasAttribute('plugged')).toBe(true);
  });

  it('keeps using hold-mode (press-drag-release) for touch', () => {
    installFakeCavi();
    attachController();
    const origin = makeJack('origin', 0, 0, { type: 'audio' });
    const target = makeJack('target', 100, 0, { type: 'audio' });

    pointerDown(origin, { clientX: 10, clientY: 0, pointerType: 'touch' });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const followPlugEl = wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(100, 0));

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 0 }));
    expect(target.plugCount).toBe(0);

    pointerUp(origin, 100, 0);
    expect(target.plugCount).toBe(1);
  });
});

describe('StandardInteractionController — spread Plug is picked directly instead of forwarding', () => {
  it('clicking a plug once it has spread away from its jack center relocates it, not a new cable', () => {
    installFakeCavi();
    attachController();
    // A sizeable jack (non-zero rect) so hover-spread has room to compute a
    // real spread radius from _hoverRadius().
    const jack = document.createElement('cavi-jack') as Jack;
    jack.id = 'j1';
    jack.setAttribute('type', 'audio');
    jack.setAttribute('max-plugs', '2');
    document.body.appendChild(jack);
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 24));

    const { plug } = makePlug(0, 0, 'audio');
    plug.attach(jack);
    vi.spyOn(plug, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 24));

    // Hovering right at the jack's center is within its hover radius (half
    // the mocked 24px size) — this triggers the spread, moving the plug's
    // node (and so its rendered position) away from center.
    pointerMove(jack, 0, 0);
    expect(plug.isSpread()).toBe(true);

    // Click the plug element directly — since it's spread, this must
    // relocate it rather than forward to the jack, regardless of where the
    // browser would compute its (mocked, now-stale) bounding rect.
    pointerDown(plug, { clientX: 0, clientY: 0, pointerId: 2 });

    expect(document.querySelector('cavi-wire')).toBeNull();
  });
});

describe('StandardInteractionController — detach', () => {
  it('stops reacting to pointer events once detached', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    controller.detach();

    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });

  it('clears the tracked hover position on detach, so a full-jack preview held by an active drag disappears', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    const { plug } = makePlug(0, 0, 'audio');
    plug.attach(jack);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }));
    Jack.setDragActive(true); // simulate an in-progress drag showing the forbidden preview
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    controller.detach();

    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
    Jack.setDragActive(false);
  });
});
