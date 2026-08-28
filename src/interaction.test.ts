import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack } from './jack';
import { Plug } from './plug';
import { Node } from './node';
import { Cavi } from './cavi';
import { StandardInteractionController } from './interaction';
import type { CaviWireElement } from './wirewc';

/**
 * StandardInteractionController is the only thing in this codebase that
 * still listens for real pointer/keyboard events — these tests dispatch
 * real PointerEvent/KeyboardEvent/MouseEvent objects against a document
 * with a controller attached, and assert on the resulting Jack/Plug domain
 * state. Jack/Plug's own domain behavior (given a call to their public API)
 * is covered without any event simulation in jack.test.ts/plug.test.ts.
 */

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
  public dragMode: 'hold' | 'click' = 'hold';
  getDragMode(): 'hold' | 'click' {
    return this.dragMode;
  }
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
  opts: { clientX: number; clientY: number; button?: number; shiftKey?: boolean; pointerId?: number; pointerType?: string }
): void {
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      button: opts.button ?? 0,
      shiftKey: opts.shiftKey ?? false,
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
  controller?.detach();
  document.body.innerHTML = '';
  Cavi.shared = null;
  // A couple of trigger-gating tests intentionally start a cable-creation
  // drag without ever finishing it (pointerup/pointercancel), since they
  // only care whether it started — left alone, that would permanently leak
  // Jack's static drag-active counter into every later test in this file.
  (Jack as unknown as { _activeDragCount: number })._activeDragCount = 0;
});

function attachController(): StandardInteractionController {
  controller = new StandardInteractionController();
  controller.attach(Cavi.shared as Cavi);
  return controller;
}

describe('StandardInteractionController — Plug drag trigger gating', () => {
  it('starts a drag on a plain left click and snaps on release', () => {
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);

    expect(node.fixed).toBe(true);
    expect(jack.plugCount).toBe(1);
  });

  it('does not start a drag when Shift is held (reserved for cable creation from a Jack)', () => {
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    pointerDown(plug, { clientX: 101, clientY: 100, shiftKey: true });
    pointerMove(plug, 101, 100);
    pointerUp(plug, 101, 100);

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('does nothing on a right-click over a plug not attached to any jack', () => {
    attachController();
    const { plug, node } = makePlug(500, 500, 'audio');

    pointerDown(plug, { clientX: 500, clientY: 500, button: 2 });

    expect(node.fixed).toBe(false);
  });
});

describe('StandardInteractionController — Plug drag, hold mode', () => {
  it('regression: re-dragging an already-plugged plug unplugs it immediately, before drop', () => {
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);
    expect(jack.plugCount).toBe(1);

    pointerDown(plug, { clientX: 101, clientY: 100, pointerId: 2 }); // no matching pointerup yet

    expect(jack.plugCount).toBe(0);
    expect(plug.hasAttribute('plugged')).toBe(false);

    pointerUp(plug, 101, 100, 2);
  });

  it('freeze-on-drop keeps the node fixed in place on a cancelled drag', () => {
    attachController();
    const { plug, node } = makePlug(500, 500, 'audio');
    plug.setAttribute('freeze-on-drop', '');

    pointerDown(plug, { clientX: 500, clientY: 500 });
    plug.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });
});

describe('StandardInteractionController — Plug drag, click-to-carry mode', () => {
  it('picks up on a click (no release needed), follows document pointermove, and snaps on the next click', () => {
    const fake = installFakeCavi();
    fake.dragMode = 'click';
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
    const fake = installFakeCavi();
    fake.dragMode = 'click';
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

  it('keeps using hold-mode (press-drag-release) for touch even when click-to-carry is enabled', () => {
    const fake = installFakeCavi();
    fake.dragMode = 'click';
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
});

describe('StandardInteractionController — occlusion: Jack cable creation via an attached Plug', () => {
  it('forwards a right-click on an attached plug to start a new cable from its jack', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio', 'max-plugs': '2' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);
    expect(jack.plugCount).toBe(1);

    pointerDown(plug, { clientX: 101, clientY: 100, button: 2, pointerId: 2 });

    expect(document.querySelector('cavi-wire')).not.toBeNull();
    expect(jack.plugCount).toBe(2); // the pre-existing plug, plus the new cable's origin terminal

    // The forwarded gesture's listeners are on the jack (the cable-creation
    // drag source), not the occluded plug that physically received the
    // pointerdown — same as a real browser, where pointer capture keeps
    // delivering events to the jack regardless of what's visually on top.
    pointerUp(jack, 101, 100, 2);
  });

  it('forwards a Shift+left-click on an attached plug too', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio', 'max-plugs': '2' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);

    pointerDown(plug, { clientX: 101, clientY: 100, shiftKey: true, pointerId: 2 });

    expect(document.querySelector('cavi-wire')).not.toBeNull();
    pointerUp(jack, 101, 100, 2);
  });

  it('does not forward a plain left-click on an attached plug — it still drags the plug itself', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);
    expect(jack.plugCount).toBe(1);

    pointerDown(plug, { clientX: 101, clientY: 100, pointerId: 2 });

    expect(document.querySelector('cavi-wire')).toBeNull();
    expect(jack.plugCount).toBe(0); // unplugged immediately by its own re-drag

    pointerUp(plug, 101, 100, 2);
  });

  it('does not forward a right-click or Shift+click on a plug that is not attached to any jack', () => {
    installFakeCavi();
    attachController();
    makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(500, 500, 'audio'); // never dragged/snapped

    pointerDown(plug, { clientX: 500, clientY: 500, button: 2 });
    pointerDown(plug, { clientX: 500, clientY: 500, shiftKey: true, pointerId: 2 });

    expect(document.querySelector('cavi-wire')).toBeNull();
  });
});

