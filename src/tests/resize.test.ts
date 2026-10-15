import { afterEach, describe, expect, it, vi } from 'vitest';
import { sizeCanvasToHost } from '../renderer/resize';

/** sizeCanvasToHost: the canvas covers its host, with a backing store at the device pixel ratio. */

afterEach(() => {
  vi.unstubAllGlobals();
});

function host(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  return el;
}

describe('sizeCanvasToHost', () => {
  it("matches the host's CSS size, with a backing store devicePixelRatio times bigger", () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const canvas = document.createElement('canvas');

    expect(sizeCanvasToHost(canvas, host(300, 150.4))).toBe(true);

    expect(canvas.style.width).toBe('300px');
    expect(canvas.style.height).toBe('150.4px');
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(301); // rounded
  });

  it('reports no change, and touches nothing, when the size is already right', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = document.createElement('canvas');
    const el = host(200, 100);
    sizeCanvasToHost(canvas, el);
    const setWidth = vi.spyOn(canvas, 'width', 'set');

    expect(sizeCanvasToHost(canvas, el)).toBe(false);
    expect(setWidth).not.toHaveBeenCalled();
  });

  it('resizes the backing store when only the pixel ratio changed (zoom, other screen)', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const canvas = document.createElement('canvas');
    const el = host(200, 100);
    sizeCanvasToHost(canvas, el);

    vi.stubGlobal('devicePixelRatio', 1.5);
    expect(sizeCanvasToHost(canvas, el)).toBe(true);
    expect(canvas.width).toBe(300);
    expect(canvas.style.width).toBe('200px');
  });

  it('falls back to a ratio of 1 when the browser reports none', () => {
    vi.stubGlobal('devicePixelRatio', 0);
    const canvas = document.createElement('canvas');
    sizeCanvasToHost(canvas, host(120, 80));
    expect(canvas.width).toBe(120);
  });
});
