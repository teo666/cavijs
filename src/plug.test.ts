import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack } from './jack';
import { Plug } from './plug';
import { Node } from './node';

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

/** Simulates a drag: pointerdown on the plug, optionally followed by pointerup. */
function drag(plug: Plug, complete = true, pointerId = 1): void {
  plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId, bubbles: true, button: 0 }));
  if (complete) {
    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId, bubbles: true }));
  }
}

/** Simulates a pointer move over the plug while it's being dragged. */
function move(plug: Plug, pointerId = 1): void {
  plug.dispatchEvent(new PointerEvent('pointermove', { pointerId, bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Plug drag & drop', () => {
  it('regression: dropping away from every jack leaves the node unfixed and unplugged', () => {
    makeJack('j1', 0, 0, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio');

    drag(plug);

    expect(node.fixed).toBe(false);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('snaps onto a compatible jack within range', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(105, 102, 'audio');

    drag(plug);

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(true);
    expect(jack.plugCount).toBe(1);
  });

  it('regression: snaps to the nearest compatible jack, not just the first one in range', () => {
    const near = makeJack('near', 102, 100, { type: 'audio' });
    const far = makeJack('far', 112, 100, { type: 'audio' });
    const { plug } = makePlug(100, 100, 'audio');

    drag(plug);

    expect(near.plugCount).toBe(1);
    expect(far.plugCount).toBe(0);
  });

  it('skips a jack that is already at max-plugs capacity in favor of the next compatible one', () => {
    const full = makeJack('full', 101, 100, { type: 'audio', 'max-plugs': '1' });
    full.attach({} as unknown as Plug);
    const open = makeJack('open', 110, 100, { type: 'audio' });
    const { plug } = makePlug(100, 100, 'audio');

    drag(plug);

    expect(full.plugCount).toBe(1);
    expect(open.plugCount).toBe(1);
  });

  it('does not snap onto an incompatible jack even if very close', () => {
    const jack = makeJack('j1', 100, 100, { type: 'cv' });
    const { plug, node } = makePlug(100, 100, 'audio');

    drag(plug);

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });

  it('freeze-on-drop keeps the node fixed in place when dropped away from every jack', () => {
    makeJack('j1', 0, 0, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio');
    plug.setAttribute('freeze-on-drop', '');

    drag(plug);

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('freeze-on-drop keeps the node fixed in place on a cancelled drag', () => {
    const { plug, node } = makePlug(500, 500, 'audio');
    plug.setAttribute('freeze-on-drop', '');

    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, button: 0 }));
    plug.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('regression: re-dragging an already-plugged plug unplugs it immediately, before drop', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    drag(plug);
    expect(jack.plugCount).toBe(1);

    drag(plug, false); // pointerdown only, no pointerup yet

    expect(jack.plugCount).toBe(0);
    expect(plug.hasAttribute('plugged')).toBe(false);

    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });
});

describe('Plug pointerdown with Shift held', () => {
  it('does not start a drag when Shift is held (reserved for cable creation from a Jack)', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    plug.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, button: 0, shiftKey: true })
    );
    move(plug);
    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });
});

describe('Plug forwards Jack cable-creation gestures while attached (occlusion fix)', () => {
  // While attached, a plug sits fixed exactly on top of its jack with a
  // higher z-index — in a real browser a right-click/Shift+click meant to
  // start a new cable from that jack physically lands on the plug instead.
  // These tests exercise the forwarding logic directly (jsdom doesn't do
  // hit-testing, so a real occlusion repro isn't possible here); the CSS
  // facts behind the occlusion itself are verified by code inspection.

  it('forwards a right-click on an attached plug to its jack, to start a new cable', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    drag(plug);
    expect(jack.plugCount).toBe(1);

    const spy = vi.spyOn(jack, 'handlePointerDown');
    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 2 }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('forwards a Shift+left-click on an attached plug to its jack too', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    drag(plug);
    expect(jack.plugCount).toBe(1);

    const spy = vi.spyOn(jack, 'handlePointerDown');
    plug.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 0, shiftKey: true })
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not forward a plain left-click on an attached plug — it still drags the plug itself', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    drag(plug);
    expect(jack.plugCount).toBe(1);

    const spy = vi.spyOn(jack, 'handlePointerDown');
    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 0 }));

    expect(spy).not.toHaveBeenCalled();
    expect(jack.plugCount).toBe(0); // unplugged immediately by its own re-drag, as before

    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }));
  });

  it('does not forward a right-click or Shift+click on a plug that is not attached to any jack', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(500, 500, 'audio'); // never dragged/snapped

    const spy = vi.spyOn(jack, 'handlePointerDown');
    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, bubbles: true, button: 2 }));
    plug.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 3, bubbles: true, button: 0, shiftKey: true })
    );

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Plug contextmenu suppression while attached to a jack', () => {
  it('prevents the native context menu when this plug is attached to a jack', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    drag(plug);
    expect(jack.plugCount).toBe(1);

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plug.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });

  it('does not prevent the context menu on a plug that is not attached to any jack', () => {
    const { plug } = makePlug(500, 500, 'audio');

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plug.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(false);
  });
});

describe('Jack forbidden-hover preview while an existing plug is dragged nearby (no Shift needed)', () => {
  it('shows full-class on a full jack while dragging an existing plug over it, and clears it after drop', () => {
    const full = makeJack('full', 100, 100, { type: 'audio', 'max-plugs': '1' });
    full.attach({} as unknown as Plug);
    const { plug } = makePlug(500, 500, 'audio');

    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, button: 0 }));
    plug.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 9, bubbles: true, clientX: 100, clientY: 100 })
    );

    expect(full.classList.contains('cavi-jack-full')).toBe(true);
    expect(full.style.cursor).toBe('not-allowed');

    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true }));

    expect(full.classList.contains('cavi-jack-full')).toBe(false);
  });

  it('clears the forbidden preview on a cancelled plug drag too', () => {
    const full = makeJack('full', 100, 100, { type: 'audio', 'max-plugs': '1' });
    full.attach({} as unknown as Plug);
    const { plug } = makePlug(500, 500, 'audio');

    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, button: 0 }));
    plug.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 9, bubbles: true, clientX: 100, clientY: 100 })
    );
    expect(full.classList.contains('cavi-jack-full')).toBe(true);

    plug.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9, bubbles: true }));

    expect(full.classList.contains('cavi-jack-full')).toBe(false);
  });
});

describe('Plug magnet highlighting during drag', () => {
  it('activates magnet classes on both jack and plug when within snap range', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(105, 102, 'audio');

    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, button: 0 }));
    move(plug);

    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);
    expect(plug.classList.contains('cavi-magnet-active')).toBe(true);

    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });

  it('deactivates magnet classes once dragged out of range again', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(105, 102, 'audio');
    const spy = vi.spyOn(plug, 'getBoundingClientRect');

    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, button: 0 }));
    spy.mockReturnValue(rect(105, 102));
    move(plug);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);

    spy.mockReturnValue(rect(900, 900));
    move(plug);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
    expect(plug.classList.contains('cavi-magnet-active')).toBe(false);

    plug.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  });

  it('clears magnet classes on pointercancel without snapping', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    plug.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true, button: 0 }));
    move(plug);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);

    plug.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));

    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });
});
