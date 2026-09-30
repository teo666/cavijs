import type { IResizeController } from '../core/types';

/**
 * Sizes `canvas` to cover `host` at device-pixel resolution: the backing
 * store is `devicePixelRatio` times the CSS size (so strokes stay crisp on
 * HiDPI screens), while the CSS size stays exactly the host's client box.
 * Renderer derives the ratio back from canvas.width / canvas.clientWidth,
 * so a custom IResizeController that doesn't scale keeps working.
 *
 * Only touches what actually changed, and returns whether the backing
 * store was resized: assigning canvas.width/height — even to the same
 * value — clears the canvas. Doing that from a ResizeObserver callback
 * (which runs after the frame's drawing, right before paint) blanked every
 * cable for as long as the container kept resizing, e.g. while dragging a
 * module that grows it.
 */
export function sizeCanvasToHost(canvas: HTMLCanvasElement, host: HTMLElement): boolean {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const width = host.clientWidth;
  const height = host.clientHeight;
  const cssWidth = `${width}px`;
  const cssHeight = `${height}px`;
  if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;

  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);
  if (canvas.width === backingWidth && canvas.height === backingHeight) return false;
  canvas.width = backingWidth;
  canvas.height = backingHeight;
  return true;
}

/**
 * Default IResizeController: watches `container` with a ResizeObserver,
 * keeps `canvas`'s backing store sized to match it (or to `surface`, when
 * given — see RendererOptions.surface), and dispatches a `cavi-resize`
 * CustomEvent on `container` after every resize so anyone who derived
 * jack/element positions from the container's CSS layout (e.g.
 * materializing <cavi-jack>s from CSS-positioned placeholders, see
 * repositionJacksFromSlots in examples/patchbay-shared.ts) can re-measure
 * and stay in sync with a responsive (flex/grid) layout instead of freezing
 * at load-time coordinates.
 */
export class StandardResizeController implements IResizeController {
  private _observer: ResizeObserver | null = null;
  private _container: HTMLElement | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _surface: HTMLElement | null = null;

  public attach(container: HTMLElement, canvas: HTMLCanvasElement, surface?: HTMLElement): void {
    if (this._observer) return; // already attached

    this._container = container;
    this._canvas = canvas;
    this._surface = surface ?? null;
    this._resizeCanvas();

    this._observer = new ResizeObserver((entries) => {
      this._resizeCanvas();
      if (entries.some((entry) => entry.target === this._container)) {
        this._container?.dispatchEvent(
          new CustomEvent('cavi-resize', {
            detail: { width: this._container!.clientWidth, height: this._container!.clientHeight },
          })
        );
      }
    });
    this._observer.observe(container);
    if (this._surface && this._surface !== container) this._observer.observe(this._surface);
  }

  public detach(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._container = null;
    this._canvas = null;
    this._surface = null;
  }

  private _resizeCanvas(): void {
    const host = this._surface ?? this._container;
    if (!host || !this._canvas) return;
    sizeCanvasToHost(this._canvas, host);
  }
}
