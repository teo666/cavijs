import { afterEach, describe, expect, it } from 'vitest';
import { Jack } from './jack';
import type { Plug } from './plug';

function makeJack(attrs: Record<string, string> = {}): Jack {
  const el = document.createElement('cavi-jack') as Jack;
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Jack.canAccept', () => {
  it('matches when types are equal', () => {
    const jack = makeJack({ type: 'audio' });
    expect(jack.canAccept('audio')).toBe(true);
  });

  it('does not match on different types', () => {
    const jack = makeJack({ type: 'audio' });
    expect(jack.canAccept('midi')).toBe(false);
  });

  it('does not match when the jack has no type configured', () => {
    const jack = makeJack();
    expect(jack.canAccept('audio')).toBe(false);
  });
});

describe('Jack magnet class', () => {
  it('toggles the default magnet class on the host element', () => {
    const jack = makeJack();
    document.body.appendChild(jack);

    jack.setMagnetActive(true);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(true);

    jack.setMagnetActive(false);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
  });

  it('uses a custom class name from the magnet-class attribute', () => {
    const jack = makeJack({ 'magnet-class': 'my-highlight' });
    document.body.appendChild(jack);

    jack.setMagnetActive(true);
    expect(jack.classList.contains('my-highlight')).toBe(true);
    expect(jack.classList.contains('cavi-magnet-target')).toBe(false);
  });
});

describe('Jack.registry', () => {
  it('tracks jacks while connected and forgets them once removed', () => {
    const jack = makeJack();
    expect(Jack.registry.has(jack)).toBe(false);

    document.body.appendChild(jack);
    expect(Jack.registry.has(jack)).toBe(true);

    jack.remove();
    expect(Jack.registry.has(jack)).toBe(false);
  });
});

describe('Jack capacity (max-plugs)', () => {
  it('has unlimited capacity when max-plugs is not set', () => {
    const jack = makeJack();
    for (let i = 0; i < 5; i++) {
      jack.attach({} as unknown as Plug);
    }
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('stops accepting once max-plugs is reached, and frees up on detach', () => {
    const jack = makeJack({ 'max-plugs': '1' });
    const plug = {} as unknown as Plug;

    expect(jack.canAcceptMore()).toBe(true);
    jack.attach(plug);
    expect(jack.plugCount).toBe(1);
    expect(jack.canAcceptMore()).toBe(false);

    jack.detach(plug);
    expect(jack.plugCount).toBe(0);
    expect(jack.canAcceptMore()).toBe(true);
  });

  it('ignores an invalid max-plugs value (falls back to unlimited)', () => {
    const jack = makeJack({ 'max-plugs': 'not-a-number' });
    jack.attach({} as unknown as Plug);
    expect(jack.canAcceptMore()).toBe(true);
  });
});
