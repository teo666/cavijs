import { Cavi } from '../core/cavi';
import { Jack } from './jack';
import type { Plug } from './plug';
import type { CaviWireElement } from './wirewc';
import './wirewc';

/**
 * One cable of a CablesSnapshot: what it is plugged into and the
 * attributes of its <cavi-wire> — never its physics state, which the
 * simulation finds again on its own.
 */
export interface CableState {
  /** The <cavi-wire>'s id: how applyCables recognizes a cable it already has. */
  id: string;
  /** Ids of the jacks its first and last node are plugged into; null for a free end. */
  ends: [string | null, string | null];
  /** The <cavi-wire> attributes of the same names, left out when not set. */
  type?: string;
  color?: string;
  length?: number;
  tension?: number;
  size?: number;
  /** Bend stiffness, 0..1 (see Wire.setBendStiffness). */
  bend?: number;
  renderType?: 'bezier' | 'segments';
}

/**
 * The cables of one world, as captureCables reads them and applyCables puts
 * them back — plain data, safe to JSON.stringify. Jacks are not part of it:
 * they belong to the page, which restores them (with the same ids) first.
 */
export interface CablesSnapshot {
  version: 1;
  wires: CableState[];
}

/** <cavi-wire>'s own default for a missing `length` (see CaviWireElement._setup). */
const DEFAULT_LENGTH = 10;

/** The <cavi-wire> elements of `cavi`'s world, in document order. */
function wiresOf(cavi: Cavi): CaviWireElement[] {
  const container = cavi.getContainer();
  if (!container) return [];
  const all = Array.from(container.querySelectorAll('cavi-wire')) as CaviWireElement[];
  return all.filter((el) => Cavi.for(el) === cavi);
}

/** How many nodes `el`'s cable has — or will have, once set up. */
function nodeCountOf(el: CaviWireElement): number {
  return (
    el.getWire()?.getNodeCount() ?? parseInt(el.getAttribute('length') ?? String(DEFAULT_LENGTH))
  );
}

/** The plugs on `el`'s first and last node, the same ones CaviWireElement binds. */
function terminalsOf(el: CaviWireElement): [Plug | null, Plug | null] {
  const last = nodeCountOf(el) - 1;
  let first: Plug | null = null;
  let end: Plug | null = null;
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'CAVI-PLUG') continue;
    const node = parseInt(child.getAttribute('node') ?? '0');
    if (node === 0) first ??= child as Plug;
    else if (node === last) end ??= child as Plug;
  }
  return [first, end];
}

/** The id of the jack `plug` is plugged into, null if none (or one without an id, or gone). */
function jackIdOf(plug: Plug | null): string | null {
  const jack = plug?.jack;
  // A jack just removed lets its plugs go a microtask later: already free.
  return jack && jack.isConnected && jack.id ? jack.id : null;
}

function readAttributes(el: CaviWireElement): Omit<CableState, 'id' | 'ends'> {
  const state: Omit<CableState, 'id' | 'ends'> = {};
  const type = el.getAttribute('type');
  if (type !== null) state.type = type;
  const color = el.getAttribute('color');
  if (color !== null) state.color = color;
  for (const name of ['length', 'tension', 'size', 'bend'] as const) {
    const value = el.getAttribute(name);
    if (value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n)) state[name] = n;
  }
  const renderType = el.getAttribute('render-type') ?? el.getAttribute('renderType');
  if (renderType !== null) state.renderType = renderType === 'segments' ? 'segments' : 'bezier';
  return state;
}

function setAttribute(el: Element, name: string, value: string | number | undefined): void {
  if (value === undefined) el.removeAttribute(name);
  else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
}

/** Makes `el`'s attributes say what `state` says — live on a cable already set up. */
function writeAttributes(el: CaviWireElement, state: CableState): void {
  setAttribute(el, 'type', state.type);
  setAttribute(el, 'color', state.color);
  const length = Number.isInteger(state.length) && state.length! >= 2 ? state.length : undefined;
  setAttribute(el, 'length', length);
  for (const name of ['tension', 'size'] as const) {
    const value = state[name];
    setAttribute(el, name, Number.isFinite(value) && value! > 0 ? value : undefined);
  }
  setAttribute(el, 'bend', Number.isFinite(state.bend) ? state.bend : undefined);
  // The legacy spelling would win over the default if left behind.
  el.removeAttribute('renderType');
  setAttribute(el, 'render-type', state.renderType);
}

/**
 * Reads the cables of `cavi`'s world: for each <cavi-wire> in its
 * container, the jacks its two ends are plugged into and its attributes.
 * Cables plugged into nothing are left out — they are falling away and get
 * deleted once out of view (Cavi.getOrphanCleanup) — and so are ends in a
 * jack without an id, which could not be found again.
 */
export function captureCables(cavi: Cavi): CablesSnapshot {
  const wires: CableState[] = [];
  for (const el of wiresOf(cavi)) {
    if (!el.getWire()) continue;
    const [first, last] = terminalsOf(el);
    const ends: [string | null, string | null] = [jackIdOf(first), jackIdOf(last)];
    if (ends[0] === null && ends[1] === null) continue;
    wires.push({ id: el.id, ends, ...readAttributes(el) });
  }
  return { version: 1, wires };
}

