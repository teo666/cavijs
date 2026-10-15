import { expect, test } from '@playwright/test';
import { center, collectErrors, lastCableJacks, moveTo, openWorld, wireCount } from './helpers';

/**
 * Creating, connecting and dropping cables with a real mouse, through both
 * interaction controllers.
 */

test.describe('standard controller (demo-jack-plug: click to pick up, click to drop)', () => {
  test.beforeEach(async ({ page }) => {
    await openWorld(page, 'demo-jack-plug.html');
  });

  test('creates a cable from one jack to another', async ({ page }) => {
    const errors = collectErrors(page);
    const before = await wireCount(page);

    await page.mouse.click(...xy(await center(page, '#jack4')));
    await moveTo(page, await center(page, '#jack2'));
    await page.mouse.click(...xy(await center(page, '#jack2')));

    expect(await wireCount(page)).toBe(before + 1);
    expect(await lastCableJacks(page)).toEqual(['jack2', 'jack4']);
    expect(errors).toEqual([]);
  });

  test('a cable dropped in empty space falls away and is deleted', async ({ page }) => {
    const before = await wireCount(page);
    const removed = page.evaluate(
      () =>
        new Promise<string>((resolve) =>
          document.addEventListener('cavi-wire-remove', (e) =>
            resolve((e as CustomEvent).detail.reason)
          )
        )
    );

    const start = await center(page, '#jack4');
    await page.mouse.click(start.x, start.y);
    await moveTo(page, { x: start.x + 150, y: start.y - 120 });
    await page.mouse.click(start.x + 150, start.y - 120);
    // Park the mouse away from the falling cable.
    await page.mouse.move(5, 5);

    expect(await wireCount(page)).toBe(before + 1);
    expect(await lastCableJacks(page)).toEqual([null, null]);
    expect(await removed).toBe('cleanup');
    await expect.poll(() => wireCount(page)).toBe(before);
  });

  test('moves a plugged cable end to another jack', async ({ page }) => {
    // A cable jack7 -> jack5 (both scsi), then its jack5 end moved to jack6.
    await page.mouse.click(...xy(await center(page, '#jack7')));
    await moveTo(page, await center(page, '#jack5'));
    await page.mouse.click(...xy(await center(page, '#jack5')));
    await page.mouse.move(5, 5);
    expect(await lastCableJacks(page)).toEqual(['jack5', 'jack7']);

    // A plug docked on a jack is reached through the jack's hover-spread:
    // hover the jack, then click the spread-out plug of the new cable.
    const plug = page.locator('cavi-wire').last().locator('cavi-plug').nth(1);
    await moveTo(page, await center(page, '#jack5'));
    await expect
      .poll(() => plug.evaluate((p) => (p as unknown as { isSpread(): boolean }).isSpread()))
      .toBe(true);
    const plugAt = await plug.boundingBox();
    await page.mouse.click(plugAt!.x + plugAt!.width / 2, plugAt!.y + plugAt!.height / 2);
    await moveTo(page, await center(page, '#jack6'));
    await page.mouse.click(...xy(await center(page, '#jack6')));

    expect(await lastCableJacks(page)).toEqual(['jack6', 'jack7']);
  });

  test('a full jack (max-plugs) refuses another cable', async ({ page }) => {
    const plugCount = () =>
      page.evaluate(
        () => (document.querySelector('#jack1') as unknown as { plugCount: number }).plugCount
      );
    expect(await plugCount()).toBe(1); // max-plugs="1", already used

    await page.mouse.click(...xy(await center(page, '#jack4')));
    await moveTo(page, await center(page, '#jack1'));
    await page.mouse.click(...xy(await center(page, '#jack1')));

    expect(await plugCount()).toBe(1);
    // Not connected: with the default 'detach' drop behavior, both ends are let go.
    expect(await lastCableJacks(page)).toEqual([null, null]);
  });
});

test.describe('d3 controller (demo-d3-interaction: press and drag)', () => {
  test.beforeEach(async ({ page }) => {
    await openWorld(page, 'demo-d3-interaction.html');
  });

  test('pulls a new cable from an empty jack onto another jack', async ({ page }) => {
    const errors = collectErrors(page);
    const before = await wireCount(page);

    await page.mouse.move(...xy(await center(page, '#j-f')));
    await page.mouse.down();
    await moveTo(page, await center(page, '#j-a'), 25);
    await page.mouse.up();

    expect(await wireCount(page)).toBe(before + 1);
    expect(await lastCableJacks(page)).toEqual(['j-a', 'j-f']);
    expect(errors).toEqual([]);
  });

  test('dragging a module carries its plugged cables along', async ({ page }) => {
    const jackBefore = await center(page, '#j-c');
    const handle = await center(page, '#unit-b .jack-unit-handle');
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await moveTo(page, { x: handle.x + 120, y: handle.y + 80 });
    await page.mouse.up();
    await page.mouse.move(5, 5);

    // The module (and its jacks) really moved...
    const jackAfter = await center(page, '#j-c');
    expect(Math.round(jackAfter.x - jackBefore.x)).toBe(120);
    expect(Math.round(jackAfter.y - jackBefore.y)).toBe(80);

    // ...and every plug plugged into a Unit B jack sits on that jack again.
    await expect
      .poll(() =>
        page.evaluate(() => {
          let worst = 0;
          for (const plug of document.querySelectorAll('cavi-plug')) {
            const jack = (plug as unknown as { jack: Element | null }).jack;
            if (!jack || !jack.closest('#unit-b')) continue;
            const a = jack.getBoundingClientRect();
            const b = plug.getBoundingClientRect();
            worst = Math.max(
              worst,
              Math.hypot(
                a.x + a.width / 2 - b.x - b.width / 2,
                a.y + a.height / 2 - b.y - b.height / 2
              )
            );
          }
          return Math.round(worst);
        })
      )
      .toBeLessThan(2);
  });
});

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}
