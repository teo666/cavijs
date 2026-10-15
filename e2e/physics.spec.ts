import { expect, test, type Page } from '@playwright/test';
import { openWorld } from './helpers';

/**
 * Physics behaviour in a real browser, read through the page's own cavijs
 * objects: fixed-rate stepping on a fast display, the held cable, and the
 * throw of a released cable end. All on demo-d3-interaction.html.
 */

/** Makes requestAnimationFrame tick at `hz` instead of the display's rate. */
async function emulateDisplay(page: Page, hz: number): Promise<void> {
  await page.addInitScript((rate) => {
    let next = 0;
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const handle = ++next;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          cb(performance.now());
        }, 1000 / rate)
      );
      return handle;
    };
    window.cancelAnimationFrame = (handle: number) => {
      clearTimeout(timers.get(handle));
      timers.delete(handle);
    };
  }, hz);
}

/**
 * Over one second of a swinging cable: physics steps, rendered frames, and
 * how many distinct positions of a middle node were drawn vs simulated.
 */
function measureOneSecond(page: Page) {
  return page.evaluate(async () => {
    type AnyWorld = {
      getWires(): {
        getNodeCount(): number;
        getNode(i: number): { fixed: boolean; y: number; getRenderPosition(): { y: number } };
      }[];
      setSleepEnabled(on: boolean): void;
      getWasmWorld(): { step(): void };
      runFrameTasks(): void;
    };
    const world = (
      document.querySelector('cavi-world') as unknown as { getCavi(): { getWorld(): AnyWorld } }
    )
      .getCavi()
      .getWorld();
    world.setSleepEnabled(false);
    const wire = world.getWires()[0];
    const last = wire.getNodeCount() - 1;
    wire.getNode(last).fixed = false; // let it swing
    const middle = wire.getNode(Math.floor(last / 2));

    const wasm = world.getWasmWorld();
    const step = wasm.step.bind(wasm);
    let steps = 0;
    wasm.step = () => {
      steps++;
      step();
    };
    const run = world.runFrameTasks.bind(world);
    const drawn: number[] = [];
    const simulated: number[] = [];
    world.runFrameTasks = () => {
      run();
      drawn.push(middle.getRenderPosition().y);
      simulated.push(middle.y);
    };

    await new Promise((resolve) => setTimeout(resolve, 1000));
    return {
      steps,
      frames: drawn.length,
      distinctDrawn: new Set(drawn).size,
      distinctSimulated: new Set(simulated).size,
    };
  });
}

test.describe('fixed-rate physics', () => {
  test('a 120 Hz display steps 60 times a second and draws a new position every frame', async ({
    page,
  }) => {
    await emulateDisplay(page, 120);
    await openWorld(page, 'demo-d3-interaction.html');

    const m = await measureOneSecond(page);
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(m) });

    expect(m.frames).toBeGreaterThan(90);
    expect(m.steps).toBeGreaterThanOrEqual(54);
    expect(m.steps).toBeLessThanOrEqual(66);
    // Simulated positions only change on steps; drawn ones on (nearly) every frame.
    expect(m.distinctSimulated).toBeLessThanOrEqual(m.steps + 1);
    expect(m.distinctDrawn).toBeGreaterThan(m.frames * 0.9);
  });

  test('a 30 Hz display still steps 60 times a second', async ({ page }) => {
    await emulateDisplay(page, 30);
    await openWorld(page, 'demo-d3-interaction.html');

    const m = await measureOneSecond(page);
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(m) });

    expect(m.frames).toBeLessThan(35);
    expect(m.steps).toBeGreaterThanOrEqual(54);
    expect(m.steps).toBeLessThanOrEqual(66);
  });
});

/**
 * Drags the free end of the first cable with the plug API (one move per
 * animation frame, the mouse following it like Plug.updateDragPosition does
 * for a real drag), and returns what the test asked for.
 */
