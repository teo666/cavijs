import type { Cavi } from './cavi';
import type { Wire } from './wire';
import type { Jack } from '../component/jack';
import type { Plug } from '../component/plug';
import type { CaviWireElement } from '../component/wirewc';

/** How a cable-creation gesture (see Jack.createCable) ended. */
export type CableEndResult = 'connected' | 'dangle' | 'detach' | 'cancel' | 'abort';

/**
 * Domain events emitted by cavijs, by name. Every one is a bubbling
 * CustomEvent dispatched on the renderer container of the Cavi it belongs
 * to (the <cavi-world> element, for a declarative setup) — so a page can
 * listen on its world element, or on document for every world at once.
 *
 * The layout/lifecycle events (`caviready`, `cavierror`, `cavi-resize`,
 * `cavi-transform-change`) predate this map and are dispatched by
 * worldwc.ts/resize.ts/Cavi directly — see CAVI_EVENT_NAMES for the full list.
 */
export interface CaviEventDetailMap {
  /** A <cavi-wire> created its WASM wire. */
  'cavi-wire-add': { wire: Wire; element: CaviWireElement };
  /**
   * A <cavi-wire> deleted its WASM wire. `index` is the one it had
   * (wire.getIndex() is -1 by now); `reason` is 'cleanup' for an orphaned
   * cable deleted once out of view (Cavi.getOrphanCleanup), 'removed' when
   * the element left the DOM.
   */
  'cavi-wire-remove': {
    wire: Wire;
    element: CaviWireElement;
    index: number;
    reason: 'cleanup' | 'removed';
  };
  'cavi-plug-attach': { plug: Plug; jack: Jack };
  'cavi-plug-detach': { plug: Plug; jack: Jack };
  /** A new cable started being pulled out of `jack`. */
  'cavi-cable-start': { jack: Jack; wire: Wire };
  /** A cable-creation gesture finished — see CableEndResult and Cavi.getCableDropBehavior. */
  'cavi-cable-end': { jack: Jack; wire: Wire; result: CableEndResult; target: Jack | null };
  /**
   * A user gesture that may have changed which cables are plugged where is
   * over, its cables in their final state: a plug was dropped (plugged in
   * or not — `plug-drop`), or a cable-creation gesture ended, whatever its
   * result (`cable-end`, right after `cavi-cable-end`). The moment to
   * record an undo step (see CaviHistory). Not emitted for changes made
   * from code (Plug.connect/disconnect, applyCables, markup).
   */
  'cavi-change': { cause: 'plug-drop' | 'cable-end' };
}

export type CaviEventName = keyof CaviEventDetailMap;

/** Every event name cavijs dispatches, in rough lifecycle order. */
export const CAVI_EVENT_NAMES: readonly string[] = [
  'caviready',
  'cavierror',
  'cavi-resize',
  'cavi-transform-change',
  'cavi-wire-add',
  'cavi-wire-remove',
  'cavi-plug-attach',
  'cavi-plug-detach',
  'cavi-cable-start',
  'cavi-cable-end',
  'cavi-change',
];

/**
 * Dispatches a domain event on `cavi`'s renderer container, or on
 * `fallback` when there is no container (no Cavi yet, or a renderer-less
 * setup such as a unit test).
 */
export function emitCaviEvent<K extends CaviEventName>(
  cavi: Cavi | null,
  fallback: Element,
  name: K,
  detail: CaviEventDetailMap[K]
): void {
  const target = cavi?.getContainer?.() ?? fallback;
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
