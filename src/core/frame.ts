/** An axis-aligned rectangle in world coordinates. */
export interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Shared, per-frame measurements handed to every FrameTask of a world. */
export interface FrameContext {
  /**
   * What is on screen right now, in world coordinates: the renderer's
   * container box and — when different — its drawing surface. Measured
   * from layout once per frame, on first access (so only if some task
   * needs it); empty when the world has no renderer.
   */
  readonly viewBounds: readonly WorldRect[];
}

/**
 * Per-frame work a DOM element does for its world, registered with
 * World.addFrameTask and run by the renderer right after the physics
 * advanced (World.runFrameTasks). Every task's `read` runs before any
 * task's `write`, so however many elements a world has, measuring the page
 * (getBoundingClientRect, ...) costs one layout per frame instead of one per
 * element: keep layout reads in `read`, DOM writes in `write`.
 */
export interface FrameTask {
  read?(ctx: FrameContext): void;
  write?(ctx: FrameContext): void;
}

/** Whether (x, y) lies inside `rect` grown by `margin` on every side. */
export function rectContains(rect: WorldRect, x: number, y: number, margin = 0): boolean {
  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  );
}
