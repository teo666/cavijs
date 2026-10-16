import { expect, test, type Page } from '@playwright/test';
import { center, collectErrors, moveTo } from './helpers';

/**
 * demo-two-worlds.html: two worlds with the same jack ids, the second inside
 * a shadow root (Playwright's CSS selectors pierce open shadow roots).
 */

/** Per world: cable count, and the world each plugged plug's jack belongs to. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const host = document.getElementById('shadow-host')!.shadowRoot!;
    const worlds = { a: document.getElementById('world-a')!, b: host.getElementById('world-b')! };
    return Object.fromEntries(
      Object.entries(worlds).map(([name, world]) => {
        const wires = world.querySelectorAll('cavi-wire');
        const jackWorlds = [...world.querySelectorAll('cavi-plug')]
          .map((p) => (p as unknown as { jack: Element | null }).jack)
          .filter((j): j is Element => j !== null)
          .map((j) => j.closest('cavi-world')!.id);
        return [name, { cables: wires.length, jackWorlds }];
      })
    ) as Record<'a' | 'b', { cables: number; jackWorlds: string[] }>;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('demo-two-worlds.html');
  await page.waitForFunction(() => {
    const b = document.getElementById('shadow-host')?.shadowRoot?.getElementById('world-b');
    const ready = (el: Element | null | undefined) =>
      !!(el as unknown as { getCavi?(): unknown } | null)?.getCavi?.();
    return ready(document.getElementById('world-a')) && ready(b);
  });
});

test("each world's cable is plugged into its own world's jacks", async ({ page }) => {
  const s = await snapshot(page);
  expect(s.a).toEqual({ cables: 1, jackWorlds: ['world-a', 'world-a'] });
  expect(s.b).toEqual({ cables: 1, jackWorlds: ['world-b', 'world-b'] });
});

for (const [world, other] of [
  ['b', 'a'],
  ['a', 'b'],
] as const) {
  test(`a cable created with the mouse in world ${world.toUpperCase()} stays there`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const from = await center(page, `#world-${world} #aux`);
    const to = await center(page, `#world-${world} #in`);

    await page.mouse.click(from.x, from.y);
    await moveTo(page, to);
    await page.mouse.click(to.x, to.y);

    const s = await snapshot(page);
    expect(s[world].cables).toBe(2);
    expect(s[world].jackWorlds).toEqual(Array(4).fill(`world-${world}`));
    expect(s[other]).toEqual({ cables: 1, jackWorlds: [`world-${other}`, `world-${other}`] });
    expect(errors).toEqual([]);
  });
}
