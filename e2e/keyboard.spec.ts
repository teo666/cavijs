import { expect, test, type Page } from '@playwright/test';
import { collectErrors, lastCableJacks, openWorld, wireCount } from './helpers';

/**
 * KeyboardInteractionController on demo-jack-plug.html:
 *   jack1 audio (max 1) — wire1 — jack2 audio
 *   jack3 midi, jack4 audio
 *   jack5 scsi — wire2 — jack6 scsi
 *   jack7 scsi (max 1), jack8 midi
 */

test.beforeEach(async ({ page }) => {
  await openWorld(page, 'demo-jack-plug.html');
});

/** The focused element: a jack's id, or a plug as "<wire id>:<node>". */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement!;
    if (el.localName === 'cavi-plug')
      return `${el.closest('cavi-wire')!.id}:${el.getAttribute('node')}`;
    return el.id || el.localName;
  });
}

/** Presses `key` `n` times, returning where the focus is after each press. */
async function walk(page: Page, key: string, n: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(key);
    seen.push(await focused(page));
  }
  return seen;
}

/** The jacks a wire's plugs are plugged into, sorted (null: free). */
function cableJacks(page: Page, wireId: string): Promise<(string | null)[]> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`#${id} cavi-plug`)]
        .map((p) => (p as unknown as { jack: { id: string } | null }).jack?.id ?? null)
        .sort(),
    wireId
  );
}

const plug = (page: Page, wireId: string, i: number) => page.locator(`#${wireId} cavi-plug`).nth(i);

test('jacks are focusable buttons with a label, plugs too', async ({ page }) => {
  const jack = page.locator('#jack4');
  await expect(jack).toHaveAttribute('tabindex', '0');
  await expect(jack).toHaveAttribute('role', 'button');
  await expect(jack).toHaveAttribute('aria-label', 'audio jack jack4');
  await expect(plug(page, 'wire1', 1)).toHaveAttribute('tabindex', '-1');
  await expect(plug(page, 'wire1', 1)).toHaveAttribute('aria-label', 'audio plug in jack2');
});

test.describe('Tab order', () => {
  const order = [
    'wire1:0',
    'jack2',
    'wire1:14',
    'jack3',
    'jack4',
    'jack5',
    'wire2:0',
    'jack6',
    'wire2:24',
    'jack7',
    'jack8',
  ];

  test('visits each jack, then the plugs plugged into it', async ({ page }) => {
    await page.locator('#jack1').focus();
    expect(await walk(page, 'Tab', order.length)).toEqual(order);
  });

  test('Shift+Tab goes the same way back', async ({ page }) => {
    await page.locator('#jack8').focus();
    expect(await walk(page, 'Shift+Tab', order.length)).toEqual(
      ['jack1', ...order.slice(0, -1)].reverse()
    );
  });

  test('a focused plug fans its jack out', async ({ page }) => {
    await page.locator('#jack5').focus();
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('wire2:0');
    await expect
      .poll(() =>
        plug(page, 'wire2', 0).evaluate((p) => (p as unknown as { isSpread(): boolean }).isSpread())
      )
      .toBe(true);
  });
});

