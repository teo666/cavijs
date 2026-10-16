import { describe, expect, it, vi } from 'vitest';
import {
  clientToWorld,
  containerOrigin,
  IDENTITY_TRANSFORM,
  screenToWorld,
  worldToClient,
  worldToScreen,
  type CoordinateTransform,
} from '../core/coords';

/**
 * The screen<->world primitives every position in cavijs goes through.
 * Kept as plain functions (rather than methods on Cavi/Jack/Plug) precisely
 * so the arithmetic can be pinned down here, away from any DOM/WASM setup.
 */

function makeContainer(left: number, top: number, border: number = 0): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    right: left,
    bottom: top,
    width: 0,
    height: 0,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as unknown as DOMRect);
  // jsdom computes no layout, so clientLeft/clientTop are always 0 — define
  // them explicitly to model a container that actually has a border.
  Object.defineProperty(el, 'clientLeft', { value: border, configurable: true });
  Object.defineProperty(el, 'clientTop', { value: border, configurable: true });
  return el;
}

const ZOOM: CoordinateTransform = { scale: 2, translateX: 300, translateY: -40 };

describe('screenToWorld / worldToScreen', () => {
  it('are exact inverses of each other', () => {
    const screen = worldToScreen(55, 40, ZOOM);
    expect(screen).toEqual({ x: 55 * 2 + 300, y: 40 * 2 - 40 });
    expect(screenToWorld(screen.x, screen.y, ZOOM)).toEqual({ x: 55, y: 40 });
  });

  it('are the identity under IDENTITY_TRANSFORM', () => {
    expect(screenToWorld(12, 34, IDENTITY_TRANSFORM)).toEqual({ x: 12, y: 34 });
    expect(worldToScreen(12, 34, IDENTITY_TRANSFORM)).toEqual({ x: 12, y: 34 });
  });
});

describe('containerOrigin', () => {
  it('is the container client rect when it has no border', () => {
    const el = makeContainer(100, 50);
    expect(containerOrigin(el, 1)).toEqual({ x: 100, y: 50 });
  });

  it('adds the border width, so world (0,0) lands on the padding box', () => {
    // getBoundingClientRect() returns the *border* box, while a
    // <cavi-plug>'s absolute left/top and the renderer's canvas both
    // resolve against the *padding* box — without this the whole world is
    // offset by exactly the border width.
    const el = makeContainer(100, 50, 8);
    expect(containerOrigin(el, 1)).toEqual({ x: 108, y: 58 });
  });

  it('scales the border width by the current zoom (the rect is already scaled, the border is not)', () => {
    const el = makeContainer(100, 50, 8);
    expect(containerOrigin(el, 2)).toEqual({ x: 116, y: 66 });
  });

  it('falls back to the viewport origin for a missing container rather than throwing', () => {
    expect(containerOrigin(null, 3)).toEqual({ x: 0, y: 0 });
  });
});

describe('clientToWorld / worldToClient', () => {
  it('un-apply both the container offset and the zoom scale', () => {
    const el = makeContainer(300, -40);
    // The container itself lives inside the zoomed subtree, so its client
    // rect already carries the pan: only the scale is left to divide out.
    expect(clientToWorld(300 + 55 * 2, -40 + 40 * 2, el, ZOOM)).toEqual({ x: 55, y: 40 });
  });

  it('round-trip back to the exact same client point', () => {
    const el = makeContainer(300, -40, 4);
    const client = worldToClient(55, 40, el, ZOOM);
    expect(clientToWorld(client.x, client.y, el, ZOOM)).toEqual({ x: 55, y: 40 });
  });

  it('is a plain client-rect subtraction at zoom 1', () => {
    const el = makeContainer(10, 20);
    expect(clientToWorld(70, 90, el, IDENTITY_TRANSFORM)).toEqual({ x: 60, y: 70 });
  });
});
