import type { IResizeController } from './types';

/**
 * Default IResizeController: watches `container` with a ResizeObserver,
 * keeps `canvas`'s backing store sized to match it, and dispatches a
 * `cavi-resize` CustomEvent on `container` after every resize so anyone who
 * derived jack/element positions from the container's CSS layout (e.g.
 * materializing <cavi-jack>s from CSS-positioned placeholders, see
 * repositionJacksFromSlots in src/example3.ts) can re-measure and stay in
 * sync with a responsive (flex/grid) layout instead of freezing at
 * load-time coordinates.
 */
export class StandardResizeController implements IResizeController {
  private _observer: ResizeObserver | null = null;
  private _container: HTMLElement | null = null;
  private _canvas: HTMLCanvasElement | null = null;

  public attach(container: HTMLElement, canvas: HTMLCanvasElement): void {
    if (this._observer) return; // already attached

    this._container = container;
    this._canvas = canvas;
    this._resizeCanvas();

    this._observer = new ResizeObserver(() => {
      this._resizeCanvas();
      this._container?.dispatchEvent(
        new CustomEvent('cavi-resize', {
          detail: { width: this._container!.clientWidth, height: this._container!.clientHeight },
        })
      );
    });
    this._observer.observe(container);
  }

  public detach(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._container = null;
    this._canvas = null;
  }

  private _resizeCanvas(): void {
    if (!this._container || !this._canvas) return;
    this._canvas.width = this._container.clientWidth;
    this._canvas.height = this._container.clientHeight;
  }
}