test.describe('moving a plug', () => {
  test('Space picks it up, Tab carries it to another jack, Space plugs it in', async ({ page }) => {
    const errors = collectErrors(page);
    await plug(page, 'wire1', 1).focus();
    await page.keyboard.press(' ');
    expect(await walk(page, 'Tab', 1)).toEqual(['jack4']);
    await page.keyboard.press(' ');

    expect(await cableJacks(page, 'wire1')).toEqual(['jack1', 'jack4']);
    expect(await focused(page)).toBe('jack4');
    expect(errors).toEqual([]);
  });

  test('Escape puts it back where it was, with the focus on it', async ({ page }) => {
    await plug(page, 'wire1', 1).focus();
    await page.keyboard.press(' ');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');

    expect(await cableJacks(page, 'wire1')).toEqual(['jack1', 'jack2']);
    expect(await focused(page)).toBe('wire1:14');
  });

  test('Tab only stops on jacks that can take it: same type, room left', async ({ page }) => {
    // An audio plug from jack2: jack1 is full, jack3 and jack8 are midi,
    // jack5-7 are scsi.
    await plug(page, 'wire1', 1).focus();
    await page.keyboard.press(' ');
    expect(await walk(page, 'Tab', 3)).toEqual(['jack4', 'jack2', 'jack4']);
    expect(await walk(page, 'Shift+Tab', 2)).toEqual(['jack2', 'jack4']);
    await page.keyboard.press('Escape');
  });

  test("skips the jack holding the cable's other end", async ({ page }) => {
    // A scsi plug from jack6: wire2's other end is in jack5, so only jack7.
    await plug(page, 'wire2', 1).focus();
    await page.keyboard.press(' ');
    expect(await walk(page, 'Tab', 3)).toEqual(['jack7', 'jack6', 'jack7']);
    await page.keyboard.press('Escape');
    expect(await cableJacks(page, 'wire2')).toEqual(['jack5', 'jack6']);
  });
});

test.describe('new cable', () => {
  test('Enter on a jack, Tab to a compatible jack, Enter plugs it in', async ({ page }) => {
    const errors = collectErrors(page);
    const before = await wireCount(page);

    await page.locator('#jack2').focus();
    await page.keyboard.press('Enter');
    expect(await walk(page, 'Tab', 1)).toEqual(['jack4']); // jack3 is midi: skipped
    await page.keyboard.press('Enter');

    expect(await wireCount(page)).toBe(before + 1);
    expect(await lastCableJacks(page)).toEqual(['jack2', 'jack4']);
    expect(errors).toEqual([]);
  });

  test('Tab only stops on jacks that can take it', async ({ page }) => {
    await page.locator('#jack4').focus();
    await page.keyboard.press(' ');
    // jack1 is full; the others are midi or scsi.
    expect(await walk(page, 'Tab', 3)).toEqual(['jack2', 'jack4', 'jack2']);
    await page.keyboard.press('Escape');
  });

  test('a jack that fills up during the gesture is no longer visited', async ({ page }) => {
    // A new scsi cable from jack6: jack5 and jack7 (empty, max 1) can take it.
    await page.locator('#jack6').focus();
    await page.keyboard.press(' ');
    expect(await walk(page, 'Tab', 3)).toEqual(['jack7', 'jack5', 'jack6']);

    // jack5 already holds wire2's other end: with max-plugs="1" it is full.
    await page.locator('#jack5').evaluate((j) => j.setAttribute('max-plugs', '1'));
    expect(await walk(page, 'Tab', 3)).toEqual(['jack7', 'jack6', 'jack7']);
    await page.keyboard.press('Escape');
  });

  test('Space works too, and Escape removes the cable', async ({ page }) => {
    const before = await wireCount(page);
    await page.locator('#jack4').focus();
    await page.keyboard.press(' ');
    expect(await wireCount(page)).toBe(before + 1);

    await page.keyboard.press('Escape');

    expect(await wireCount(page)).toBe(before);
    expect(await focused(page)).toBe('jack4');
  });

  test('a pointer press cancels it', async ({ page }) => {
    const before = await wireCount(page);
    await page.locator('#jack4').focus();
    await page.keyboard.press(' ');
    expect(await wireCount(page)).toBe(before + 1);

    await page.mouse.click(5, 5);

    expect(await wireCount(page)).toBe(before);
  });
});

test('works next to the d3 controller (demo-d3-interaction)', async ({ page }) => {
  await openWorld(page, 'demo-d3-interaction.html');
  const errors = collectErrors(page);
  const before = await wireCount(page);

  await page.locator('#j-f').focus();
  await page.keyboard.press('Enter');
  expect(await walk(page, 'Tab', 1)).toEqual(['j-a']);
  await page.keyboard.press('Enter');

  expect(await wireCount(page)).toBe(before + 1);
  expect(await lastCableJacks(page)).toEqual(['j-a', 'j-f']);
  expect(errors).toEqual([]);
});