/**
 * Makes the cables of `cavi`'s world match `snapshot` (see captureCables),
 * touching only what differs, cable by cable, by id:
 * - a cable the world has and the snapshot doesn't is deleted;
 * - one both have keeps its live physics state: its attributes are
 *   updated, and only ends that changed jack are moved;
 * - one the world doesn't have is created, straight between its jacks,
 *   and left to settle under physics.
 *
 * Jacks must already be on the page, with the ids they had: an end whose
 * jack isn't there is left free, and a cable with neither jack there is
 * not restored at all. A jack at `max-plugs` is only freed for its new
 * cable once every end that leaves it has left. Meant to run between
 * gestures: a plug being dragged stays where it is.
 */
export function applyCables(cavi: Cavi, snapshot: CablesSnapshot): void {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.wires)) {
    throw new Error('cavijs: applyCables expects a CablesSnapshot of version 1');
  }
  const container = cavi.getContainer();
  if (!container) throw new Error('cavijs: applyCables needs a Cavi with a renderer container');

  const jacks = new Map<string, Jack>();
  for (const jack of Jack.registry) {
    if (jack.id && !jacks.has(jack.id) && Cavi.for(jack) === cavi) jacks.set(jack.id, jack);
  }
  const jackOf = (id: string | null): Jack | null => (id === null ? null : (jacks.get(id) ?? null));

  const existing = new Map<string, CaviWireElement>();
  for (const el of wiresOf(cavi)) {
    if (!existing.has(el.id)) existing.set(el.id, el);
  }

  interface Plan {
    state: CableState;
    jacks: [Jack | null, Jack | null];
    el: CaviWireElement | null;
  }
  const plans: Plan[] = [];
  const ids = new Set<string>();
  for (const state of snapshot.wires) {
    if (ids.has(state.id)) continue;
    ids.add(state.id);
    const ends: [Jack | null, Jack | null] = [jackOf(state.ends[0]), jackOf(state.ends[1])];
    if (!ends[0] && !ends[1]) continue;
    plans.push({ state, jacks: ends, el: existing.get(state.id) ?? null });
  }

  // 1. Cables the snapshot doesn't have — deleted right away, so their
  // jacks are free for what follows (see CaviWireElement.delete).
  const kept = new Set(plans.map((plan) => plan.el));
  for (const el of wiresOf(cavi)) {
    if (!kept.has(el)) el.delete();
  }

  // 2. Cables both have: every end that must move is pulled out before
  // anything is plugged in anywhere, so two cables swapping jacks at
  // `max-plugs` never find each other's jack still taken.
  const moves = new Map<Plug, Jack>();
  for (const plan of plans) {
    const el = plan.el;
    if (!el) continue;
    writeAttributes(el, plan.state);
    const plugs = terminalsOf(el);
    // Markup without a plug for an end to plug in (an author's <cavi-wire>
    // with a single plug): plugs are only bound at setup, so rebuild it.
    if ((!plugs[0] && plan.jacks[0]) || (!plugs[1] && plan.jacks[1])) {
      el.delete();
      plan.el = null;
      continue;
    }
    for (const i of [0, 1] as const) {
      const plug = plugs[i];
      const jack = plan.jacks[i];
      if (!plug || plug.jack === jack) continue;
      if (plug.jack) plug.disconnect();
      if (jack) moves.set(plug, jack);
    }
  }

  // 3. Plug in, in snapshot order: moved ends, and cables created anew.
  for (const plan of plans) {
    if (!plan.el) {
      createCable(container, plan.state, plan.jacks);
      continue;
    }
    for (const plug of terminalsOf(plan.el)) {
      const jack = plug && moves.get(plug);
      if (plug && jack && !plug.connect(jack)) {
        console.warn(
          `cavijs: applyCables could not plug cable #${plan.state.id} into jack #${jack.id} ` +
            `(full, of another type, or mid-drag); left free.`
        );
      }
    }
  }
}

/** A new <cavi-wire> for `state`, its plugs bound declaratively to the jacks found. */
function createCable(
  container: HTMLElement,
  state: CableState,
  jacks: [Jack | null, Jack | null]
): void {
  const el = document.createElement('cavi-wire') as CaviWireElement;
  el.id = state.id;
  writeAttributes(el, state);
  const last = nodeCountOf(el) - 1;
  for (const [i, node] of [0, last].entries()) {
    const plug = document.createElement('cavi-plug');
    plug.setAttribute('node', String(node));
    const jack = jacks[i];
    if (jack) plug.setAttribute('jack', jack.id);
    el.appendChild(plug);
  }
  // In the container itself, like a cable pulled out of a jack (see
  // Jack.createCable): plugs are positioned against it.
  container.appendChild(el);
  // A new cable's terminals start out fixed: an end left out of every jack
  // (none given, or the one given full) would stay hanging in mid-air.
  for (const plug of terminalsOf(el)) {
    if (plug && !plug.jack) plug.disconnect();
  }
}
