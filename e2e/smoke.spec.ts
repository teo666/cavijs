import { expect, test } from '@playwright/test';
import { collectErrors } from './helpers';

/**
 * Every demo page loads without errors and draws its cables — on a canvas
 * (some pixel painted) or an SVG (some path with data).
 */
const DEMOS = [
  'demo-basic.html',
  'demo-svg.html',
  'demo-jack-plug.html',
  'demo-patchbay.html',
  'demo-patchbay-svg.html',
  'demo-noop-interaction.html',
  'demo-patchbay-zoom.html',
  'demo-patchbay-zoom-svg.html',
  'demo-d3-interaction.html',
  'demo-two-worlds.html',
];

test('the demo index loads without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('index.html');
  await expect(page.locator('a[href*="demo-"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const demo of DEMOS) {
  test(`${demo} loads without errors and draws its cables`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(demo);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const paths = [...document.querySelectorAll('svg path')].filter(
              (p) => (p.getAttribute('d') ?? '').length > 10
            );
            if (paths.length > 0) return true;
            return [...document.querySelectorAll('canvas')].some((canvas) => {
              if (!canvas.width || !canvas.height) return false;
              const ctx = canvas.getContext('2d');
              if (!ctx) return false;
              const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
              return false;
            });
          }),
        { message: 'some cable is drawn', timeout: 10_000 }
      )
      .toBe(true);

    expect(errors).toEqual([]);
  });
}
