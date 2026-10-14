import type { World } from '../core/world';
import { clientToWorld } from '../core/coords';

/**
 * Feeds the physics engine's mouse-repulsion position from the page's
 * pointer, for Renderer and SvgRenderer alike. Listens on the document (not
 * the container) so it keeps working over every part of the drawing
 * surface — including areas outside the container's own box once a
 * consumer zooms out — and converts through the same container-anchored,
 * zoom-aware clientToWorld every other pointer position goes through.
 *
 * The engine applies its mouse to every cable on every step, so whenever no
 * pointer is actually hovering the surface the mouse is parked out of reach
 * (World.releaseMouse) instead of being left at its last position: when the
 * pointer leaves the surface or the window, and when a touch ends (touch
 * has no hover — the last tap point would otherwise keep repelling cables).
 */
export class PointerTracker {
  /** Last pointer position over the surface, in world coordinates. */
  public x: number = 200;
  public y: number = 200;
  /** Whether the pointer is currently hovering the drawing surface. */
  public inside: boolean = false;

  private readonly world: World;
  private readonly container: HTMLElement;
  private readonly surface: () => Element;

  /** `surface` returns the element whose on-screen box counts as "over the drawing". */
  constructor(world: World, container: HTMLElement, surface: () => Element) {
    this.world = world;
    this.container = container;
    this.surface = surface;
  }

  public attach(): void {
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onEnd);
    document.addEventListener('pointercancel', this.onEnd);
    document.addEventListener('pointerout', this.onOut);
  }

  public detach(): void {
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onEnd);
    document.removeEventListener('pointercancel', this.onEnd);
    document.removeEventListener('pointerout', this.onOut);
    this.release();
  }

  private onMove = (e: PointerEvent): void => {
    const rect = this.surface().getBoundingClientRect();
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!inside) {
      // Only on the way out: a drag in progress (Plug.updateDragPosition)
      // sets the mouse itself, and must not be overridden on every move.
      if (this.inside) this.release();
      return;
    }

    const p = clientToWorld(
      e.clientX,
      e.clientY,
      this.container,
      this.world.getCoordinateTransform()
    );
    this.inside = true;
    this.x = p.x;
    this.y = p.y;
    this.world.setMouse(p.x, p.y);
  };

  private onEnd = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') this.release();
  };

  /** `relatedTarget` is null when the pointer leaves the window altogether. */
  private onOut = (e: PointerEvent): void => {
    if (e.relatedTarget === null) this.release();
  };

  private release(): void {
    this.inside = false;
    this.world.releaseMouse();
  }
}
