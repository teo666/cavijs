import { expect, test, type Page } from '@playwright/test';
import { center, collectErrors, lastCableJacks, moveTo, openWorld, wireCount } from './helpers';

/** Escape, keyboard cable creation and live attributes, on demo-jack-plug.html. */

test.beforeEach(async ({ page }) => {
  await openWorld(page, 'demo-jack-plug.html');
});

/** The `result` of the next cavi-cable-end event. */
function nextCableEnd(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) =>
        document.addEventListener(
          'cavi-cable-end',
          (e) => resolve((e as CustomEvent).detail.result),
          {
            once: true,
          }
        )
      )
  );
}

test.describe('Escape', () => {
  test('removes a cable being created, instead of dropping it as an orphan', async ({ page }) => {
    const before = await wireCount(page);
    const ended = nextCableEnd(page);
    const start = await center(page, '#jack4');
    await page.mouse.click(start.x, start.y);
    await moveTo(page, { x: start.x + 120, y: start.y - 80 });
    expect(await wireCount(page)).toBe(before + 1);

    await page.keyboard.press('Escape');

    expect(await ended).toBe('cancel');
    expect(await wireCount(page)).toBe(before);
  });

  test('puts a relocated plug back into the jack it came from', async ({ page }) => {
    // A cable jack7 -> jack5, then its jack5 end picked up and carried away.
    await page.mouse.click(...xy(await center(page, '#jack7')));
    await moveTo(page, await center(page, '#jack5'));
    await page.mouse.click(...xy(await center(page, '#jack5')));
    await page.mouse.move(5, 5);
    const plug = page.locator('cavi-wire').last().locator('cavi-plug').nth(1);
    await moveTo(page, await center(page, '#jack5'));
    await expect
      .poll(() => plug.evaluate((p) => (p as unknown as { isSpread(): boolean }).isSpread()))
      .toBe(true);
    const at = (await plug.boundingBox())!;
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await moveTo(page, { x: at.x + 200, y: at.y + 150 });
    expect(await lastCableJacks(page)).toEqual(['jack7', null]); // carried: unplugged

    await page.keyboard.press('Escape');

    expect(await lastCableJacks(page)).toEqual(['jack5', 'jack7']);
  });
});

test.describe('keyboard', () => {
  test('jacks are focusable buttons with a label', async ({ page }) => {
    const jack = page.locator('#jack4');
    await expect(jack).toHaveAttribute('tabindex', '0');
    await expect(jack).toHaveAttribute('role', 'button');
    await expect(jack).toHaveAttribute('aria-label', 'audio jack jack4');
  });

  test('Enter on a jack, Tab to another, Enter plugs a new cable in', async ({ page }) => {
    const errors = collectErrors(page);
    const before = await wireCount(page);

    await page.locator('#jack2').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab'); // jack3 (midi: no match)
    await page.keyboard.press('Tab'); // jack4 (audio)
    await expect(page.locator('#jack4')).toBeFocused();
    await page.keyboard.press('Enter');

    expect(await wireCount(page)).toBe(before + 1);
    expect(await lastCableJacks(page)).toEqual(['jack2', 'jack4']);
    expect(errors).toEqual([]);
  });

  test('Space works too, and Escape cancels a keyboard cable', async ({ page }) => {
    const before = await wireCount(page);
    await page.locator('#jack4').focus();
    await page.keyboard.press(' ');
    expect(await wireCount(page)).toBe(before + 1);

    await page.keyboard.press('Escape');

    expect(await wireCount(page)).toBe(before);
  });
});

test.describe('live attributes', () => {
  test('<cavi-wire> applies length, tension, size, color and render-type at runtime', async ({
    page,
  }) => {
    const state = await page.evaluate(async () => {
      const el = document.querySelector('cavi-wire')!;
      const wire = (
        el as unknown as {
          getWire(): {
            getNodeCount(): number;
            getLinkDistance(): number;
            getRadius(): number;
            getColor(): string;
            getRenderType(): number;
          };
        }
      ).getWire();
      el.setAttribute('length', '22');
      el.setAttribute('tension', '12');
      el.setAttribute('size', '8');
      el.setAttribute('color', '#ff0000');
      el.setAttribute('render-type', 'segments');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const plugs = [...el.querySelectorAll('cavi-plug')] as unknown as {
        getAttribute(n: string): string;
        jack: { id: string } | null;
      }[];
      return {
        nodes: wire.getNodeCount(),
        link: wire.getLinkDistance(),
        radius: wire.getRadius(),
        color: wire.getColor(),
        renderType: wire.getRenderType(),
        lastPlugNode: plugs[1].getAttribute('node'),
        stillPlugged: plugs.map((p) => p.jack?.id ?? null),
      };
    });

    expect(state).toEqual({
      nodes: 22,
      link: 12,
      radius: 8,
      color: '#ff0000',
      renderType: 0,
      lastPlugNode: '21',
      stillPlugged: ['jack1', 'jack2'],
    });
  });

  test('<cavi-world> applies its settings at runtime, and restores the default when removed', async ({
    page,
  }) => {
    const read = () =>
      page.evaluate(() => {
        const cavi = (
          document.querySelector('cavi-world') as unknown as {
            getCavi(): {
              getAcceleration(): { x: number; y: number };
              getStepRate(): number;
              getSleepEnabled(): boolean;
            };
          }
        ).getCavi();
        return {
          gravity: cavi.getAcceleration(),
          stepRate: cavi.getStepRate(),
          sleep: cavi.getSleepEnabled(),
        };
      });

    await page.evaluate(() => {
      const world = document.querySelector('cavi-world')!;
      world.setAttribute('gravity-y', '-3');
      world.setAttribute('step-rate', '90');
      world.setAttribute('sleep', 'off');
    });
    expect(await read()).toEqual({ gravity: { x: 0, y: -3 }, stepRate: 90, sleep: false });

    await page.evaluate(() => {
      const world = document.querySelector('cavi-world')!;
      world.removeAttribute('gravity-y');
      world.removeAttribute('step-rate');
      world.removeAttribute('sleep');
    });
    expect(await read()).toEqual({ gravity: { x: 0, y: 5 }, stepRate: 60, sleep: true });
  });
});

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}