function dragFirstCableEnd(
  page: Page,
  opts: {
    dx: number;
    dy: number;
    moves: number;
    keepHold: boolean;
    stillFrames: number;
    release: boolean;
  }
) {
  return page.evaluate(async (o) => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    type AnyNode = {
      position: { curr: { x: number; y: number }; old: { x: number; y: number } };
      free(): void;
    };
    const world = (
      document.querySelector('cavi-world') as unknown as {
        getCavi(): {
          getWorld(): {
            releaseHeldWire(): void;
            getWasmWorld(): { get_wire_node(w: number, n: number): AnyNode | undefined };
          };
        };
      }
    )
      .getCavi()
      .getWorld();
    const wireEl = document.querySelector('cavi-wire') as unknown as {
      getWire(): {
        getIndex(): number;
        getNodeCount(): number;
        getNodeX(i: number): number;
        getNodeY(i: number): number;
        getLinkDistance(): number;
      };
      querySelectorAll(s: string): NodeListOf<HTMLElement>;
    };
    const plug = wireEl.querySelectorAll('cavi-plug')[1] as unknown as HTMLElement & {
      beginDrag(): void;
      updateDragPosition(x: number, y: number): void;
      endDrag(): void;
      cancelDrag(): void;
    };
    const wire = wireEl.getWire();
    const last = wire.getNodeCount() - 1;

    const r = plug.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.top + r.height / 2;
    plug.beginDrag();
    if (!o.keepHold) world.releaseHeldWire(); // the behaviour before the held wire existed
    for (let i = 0; i < o.moves; i++) {
      x += o.dx;
      y += o.dy;
      plug.updateDragPosition(x, y);
      await frame();
    }
    // Hold still, measuring the end's link to its neighbour.
    const links: number[] = [];
    for (let i = 0; i < o.stillFrames; i++) {
      plug.updateDragPosition(x, y);
      await frame();
      links.push(
        Math.hypot(
          wire.getNodeX(last) - wire.getNodeX(last - 1),
          wire.getNodeY(last) - wire.getNodeY(last - 1)
        )
      );
    }
    let velocity: { x: number; y: number } | null = null;
    if (o.release) {
      plug.endDrag();
      const node = world.getWasmWorld().get_wire_node(wire.getIndex(), last)!;
      const pos = node.position;
      velocity = { x: pos.curr.x - pos.old.x, y: pos.curr.y - pos.old.y };
      node.free();
    } else {
      plug.cancelDrag();
    }
    return {
      link: links.length ? links.reduce((a, b) => a + b, 0) / links.length : 0,
      rest: wire.getLinkDistance(),
      velocity,
    };
  }, opts);
}

test.describe('dragging a cable end', () => {
  test.beforeEach(async ({ page }) => {
    await openWorld(page, 'demo-d3-interaction.html');
  });

  test('the held cable is no longer stretched by the mouse sitting on its end', async ({
    page,
  }) => {
    const drag = { dx: 4, dy: 2, moves: 40, stillFrames: 20, release: false };
    const held = await dragFirstCableEnd(page, { ...drag, keepHold: true });
    await page.reload();
    await openWorld(page, 'demo-d3-interaction.html');
    const unheld = await dragFirstCableEnd(page, { ...drag, keepHold: false });
    test.info().annotations.push({
      type: 'measured',
      description: JSON.stringify({ held: held.link, unheld: unheld.link, rest: held.rest }),
    });

    expect(held.link).toBeLessThan(unheld.link);
    expect(held.link).toBeLessThan(held.rest * 1.3);
  });

  test('a released end is thrown with its last movement, not the whole drag', async ({ page }) => {
    // 30 moves of 6 px up: 180 px in all, 6 px per frame (a step) at the end.
    const { velocity } = await dragFirstCableEnd(page, {
      dx: 0,
      dy: -6,
      moves: 30,
      stillFrames: 0,
      keepHold: true,
      release: true,
    });
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(velocity) });

    expect(velocity!.y).toBeLessThan(-0.5); // still moving up...
    expect(velocity!.y).toBeGreaterThan(-12); // ...by about one frame's worth per sub-step
  });

  test('an end held still before release just drops', async ({ page }) => {
    const { velocity } = await dragFirstCableEnd(page, {
      dx: 0,
      dy: -6,
      moves: 30,
      stillFrames: 20,
      keepHold: true,
      release: true,
    });
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(velocity) });

    expect(Math.hypot(velocity!.x, velocity!.y)).toBeLessThan(0.3);
  });
});
