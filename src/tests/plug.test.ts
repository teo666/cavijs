import { afterEach, describe, expect, it, vi } from 'vitest';
import { Jack } from '../component/jack';
import { Plug } from '../component/plug';
import { Cavi } from '../core/cavi';
import { Node } from '../core/node';
import type { CoordinateTransform } from '../core/coords';

/**
 * Plug is a pure domain/data element — these tests drive it entirely
 * through its public API (beginDrag/updateDragPosition/endDrag/
 * cancelDrag/setSpreadPosition), with no PointerEvent simulation at all.
 * Which gesture triggers which of these calls (including click-to-carry
 * and the Jack occlusion-forwarding case) is
 * StandardInteractionController's responsibility, tested separately in
 * interaction.test.ts.
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

/** Drives a full drag through the public API: begin, one position update, then end. */
function drag(plug: Plug, x: number, y: number): void {
  plug.beginDrag();
  plug.updateDragPosition(x, y);
  plug.endDrag();
}

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
});

describe('Plug drag & drop', () => {
  it('regression: dropping away from every jack leaves the node unfixed and unplugged', () => {
    makeJack('j1', 0, 0, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio');

    drag(plug, 500, 500);

    expect(node.fixed).toBe(false);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('snaps onto a compatible jack within range', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(105, 102, 'audio');

    drag(plug, 105, 102);

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(true);
    expect(jack.plugCount).toBe(1);
  });

  it('regression: snaps to the nearest compatible jack, not just the first one in range', () => {
    const near = makeJack('near', 102, 100, { type: 'audio' });
    const far = makeJack('far', 112, 100, { type: 'audio' });
    const { plug } = makePlug(100, 100, 'audio');

    drag(plug, 100, 100);

    expect(near.plugCount).toBe(1);
    expect(far.plugCount).toBe(0);
  });

  it('skips a jack that is already at max-plugs capacity in favor of the next compatible one', () => {
    const full = makeJack('full', 101, 100, { type: 'audio', 'max-plugs': '1' });
    full.attach({} as unknown as Plug);
    const open = makeJack('open', 110, 100, { type: 'audio' });
    const { plug } = makePlug(100, 100, 'audio');

    drag(plug, 100, 100);

    expect(full.plugCount).toBe(1);
    expect(open.plugCount).toBe(1);
  });

  it('does not snap onto an incompatible jack even if very close', () => {
    const jack = makeJack('j1', 100, 100, { type: 'cv' });
    const { plug, node } = makePlug(100, 100, 'audio');

    drag(plug, 100, 100);

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });

  it('freeze-on-drop keeps the node fixed in place when dropped away from every jack', () => {
    makeJack('j1', 0, 0, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio');
    plug.setAttribute('freeze-on-drop', '');

    drag(plug, 500, 500);

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('freeze-on-drop keeps the node fixed in place on a cancelled drag', () => {
    const { plug, node } = makePlug(500, 500, 'audio');
    plug.setAttribute('freeze-on-drop', '');

    plug.beginDrag();
    plug.cancelDrag();

    expect(node.fixed).toBe(true);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });

  it('regression: re-dragging an already-plugged plug unplugs it immediately, before drop', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');
    drag(plug, 101, 100);
    expect(jack.plugCount).toBe(1);

    plug.beginDrag(); // starts a new drag, no end yet

    expect(jack.plugCount).toBe(0);
    expect(plug.hasAttribute('plugged')).toBe(false);
  });
});

describe('Plug.endDrag / cancelDrag', () => {
  it('endDrag recomputes the snap target rather than trusting a stale magnet state', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(500, 500, 'audio');

    // No updateDragPosition call at all — a drop can happen with no
    // intervening move (e.g. a tap-release).
    plug.beginDrag();
    vi.spyOn(plug, 'getBoundingClientRect').mockReturnValue(rect(101, 100));
    plug.endDrag();

    expect(node.fixed).toBe(true);
    expect(jack.plugCount).toBe(1);
  });

  it('cancelDrag never snaps, even if a compatible jack is right there', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    plug.beginDrag();
    plug.updateDragPosition(101, 100);
    plug.cancelDrag();

    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });
});

describe('Plug magnet highlighting during drag', () => {
  it('activates magnet classes on both jack and plug when within snap range', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(105, 102, 'audio');

    plug.beginDrag();
    plug.updateDragPosition(105, 102);

    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);
    expect(plug.classList.contains('cavi-magnet-active')).toBe(true);

    plug.endDrag();
  });

  it('deactivates magnet classes once dragged out of range again', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(105, 102, 'audio');
    const spy = vi.spyOn(plug, 'getBoundingClientRect');

    plug.beginDrag();
    spy.mockReturnValue(rect(105, 102));
    plug.updateDragPosition(105, 102);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);

    spy.mockReturnValue(rect(900, 900));
    plug.updateDragPosition(900, 900);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
    expect(plug.classList.contains('cavi-magnet-active')).toBe(false);

    plug.endDrag();
  });

  it('clears magnet classes on cancelDrag without snapping', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');

    plug.beginDrag();
    plug.updateDragPosition(101, 100);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);

    plug.cancelDrag();

    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
    expect(node.fixed).toBe(false);
    expect(jack.plugCount).toBe(0);
  });
});

describe('Plug.jack accessor', () => {
  it('reflects the currently attached Jack, or null while unplugged', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug } = makePlug(101, 100, 'audio');

    expect(plug.jack).toBeNull();

    drag(plug, 101, 100);
    expect(plug.jack).toBe(jack);

    plug.beginDrag();
    expect(plug.jack).toBeNull();
  });
});

