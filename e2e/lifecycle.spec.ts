import { expect, test } from '@playwright/test';
import { center, collectErrors, lastCableJacks, moveTo, openWorld, wireCount } from './helpers';

/** Sleeping of still cables, and a world removed from the page and inserted back. */

type PageWorld = {
  getSleepingWireCount(): number;
  getWireCount(): number;
  setSleepEnabled(on: boolean): void;
  getWires(): {
    getNodeCount(): number;
    getNodeX(i: number): number;
    getNodeY(i: number): number;
  }[];
};

test.describe('sleeping', () => {
  test('settled cables fall asleep in the shape they would keep anyway', async ({ page }) => {
    await openWorld(page, 'demo-d3-interaction.html');
    await page.mouse.move(5, 5);

    await page.waitForFunction(
      () => {
        const w = (
          document.querySelector('cavi-world') as unknown as {
            getCavi(): { getWorld(): PageWorld };
          }
        )
          .getCavi()
          .getWorld();
        return w.getSleepingWireCount() === w.getWireCount();
      },
      undefined,
      { timeout: 15_000 }
    );

    // Where every node sits once asleep, then after 2 more seconds of
    // simulation with sleeping off: a cable put to sleep too early would
    // still move.
    const positions = () =>
      page.evaluate(() => {
        const w = (
          document.querySelector('cavi-world') as unknown as {
            getCavi(): { getWorld(): PageWorld };
          }
        )
          .getCavi()
          .getWorld();
        return w
          .getWires()
          .flatMap((wire) =>
            Array.from({ length: wire.getNodeCount() }, (_, i) => [
              wire.getNodeX(i),
              wire.getNodeY(i),
            ])
          );
      });
    const asleep = await positions();
    await page.evaluate(() =>
      (document.querySelector('cavi-world') as unknown as { getCavi(): { getWorld(): PageWorld } })
        .getCavi()
        .getWorld()
        .setSleepEnabled(false)
    );
    await page.waitForTimeout(2000);
    const later = await positions();

    const drift = Math.max(
      ...asleep.map(([x, y], i) => Math.hypot(later[i][0] - x, later[i][1] - y))
    );
    test
      .info()
      .annotations.push({ type: 'measured', description: `max drift ${drift.toFixed(3)}` });
    expect(drift).toBeLessThan(1);
  });

  test('a sleeping cable wakes up under the mouse', async ({ page }) => {
    await openWorld(page, 'demo-d3-interaction.html');
    await page.mouse.move(5, 5);
    const sleeping = () =>
      page.evaluate(() =>
        (
          document.querySelector('cavi-world') as unknown as {
            getCavi(): { getWorld(): PageWorld };
          }
        )
          .getCavi()
          .getWorld()
          .getSleepingWireCount()
      );
    await expect.poll(sleeping, { timeout: 15_000 }).toBe(await wireCount(page));

    // Sweep the mouse across the middle of the first cable.
    const ends = await page.evaluate(() => {
      const plugs = document.querySelector('cavi-wire')!.querySelectorAll('cavi-plug');
      return [...plugs].map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
    });
    const mid = { x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 };
    await page.mouse.move(mid.x - 80, mid.y + 40);
    await moveTo(page, { x: mid.x + 80, y: mid.y + 40 }, 20);

    await expect.poll(sleeping).toBeLessThan(await wireCount(page));
  });
});

test.describe('world removed and inserted back', () => {
  test('comes back with every cable, including one created with the mouse', async ({ page }) => {
    const errors = collectErrors(page);
    await openWorld(page, 'demo-d3-interaction.html');

    // A new cable j-f -> j-a, pulled with the mouse (d3 controller: press and drag).
    await page.mouse.move(...(Object.values(await center(page, '#j-f')) as [number, number]));
    await page.mouse.down();
    await moveTo(page, await center(page, '#j-a'), 25);
    await page.mouse.up();
    await page.mouse.move(5, 5);
    const cables = await wireCount(page);
    expect(await lastCableJacks(page)).toEqual(['j-a', 'j-f']);

    const result = await page.evaluate(async () => {
      type WorldEl = HTMLElement & {
        getCavi(): { isDestroyed(): boolean; getWorld(): PageWorld } | null;
      };
      const worldEl = document.querySelector('cavi-world') as WorldEl;
      const parent = worldEl.parentElement!;
      const before = worldEl.getCavi()!;
      worldEl.remove();
      await new Promise((r) => setTimeout(r, 50));
      const destroyed = before.isDestroyed();
      parent.appendChild(worldEl);
      await new Promise((r) => setTimeout(r, 300));
      const after = worldEl.getCavi()!;
      return {
        destroyed,
        rebuilt: after !== before && !after.isDestroyed(),
        engineWires: after.getWorld().getWireCount(),
        plugsPerCable: [...document.querySelectorAll('cavi-wire')].map(
          (w) => w.querySelectorAll('cavi-plug').length
        ),
      };
    });

    expect(result.destroyed).toBe(true);
    expect(result.rebuilt).toBe(true);
    expect(result.engineWires).toBe(cables);
    expect(result.plugsPerCable.every((n) => n === 2)).toBe(true);
    expect(await lastCableJacks(page)).toEqual(['j-a', 'j-f']);
    expect(errors).toEqual([]);
  });
});