describe('StandardInteractionController — Jack cable-creation trigger gating', () => {
  it('does nothing on a plain left click (no modifier)', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('starts on right-click', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).not.toBeNull();
  });

  it('starts on shift+left-click', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, shiftKey: true });
    expect(document.querySelector('cavi-wire')).not.toBeNull();
  });

  it('does not start when the jack is already at max-plugs', () => {
    installFakeCavi();
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });

  it('does nothing if Cavi is not ready yet', () => {
    attachController();
    const jack = makeJack('a', 0, 0, { type: 'audio' });
    pointerDown(jack, { clientX: 0, clientY: 0, button: 2 });
    expect(document.querySelector('cavi-wire')).toBeNull();
  });
});

describe('StandardInteractionController — Jack cable creation, click-to-carry mode', () => {
  it('starts on a click (no release needed), grows via document pointermove, and snaps on the next click', () => {
    const fake = installFakeCavi();
    fake.dragMode = 'click';
    attachController();
    const origin = makeJack('origin', 0, 0, { type: 'audio' });
    const target = makeJack('target', 100, 0, { type: 'audio' });

    pointerDown(origin, { clientX: 10, clientY: 0, button: 2 });
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

  it('keeps using hold-mode (press-drag-release) for touch even when click-to-carry is enabled', () => {
    const fake = installFakeCavi();
    fake.dragMode = 'click';
    attachController();
    const origin = makeJack('origin', 0, 0, { type: 'audio' });
    const target = makeJack('target', 100, 0, { type: 'audio' });

    pointerDown(origin, { clientX: 10, clientY: 0, button: 2, pointerType: 'touch' });
    const wireEl = document.querySelector('cavi-wire') as CaviWireElement;
    const followPlugEl = wireEl.querySelectorAll('cavi-plug')[1] as HTMLElement;
    vi.spyOn(followPlugEl, 'getBoundingClientRect').mockReturnValue(rect(100, 0));

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 0 }));
    expect(target.plugCount).toBe(0);

    pointerUp(origin, 100, 0);
    expect(target.plugCount).toBe(1);
  });
});

describe('StandardInteractionController — contextmenu suppression', () => {
  it('prevents the native context menu on a Jack', () => {
    attachController();
    const jack = makeJack('j1', 0, 0, { type: 'audio' });

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    jack.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });

  it('prevents the native context menu on a Plug attached to a jack', () => {
    installFakeCavi();
    attachController();
    makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plug.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });

  it('does not prevent the context menu on a plug that is not attached to any jack', () => {
    attachController();
    const { plug } = makePlug(500, 500, 'audio');

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plug.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(false);
  });
});

describe('StandardInteractionController — Shift/hover "full jack" preview', () => {
  it('shows the forbidden cursor and full-class only once both hovered AND Shift is held', () => {
    attachController();
    const jack = makeJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }));
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);
    expect(jack.style.cursor).toBe('not-allowed');

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('clears the Shift-held state on window blur', () => {
    attachController();
    const jack = makeJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);

    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    window.dispatchEvent(new Event('blur'));
    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('StandardInteractionController — detach', () => {
  it('stops reacting to pointer events once detached', () => {
    attachController();
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    controller.detach();

    pointerDown(plug, { clientX: 101, clientY: 100 });
    pointerUp(plug, 101, 100);

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });

  it('clears any stuck Shift/hover state on detach', () => {
    attachController();
    const jack = makeJack('full', 0, 0, { type: 'audio', 'max-plugs': '1' });
    jack.attach({} as unknown as Plug);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 0, clientY: 0 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
    expect(jack.classList.contains('cavi-jack-full')).toBe(true);

    controller.detach();

    expect(jack.classList.contains('cavi-jack-full')).toBe(false);
  });
});