describe('Plug.isSpread', () => {
  it('is false while unplugged', () => {
    const { plug } = makePlug(0, 0);
    expect(plug.isSpread()).toBe(false);
  });

  it('delegates to its attached Jack.isSpread() once plugged in', () => {
    const jack = makeJack('j1', 0, 0, { type: 'audio' });
    const { plug } = makePlug(0, 0, 'audio');
    drag(plug, 0, 0);

    expect(plug.jack).toBe(jack);
    expect(plug.isSpread()).toBe(false); // jack never hovered — driving the spread itself is jack.test.ts's job
  });
});

describe('Plug.getOtherEndCenter', () => {
  it('returns null when this Plug has no sibling Plug (e.g. not inside a wire)', () => {
    const { plug } = makePlug(0, 0);
    expect(plug.getOtherEndCenter()).toBeNull();
  });

  it("returns the sibling <cavi-plug>'s on-screen center from the same parent element", () => {
    const wireEl = document.createElement('div');
    document.body.appendChild(wireEl);
    const a = document.createElement('cavi-plug') as Plug;
    const b = document.createElement('cavi-plug') as Plug;
    wireEl.appendChild(a);
    wireEl.appendChild(b);
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue(rect(50, 60));

    expect(a.getOtherEndCenter()).toEqual({ x: 50, y: 60 });
  });
});

describe('Plug.setSpreadPosition', () => {
  it('moves the node and rendered position without touching plugged/jack state', () => {
    const jack = makeJack('j1', 100, 100, { type: 'audio' });
    const { plug, node } = makePlug(101, 100, 'audio');
    drag(plug, 101, 100);
    expect(plug.jack).toBe(jack);

    plug.setSpreadPosition(40, 30);

    expect(node.x).toBe(40);
    expect(node.y).toBe(30);
    expect(plug.style.left).toBe('40px');
    expect(plug.style.top).toBe('30px');
    expect(plug.jack).toBe(jack); // still attached — spreading doesn't unplug
  });

  it('is a no-op mid-drag, so it never fights an in-progress user drag', () => {
    const { plug, node } = makePlug(0, 0, 'audio');
    plug.beginDrag();
    plug.updateDragPosition(10, 10);

    plug.setSpreadPosition(999, 999);

    expect(node.x).toBe(10);
    expect(node.y).toBe(10);
    plug.cancelDrag();
  });
});

/**
 * Plug's half of the screen<->world contract — see the matching
 * "Jack coordinate space under zoom/pan" block in jack.test.ts.
 */
describe('Plug coordinate space under zoom/pan', () => {
  /** Registers a minimal Cavi stand-in exposing just the two accessors Plug consults. */
  function installCavi(container: HTMLElement, transform: CoordinateTransform): void {
    Cavi.shared = {
      getContainer: () => container,
      getCoordinateTransform: () => transform,
    } as unknown as Cavi;
  }

  function makeContainer(left: number, top: number): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(left, top));
    return el;
  }

  it('drops a dragged plug exactly under the cursor, whatever the pan/zoom', () => {
    // The container lives inside the zoomed subtree, so its client rect
    // already carries the pan — only the scale is left to divide out.
    installCavi(makeContainer(300, -40), { scale: 2, translateX: 300, translateY: -40 });
    const { plug, node } = makePlug(0, 0, 'audio');

    plug.beginDrag();
    plug.updateDragPosition(300 + 55 * 2, -40 + 40 * 2);

    expect(node.x).toBe(55);
    expect(node.y).toBe(40);
    // The node position is also what the plug element renders at (inside
    // that same scaled subtree), so the two can never disagree.
    expect(plug.style.left).toBe('55px');
    expect(plug.style.top).toBe('40px');
    plug.cancelDrag();
  });

  it('feeds the physics mouse the world position, not the raw screen one', () => {
    installCavi(makeContainer(0, 0), { scale: 2, translateX: 0, translateY: 0 });
    const { plug, node } = makePlug(0, 0, 'audio');
    const setMousePosition = vi.spyOn(node, 'setMousePosition');

    plug.beginDrag();
    plug.updateDragPosition(110, 80);

    expect(setMousePosition).toHaveBeenCalledWith(55, 40);
    plug.cancelDrag();
  });

  it('snapToJack reads the jack world position rather than re-deriving it from screen px', () => {
    installCavi(makeContainer(0, 0), { scale: 2, translateX: 0, translateY: 0 });
    // An explicit-x/y jack: its attributes are the literal world position,
    // no matter where its box happens to render on screen.
    const jack = makeJack('j1', 9999, 9999, { type: 'audio', x: '70', y: '90' });
    const { plug, node } = makePlug(0, 0, 'audio');
    plug.attach(jack);

    plug.snapToJack();

    expect(node.x).toBe(70);
    expect(node.y).toBe(90);
  });

  it('snapToJack keeps an auto-positioned jack glued across a zoom change', () => {
    const container = makeContainer(0, 0);
    installCavi(container, { scale: 1, translateX: 0, translateY: 0 });
    const jack = makeJack('j1', 55, 40, { type: 'audio' }); // world (55, 40) at 1x
    const { plug, node } = makePlug(0, 0, 'audio');
    plug.attach(jack);

    plug.snapToJack();
    expect(node.x).toBe(55);

    // Zoom to 2x: the jack now *renders* at (110, 80), but it is still the
    // very same logical point, so the wire endpoint must not move.
    installCavi(container, { scale: 2, translateX: 0, translateY: 0 });
    vi.spyOn(jack, 'getBoundingClientRect').mockReturnValue(rect(110, 80));

    plug.snapToJack();
    expect(node.x).toBe(55);
    expect(node.y).toBe(40);
  });
});
