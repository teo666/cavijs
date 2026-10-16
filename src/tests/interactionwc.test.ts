import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaviInteractionElement } from '../component/interactionwc';
import { StandardInteractionController } from '../interaction/interaction';
import { KeyboardInteractionController } from '../interaction/keyboard';
import { Cavi } from '../core/cavi';
import type { IInteractionController } from '../core/types';

/** <cavi-interaction> attaches a list of controllers to its world. */

afterEach(() => {
  document.body.innerHTML = '';
  Cavi.shared = null;
});

function fakeController() {
  return {
    attach: vi.fn<(cavi: Cavi) => void>(),
    detach: vi.fn<() => void>(),
  } satisfies IInteractionController;
}

function make(attrs: Record<string, string> = {}): CaviInteractionElement {
  const el = document.createElement('cavi-interaction') as CaviInteractionElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe('<cavi-interaction> controllers', () => {
  it('defaults to the pointer and the keyboard controller', () => {
    const [pointer, keyboard, ...rest] = make().controllers;
    expect(pointer).toBeInstanceOf(StandardInteractionController);
    expect(keyboard).toBeInstanceOf(KeyboardInteractionController);
    expect(rest).toEqual([]);
  });

  it('leaves the keyboard out with no-keyboard', () => {
    const list = make({ 'no-keyboard': '' }).controllers;
    expect(list).toHaveLength(1);
    expect(list[0]).toBeInstanceOf(StandardInteractionController);
  });

  it('.controller = c is short for .controllers = [c]', () => {
    const el = make();
    const c = fakeController();
    el.controller = c;
    expect(el.controllers).toEqual([c]);
    expect(el.controller).toBe(c);
  });

  it('attaches every controller to the world, and detaches every one when removed', () => {
    const cavi = { getContainer: () => document.body } as unknown as Cavi;
    Cavi.shared = cavi;
    const a = fakeController();
    const b = fakeController();
    const el = make();
    el.controllers = [a, b];
    document.body.appendChild(el);
    expect(a.attach).toHaveBeenCalledWith(cavi);
    expect(b.attach).toHaveBeenCalledWith(cavi);
    expect(CaviInteractionElement.attachedTo(cavi)).toBe(el);

    el.remove();
    expect(a.detach).toHaveBeenCalledTimes(1);
    expect(b.detach).toHaveBeenCalledTimes(1);
    expect(CaviInteractionElement.attachedTo(cavi)).toBeNull();
  });
});
