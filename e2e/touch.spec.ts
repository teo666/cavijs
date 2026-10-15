import { expect, test, type Page } from '@playwright/test';
import { center, collectErrors, lastCableJacks, openWorld, wireCount } from './helpers';

/**
 * Touch: press-and-drag (not click-to-carry), with real touch events sent
 * through the Chrome DevTools Protocol — Chrome turns them into pointer
 * events with pointerType "touch", as on a phone.
 */

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await openWorld(page, 'demo-jack-plug.html');
});

/** Presses at `from`, drags to `to` in `steps` moves, and lifts the finger. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
    });
  await touch('touchStart', from);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  await touch('touchEnd');
}

test('press on a jack, drag to another, lift: a new cable between them', async ({ page }) => {
  const errors = collectErrors(page);
  const before = await wireCount(page);

  await touchDrag(page, await center(page, '#jack4'), await center(page, '#jack2'));

  expect(await wireCount(page)).toBe(before + 1);
  expect(await lastCableJacks(page)).toEqual(['jack2', 'jack4']);
  expect(errors).toEqual([]);
});

test('lifting the finger over empty space ends the gesture there', async ({ page }) => {
  const before = await wireCount(page);
  const start = await center(page, '#jack4');

  await touchDrag(page, start, { x: start.x + 60, y: start.y + 120 });

  // Default drop behavior: the new cable falls away unplugged.
  expect(await wireCount(page)).toBe(before + 1);
  expect(await lastCableJacks(page)).toEqual([null, null]);
});
