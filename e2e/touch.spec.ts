import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { center, collectErrors, frames, lastCableJacks, openWorld, wireCount } from './helpers';

/**
 * Touch: press-and-drag (not click-to-carry), with real touch events sent
 * through the Chrome DevTools Protocol — Chrome turns them into pointer
 * events with pointerType "touch", as on a phone.
 */

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await openWorld(page, 'demo-jack-plug.html');
});

type TouchType = 'touchStart' | 'touchMove' | 'touchEnd';

/** One CDP session per page: a touch only continues on the session that started it. */
const sessions = new WeakMap<Page, CDPSession>();

/** Sends one touch event (one finger, or none for touchEnd) through CDP. */
async function touch(page: Page, type: TouchType, p?: { x: number; y: number }): Promise<void> {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
  });
}

/** Presses at `from`, drags to `to` in `steps` moves, and lifts the finger. */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12
): Promise<void> {
  await touch(page, 'touchStart', from);
  for (let i = 1; i <= steps; i++) {
    await touch(page, 'touchMove', {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  await touch(page, 'touchEnd');
}

/** Whether the plugs of the jack `id` are fanned out. */
function isSpread(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (jackId) => (document.getElementById(jackId) as unknown as { isSpread(): boolean }).isSpread(),
    id
  );
}

/** The jack ids the plugs of wire `id` are plugged into, sorted (null: free). */
function wireJacks(page: Page, id: string): Promise<(string | null)[]> {
  return page.evaluate(
    (wireId) =>
      [...document.getElementById(wireId)!.querySelectorAll('cavi-plug')]
        .map((p) => (p as unknown as { jack: { id: string } | null }).jack?.id ?? null)
        .sort(),
    id
  );
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

test('long press on a jack fans its plugs out; dragging one moves it to another jack', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const before = await wireCount(page);
  expect(await wireJacks(page, 'wire1')).toEqual(['jack1', 'jack2']);

  // Held still on jack2 (on its docked plug, which covers it) past the long press.
  await touch(page, 'touchStart', await center(page, '#jack2'));
  await expect.poll(() => isSpread(page, 'jack2')).toBe(true);
  await touch(page, 'touchEnd');
  await frames(page, 30);
  expect(await isSpread(page, 'jack2')).toBe(true); // still open with the finger lifted

  // The spread-out plug of wire1 now has a spot of its own.
  const plug = page.locator('#wire1 cavi-plug[node="14"]');
  await touchDrag(
    page,
    await center(page, '#wire1 cavi-plug[node="14"]'),
    await center(page, '#jack4')
  );

  expect(await wireJacks(page, 'wire1')).toEqual(['jack1', 'jack4']);
  expect(await wireCount(page)).toBe(before); // moved, no new cable
  await expect.poll(() => plug.getAttribute('plugged')).toBe('true');
  await expect.poll(() => isSpread(page, 'jack2')).toBe(false);
  expect(errors).toEqual([]);
});

test('a press that moves right away still starts a new cable from a jack with cables', async ({
  page,
}) => {
  const before = await wireCount(page);

  await touchDrag(page, await center(page, '#jack2'), await center(page, '#jack4'));

  expect(await wireCount(page)).toBe(before + 1);
  expect(await lastCableJacks(page)).toEqual(['jack2', 'jack4']);
  expect(await wireJacks(page, 'wire1')).toEqual(['jack1', 'jack2']);
});
