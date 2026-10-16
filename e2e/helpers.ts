import { expect, type Page } from '@playwright/test';

/** Every console error and uncaught exception of `page`, collected from now on. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Reported with its URL by the 'response' handler below.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** Opens a demo page and waits until its <cavi-world> has a running Cavi. */
export async function openWorld(page: Page, demo: string, selector = 'cavi-world'): Promise<void> {
  await page.goto(demo);
  await page.waitForFunction(
    (sel) => !!(document.querySelector(sel) as unknown as { getCavi?(): unknown })?.getCavi?.(),
    selector
  );
  // <cavi-debug> lives in the top layer and would catch the mouse over
  // whatever it covers.
  await page.evaluate(() => {
    (document.querySelector('cavi-debug') as unknown as { hide?(): void } | null)?.hide?.();
  });
}

/** Waits for `n` animation frames inside the page. */
export async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);
}

/** Center of an element, in page (viewport) coordinates. */
export async function center(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} is on screen`).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** Moves the real mouse from wherever it is to `to`, in `steps` events. */
export async function moveTo(page: Page, to: { x: number; y: number }, steps = 15): Promise<void> {
  await page.mouse.move(to.x, to.y, { steps });
}

/** Wire count of the page's (first) world. */
export function wireCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('cavi-wire').length);
}

/** The jack ids the plugs of the last <cavi-wire> are plugged into, sorted (null: free). */
export function lastCableJacks(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const wires = document.querySelectorAll('cavi-wire');
    const last = wires[wires.length - 1]!;
    return [...last.querySelectorAll('cavi-plug')]
      .map((p) => (p as unknown as { jack: { id: string } | null }).jack?.id ?? null)
      .sort();
  });
}
