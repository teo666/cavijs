import { expect, test, type Page } from '@playwright/test';
import { center, collectErrors, lastCableJacks, moveTo, openWorld, wireCount } from './helpers';

/**
 * Undo/redo and save/load on demo-d3-interaction.html, which drives a
 * CaviHistory (bindHistory) with the units' positions as the page's state.
 */

let errors: string[];

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await openWorld(page, 'demo-d3-interaction.html');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Presses at `from`, drags to `to` and lets go, with the real mouse. */
async function dragFromTo(page: Page, from: string, to: { x: number; y: number }): Promise<void> {
  const start = await center(page, from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await moveTo(page, to);
  await page.mouse.up();
}

const unitTransform = (page: Page, id: string) =>
  page.locator(`#${id}`).evaluate((el) => (el as HTMLElement).style.transform);

test('undoes and redoes a cable pulled out of a jack', async ({ page }) => {
  await dragFromTo(page, '#j-d', await center(page, '#j-f'));
  expect(await wireCount(page)).toBe(4);
  expect(await lastCableJacks(page)).toEqual(['j-d', 'j-f']);
  await expect(page.locator('#undo')).toBeEnabled();

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => wireCount(page)).toBe(3);
  await expect(page.locator('#undo')).toBeDisabled();

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => wireCount(page)).toBe(4);
  expect(await lastCableJacks(page)).toEqual(['j-d', 'j-f']);
});

test('undoes moving a unit, the page state, with its cables following', async ({ page }) => {
  const handle = await center(page, '#unit-b .jack-unit-handle');
  await dragFromTo(page, '#unit-b .jack-unit-handle', { x: handle.x + 100, y: handle.y + 40 });
  expect(await unitTransform(page, 'unit-b')).not.toBe('');

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(() => unitTransform(page, 'unit-b')).toBe('translate(0px, 0px)');
  expect(await wireCount(page)).toBe(3);
});

test('loads a saved state back, as a step that can be undone', async ({ page }) => {
  await dragFromTo(page, '#j-d', await center(page, '#j-f'));
  await page.locator('#save').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => wireCount(page)).toBe(3);

  await page.locator('#load').click();
  await expect.poll(() => wireCount(page)).toBe(4);
  expect(await lastCableJacks(page)).toEqual(['j-d', 'j-f']);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => wireCount(page)).toBe(3);
});
