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
