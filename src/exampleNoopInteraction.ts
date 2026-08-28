// Demo: the smallest possible IInteractionController — does nothing at
// all. <cavi-world> auto-creates a StandardInteractionController by
// default (see demo-jack-plug.html/demo-patchbay.html); this shows that
// swapping it out is just assigning a different object to
// <cavi-interaction>.controller before it connects. With this one
// attached, Jack/Plug receive no listeners whatsoever — clicking/dragging
// them does nothing, proving the interaction layer is fully independent of
// (and optional for) the domain elements.
import './worldwc'; // registers cavi-world, and transitively cavi-jack/cavi-wire/cavi-plug/cavi-interaction
import type { Cavi } from './cavi';
import type { IInteractionController } from './types';

class NoopInteractionController implements IInteractionController {
  attach(_cavi: Cavi): void {}
  detach(): void {}
}

// Must run synchronously, right here — not inside a 'caviready' listener:
// <cavi-interaction> registers its own 'caviready' listener as soon as it
// upgrades (which happens the instant the './worldwc' import above defines
// the custom element), and that listener reads `this.controller` only once
// 'caviready' actually fires. Since WASM init takes real (async) time, a
// plain synchronous assignment here always lands well before that — no
// need to race the event at all.
const el = document.getElementById('interaction') as HTMLElement & { controller: IInteractionController };
el.controller = new NoopInteractionController();
