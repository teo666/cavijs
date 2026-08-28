# Cavijs — Jack & Plug Components

`Jack` (`<cavi-jack>`) and `Plug` (`<cavi-plug>`) model connection points and cable terminals — e.g. for diagrams where cables ("wires", see `<cavi-wire>`) connect into fixed sockets, with a compatibility rule based on a single string type (e.g. `"audio"`, `"midi"`, `"scsi"`).

> This feature is newer than the core `Cavi`/`World`/`Wire` API and evolving — treat details here as a snapshot of `src/jack.ts` / `src/plug.ts` / `src/wirewc.ts` / `src/interaction.ts` / `src/interactionwc.ts` as currently implemented.

## Concept

- **`Plug`** models the terminal node of a cable (the draggable end of a `<cavi-wire>`). For now a plug always represents one of the cable's **two terminal nodes** (index `0` or `nodeCount - 1`); intermediate nodes are not supported yet.
- **`Jack`** models a fixed socket a plug can connect to, with its own string `type`.
- **`<cavi-wire>`** (the "Cable") owns its own `type`, automatically propagated to all of its child `<cavi-plug>` elements — a plug has no independent type settable via markup.
- A plug→jack connection is allowed if and only if `plug.type === jack.type` (plain equality; a jack with no `type` configured accepts no connection).
- Dragging a `Plug` over a compatible `Jack` snaps it into place ("magnet" effect); while approaching, both the candidate jack and the plug receive a configurable CSS class for visual preview (e.g. blur/glow), continuously during the drag — not only on drop. Dropping elsewhere leaves the underlying wire node unfixed by default, so the cable hangs freely and can be reattached later — unless the plug has the `freeze-on-drop` attribute, in which case it stays fixed exactly where it was dropped, always re-grabbable with a plain click/tap instead of having to chase a moving target.
- Both are Web Components that accept optional user-provided template content (with expected structure/classes).
- Z-order: `Plug` must always render above `Jack`, which renders above the canvas — so the plug is never occluded while dragging.

## Architecture: pure domain + external interaction controller

`Jack` and `Plug` are **pure domain/data elements**: they expose public APIs to read/change their state and position and to drive gestures (cable creation, dragging an existing plug), but they **install no pointer/keyboard listeners of their own** and don't decide *how* a user interacts with them. That responsibility lives in an external, replaceable `IInteractionController` — see [the dedicated section below](#interaction-standardinteractioncontroller-and-cavi-interaction).

This means a `<cavi-jack>`/`<cavi-plug>` placed on a page with no interaction controller attached **don't react at all** to mouse/touch — they remain fully manipulable via code (the APIs described in this document), but only "bite" once something attaches a controller. `<cavi-world>` does this automatically (see below), so this detail is invisible in common usage.

## `Jack` (`src/jack.ts`)

A custom element (`cavi-jack`) with Shadow DOM.

**Observed attributes**
| Attribute | Effect |
|---|---|
| `color` | Fill color of the jack's visual dot |
| `x`, `y` | Absolute position (`style.left`/`style.top`, translated -50%/-50% to center on the coordinate) |
| `type` | Type string (e.g. `"audio"`) — a plug can only snap in if its own `type` is identical |
| `max-plugs` | Maximum number of simultaneously attached plugs (default unlimited) |
| `magnet-class` | Name of the CSS class applied to the host when a compatible plug is in range during a drag (default `cavi-magnet-target`) |
| `full-class` | Name of the CSS class applied to the host when the jack is at `max-plugs` **and** the cursor is nearby **and** (Shift is held **or** a drag that could try to connect to it is in progress) (default `cavi-jack-full`) — see below |
| `at-capacity-class` | Name of the CSS class applied to the host unconditionally for as long as the jack is at `max-plugs` (default `cavi-jack-at-capacity`) — unlike `full-class`, independent of hover or Shift; see below |
| `cable-tension`, `cable-size`, `cable-color` | Optional tension/radius/color values applied to a cable created via `createCable()` from this jack (see below); when omitted, the cable uses `<cavi-wire>`'s own fixed defaults |
| `cable-node-spawn` | `"interpolate"` (default) or `"stack"` — where newly-inserted nodes appear as the cable grows longer during `updateCableSession()` (see below) |

**Manipulation API**
| Method | Description |
|---|---|
| `canAccept(type: string) -> boolean` | Returns true if `type` equals the jack's own `type` (and the jack has one configured) |
| `canAcceptMore() -> boolean` | Returns true if the jack hasn't reached `max-plugs` |
| `attach(plug: Plug)` / `detach(plug: Plug)` | Registers/removes an attached plug (updates `plugCount`) |
| `plugCount` | Number of currently attached plugs |
| `getCenter() -> { x, y }` | Center point in viewport coordinates (`getBoundingClientRect`) |
| `type` (getter) | The jack's current `type` |
| `setMagnetActive(active: boolean)` | Toggles the `magnet-class` class on the host, used for the magnet preview during drag |
| `Jack.registry` (static) | Read-only set of every `<cavi-jack>` currently connected to the document |
| `Jack.findSnapTarget(plug, type, exclude?) -> Jack \| null` (static) | Finds the nearest compatible jack within snap range, optionally excluding one |

**API for driving cable creation** (used by `StandardInteractionController`, but callable from any custom controller)
| Method | Description |
|---|---|
| `createCable(clientX, clientY) -> CableSession \| null` | Creates a `<cavi-wire>` with two `<cavi-plug>`s (one attached to this jack, the other free at the given position) and returns a `CableSession` describing the gesture in progress. Returns `null` if `Cavi` isn't ready yet or this jack has no spare capacity (`canAcceptMore()`) — the domain enforces this invariant itself |
| `growCable(wire, desired) -> Node` | Grows `wire` up to `desired` nodes, inserting only the missing ones (see below) |
| `Jack.updateCableSession(session, clientX, clientY)` (static) | Advances an in-progress session: moves the free terminal, grows it if needed, refreshes the magnet preview |
| `Jack.finishCableSession(session)` (static) | Ends the session, snapping the free terminal to the nearest compatible jack in range if any, otherwise leaving it dangling |
| `Jack.cancelCableSession(session)` (static) | Abandons the session: the free terminal is left dangling (never snapped) |
| `Jack.setShiftHeld(held)` / `Jack.setPointerHoverPosition(x, y)` (static) | Feed the state driving the "full jack" preview (see below) — normally called by the interaction controller in response to `keydown`/`keyup`/`pointermove`, not by application code |
| `Jack.setDragActive(active)` (static) | Signals that a drag that could try to connect to a jack has started/ended (see below) |

A `CableSession` (`{ wireEl, wire, jack, originPlug, followPlug, followNode, magnetJack }`) is a plain data object, not owned by any `Jack` instance — so the gesture's state can live entirely in whoever drives it (typically the interaction controller) rather than inside the domain.

By default renders a small dark circle (`.inner`); if the element has child content, it renders that instead (via `<slot>`), letting consumers customize appearance while keeping the same drop-target semantics.

The host has an explicit `24×24px` size. Hit-testing for an *existing* `Plug` snapping onto a jack is entirely distance-based (`Jack.findSnapTarget()` via `Jack.registry`), not driven by native events on the jack.

## Creating a cable from a Jack — `createCable`/`updateCableSession`/`finishCableSession`

Besides being a drop target, `Jack` exposes an API to start, advance, and end creating a new cable — under the standard behavior (`StandardInteractionController`): right-click, or left-click + <kbd>Shift</kbd>, on a jack with spare capacity immediately creates a brand new `<cavi-wire>` — one `<cavi-plug>` attached to that jack right away, the other following the cursor.

- **`createCable(clientX, clientY)`**: builds a `<cavi-wire type="{jack.type}" length="4">` with two `<cavi-plug>` children (`node="0"` / `node="3"`), inserted as a sibling of the jack (so it shares the same `offsetParent`/coordinate space Plug already relies on). Node `0` is immediately positioned at the jack's center, fixed, and attached (`plugged`); node `3` is placed at the given position. The new `<cavi-wire>`'s tension (`tension`), radius (`size`) and color (`color`) are copied from the origin jack's `cable-tension`/`cable-size`/`cable-color` attributes when present; any omitted one falls back to `<cavi-wire>`'s own fixed default (render type excluded: always bezier by default, unless `renderType="segments"` on the cable — there's no `cable-render-type` equivalent). Returns `null` (no-op) if the jack has no spare capacity or `Cavi` isn't ready yet.
- **Growing during `updateCableSession`**: the free node's position tracks the given position, and the node count grows with the distance from the origin jack — `4 + floor(distance / 30)`, capped at `60`. **The cable only ever grows, never shrinks back** as the position approaches again — like pulling a cable out of the screen, once it's out it stays out until the session ends. A growth step inserts only the missing nodes one at a time with `Wire.addNodeAt()` (see [`Wire` in the API reference](./03-api.md#wire)) — unlike an approach based on `Wire.setNodeCount()`, which would rebuild the whole cable, this leaves every already-existing, physics-settled node's state (position, velocity) untouched. Each newly-inserted node is placed according to `cable-node-spawn`: `"interpolate"` (default) puts it immediately on the straight line between the last settled node and the given position; `"stack"` spawns it on top of the last settled node, leaving the constraint solver to spread it out over following frames. Either way the free `Plug` is rebound to the new last node (and its `node="N"` attribute updated accordingly — see the `<cavi-wire>` section below), since growth shifts the terminal index. Every call to `updateCableSession` also calls `node.setMousePosition(x, y)` on the free node, to keep the "world mouse" physics interaction (repulsion of other wires) fed regardless of any `preventDefault()` the driver of the gesture applies to native `mousemove`.
- **Magnet preview**: identical mechanics to `Plug`'s own drag — same `20`px snap distance, same continuous highlight toggling (`setMagnetActive`) on both the candidate jack and the free plug while in range, via `Jack.findSnapTarget()` (excluding the origin jack itself, so a cable can't snap back onto its own source).
- **`finishCableSession`**: if a compatible jack is in range, the free plug snaps to it exactly like a normal `Plug` drop (`fixed = true`, `attach()`, `plugged`). Otherwise the cable stays attached at the origin with the free end left dangling — `node.fixed = false`, identical to a plain `Plug` dropped away from every jack (free to move under physics, and already fully re-draggable on its own since it's a real `<cavi-plug>`). `cancelCableSession` produces the same outcome without attempting any snap.
- **A full jack shows a "forbidden" cursor**: if the position known via `Jack.setPointerHoverPosition()` is within `20`px of the center of a jack that's at `max-plugs` (`!canAcceptMore()`) **while `Jack.setShiftHeld(true)` or a drag flagged with `Jack.setDragActive(true)` is in progress**, the host gets `cursor: not-allowed` (inline style, always wins over the `:host { cursor: crosshair }` rule) plus the `full-class` class. Hover detection is distance-based off the last known position (static state shared by every jack, fed from the outside), **not** native `pointerenter`/`pointerleave` on the jack: a jack with at least one plug attached has that `<cavi-plug>` sitting exactly at its center with a higher `z-index`, which would occlude it and keep native hover events from ever reaching the jack underneath.

  The "Shift held" and "a drag is in progress" conditions are **kept deliberately separate**: the state fed via `Jack.setShiftHeld()` is valid even before any drag starts (the pre-drag hover preview); the one fed via `Jack.setDragActive()` (an internal counter, not a boolean, so overlapping drags — e.g. multi-touch — don't clear each other's state) is instead meant to stay active for the whole duration of a gesture even if Shift is released mid-way — needed because Shift/right-click are only required to *start* the cable-creation drag, not to keep it going: once it starts, the new cable keeps following the position even after Shift is released (intentional, so you don't have to hold a key down for the whole drag). Without `setDragActive`, the forbidden preview would disappear the moment Shift comes up mid-drag, even while still actively dragging the free end toward a full jack.

  The state also re-evaluates without a new position whenever this jack's own capacity changes (`attach`/`detach`) or either drag starts/ends, while it's already being watched.
- **A full jack always carries `at-capacity-class`**: unlike `full-class`, this one is unconditional — it simply mirrors `!canAcceptMore()`, independent of hover or Shift, so it stays usable for a persistent "full" style (e.g. a border or icon) visible even without interacting with the jack.

## `Plug` (`src/plug.ts`)

A custom element (`cavi-plug`) with Shadow DOM.

**Observed attributes**
| Attribute | Effect |
|---|---|
| `plugged` | Toggles the "connected" visual style (set/removed on snap/unsnap) |
| `magnet-class` | Name of the CSS class applied to the host when the plug is near a compatible jack during a drag (default `cavi-magnet-active`) |
| `freeze-on-drop` | Presence-based boolean attribute (like `plugged`). When present, `endDrag()`/`cancelDrag()` away from every compatible jack leave the underlying node **fixed** (`node.fixed = true`) instead of free — the plug stays put at the drop point instead of swinging under gravity/tension, so it stays re-grabbable with a plain click/tap. Defaults to absent (unchanged behavior: free node) |

`type` is **not** an attribute on the plug: it is only received via `setType(type)`, called by the owning `<cavi-wire>` from its own `type` attribute.

**API**
| Method | Description |
|---|---|
| `setNode(node: Node)` | Binds the plug visually to a physical wire node |
| `setType(type: string)` | Sets the plug's connection type (propagated by the Cable, not settable via markup) |
| `attach(jack: Jack)` / `detach()` | Attaches/detaches the plug from a jack, going through the same jack-side `attach`/`detach` bookkeeping used by both dragging and `<cavi-wire>`'s declarative binding |
| `setMagnetActive(active: boolean)` | Toggles the `magnet-class` class on the host |
| `jack` (getter) | The `Jack` this plug is currently attached to, or `null` |
| `beginDrag()` | Starts a drag: detaches from any current jack, fixes the node (`node.fixed = true`), raises `z-index` |
| `updateDragPosition(clientX, clientY)` | Moves the plug (and its node) to the given position and refreshes the magnet preview against the nearest compatible in-range jack |
| `endDrag()` | Ends the drag, snapping to the nearest compatible in-range jack if any, otherwise applying `freeze-on-drop` semantics |
| `cancelDrag()` | Ends an interrupted drag: never snaps, even if a compatible jack is in range — same `freeze-on-drop` handling as `endDrag()` otherwise |

**Behavior**
1. `setNode(node: Node)` binds the plug visually to a `Node` instance (from a `Wire`); `update()`/`updatePosition()` keeps it synced to the node's `x`/`y` unless a drag is in progress (`beginDrag()` called with no following `endDrag()`/`cancelDrag()` yet).
2. `updateDragPosition(clientX, clientY)`, repeated during the drag: computes position relative to `offsetParent`, calls `node.setPosition(x, y)` **and** `node.setMousePosition(x, y)` (the latter forwards to `WasmWorld.set_mouse`, keeping physics mouse-repulsion in sync with the dragged plug), updates its own screen position, and recomputes the candidate magnet jack (`Jack.findSnapTarget()`), toggling the `magnet-class` classes on both jack and plug accordingly.
3. `endDrag()`: recomputes the nearest compatible jack (matching type, available capacity) within `20`px — doesn't trust the last computation from `updateDragPosition`, since a drop can happen with no intervening move; if found, snaps the node to the jack's center, calls `attach(jack)` and sets `plugged`; otherwise calls `detach()` and sets `node.fixed` based on `freeze-on-drop`, removing `plugged`.
4. `cancelDrag()`: same as `endDrag()`'s empty outcome, but never attempts any snap.

**Implementation notes**
- Jack lookup goes through `Jack.findSnapTarget()` (which internally scans the static `Jack.registry`), not a DOM query.
- `z-index`: plug uses `20`, jack uses `10`, matching the "jack under plug" requirement from the spec — relevant to the occlusion described below.
- `touch-action: none` is set on the plug's shadow-DOM host to prevent the browser from hijacking scroll during a touch drag, when driven by a Pointer-Events-based controller.

## Interaction: `StandardInteractionController` and `<cavi-interaction>`

As shown above, Jack/Plug listen for nothing on their own — real interaction (mouse, touch, pen, keyboard) is the responsibility of an external `IInteractionController` (`src/types.ts`):

```typescript
interface IInteractionController {
    attach: (cavi: Cavi) => void;
    detach: () => void;
}
```

**`StandardInteractionController`** (`src/interaction.ts`) is the standard implementation, and reproduces exactly the dragging behavior described in this document: a single instance installs a handful of listeners at the `document`/`window` level (`pointerdown`, `contextmenu`, `keydown`/`keyup`, `blur`, `pointermove`) and, for every recognized gesture, drives Jack/Plug exclusively through their public APIs described above — never touching internal state.

**`<cavi-interaction>`** (`src/interactionwc.ts`) is the web component that wires it up declaratively: on connect (after the `caviready` event, like `<cavi-wire>`) it calls `controller.attach(cavi)`; on disconnect it calls `controller.detach()`. Its public `controller` property (defaulting to a fresh `StandardInteractionController`) can be replaced **before** the element is connected to the document:

```typescript
const el = document.createElement('cavi-interaction');
el.controller = new MyCustomController(); // must implement IInteractionController
container.appendChild(el);
```

**`<cavi-world>`** (see [Overview](./01-overview.md)) automatically creates one if the author doesn't place one explicitly among its own children — so pages using `<cavi-world>` stay interactive out of the box, exactly like the canvas. To fully disable the standard interaction, place a `<cavi-interaction>` manually with a no-op controller, or one that implements only the desired UX.

### Gestures recognized by `StandardInteractionController`

- **`hold` vs `click-to-carry` mode** (`Cavi.setDragMode('hold' | 'click')`, a world-level option, not per element):
  - **`hold`** (default): the classic press-drag-release. `pointerdown` starts the gesture and calls `setPointerCapture` on the target element, so every subsequent pointer event for that pointer stays routed there even if the cursor leaves its bounds; `pointerup`/`pointercancel` end it. **While the button stays held, native browser scrolling — a trackpad's two-finger gesture in particular — typically stops being recognized** (a common limitation of many drivers, not specific to this library).
  - **`click`**: a click (no need to hold it) starts the gesture — a `document`-level `pointermove` listener follows the position **with no button held down**, so native scrolling works for the whole duration exactly as when nothing is being dragged. A second click (primary button, wherever it lands) ends the gesture; a non-primary-button click is ignored.
  - **Touch exception**: `click-to-carry` only applies to mouse and pen (`pointerType !== 'touch'`) — touch always uses `hold`, because the natural finger-drag gesture doesn't have the scroll conflict described above (already disabled during the drag by `touch-action: none`).
- **Cable-creation trigger**: `pointerdown` with `button === 2` (right button) or `button === 0 && shiftKey`, on a `<cavi-jack>` — calls `jack.createCable()`. The native context menu is always suppressed on a jack (`contextmenu` → `preventDefault()`).
- **Jack↔plug occlusion**: a plug attached to a jack is fixed exactly at the jack's center with a higher `z-index` — in a real browser a click at that point always resolves to the plug, never the jack underneath. The controller recognizes this via `event.composedPath()` (which correctly crosses Shadow DOM boundaries) and, if the resolved target is an attached `<cavi-plug>` **and** the gesture is a right-click or Shift+click, treats it as if it happened on its `.jack`, starting a new cable from there instead of dragging the plug. For the same reason the native context menu is also suppressed on an attached plug.
- **Dragging an existing `Plug`**: a primary-button `pointerdown` without Shift (and not caught by the occlusion case above) calls `plug.beginDrag()`. Shift is reserved for the cable-creation gesture — a plug doesn't get dragged while it's held.
- **Shift/hover tracking**: `keydown`/`keyup` on `Shift` feed `Jack.setShiftHeld()`; `blur` on the window clears it (a `keyup` can be missed if focus leaves the page, e.g. alt-tab); every `document`-level `pointermove` feeds `Jack.setPointerHoverPosition()`.
- **`detach()`**: removes every listener and clears the Shift/hover state exposed via `Jack`'s setters, so no jack is left stuck in a stale "forbidden" preview.

## `<cavi-wire>` — `type` propagation and terminal nodes (`src/wirewc.ts`)

- The `type` attribute on `<cavi-wire>` is read once during setup and propagated to every child `<cavi-plug>` via `plug.setType(type)`.
- Only `<cavi-plug node="...">` elements with index `0` or `nodeCount - 1` (the two terminal nodes) are wired up; an intermediate index logs a `console.warn` and the plug is skipped — intermediate nodes are not supported yet.
- If a `<cavi-plug>` has a `jack="id"` attribute, it is declaratively attached to the matching jack during setup, going through the same `plug.attach(jack)` used by dragging (so `jack.plugCount`/`max-plugs` stay correct for declarative connections too). If the jack's `type` doesn't match the cable's, a `console.warn` is logged but the connection is still made (the markup takes precedence).
- Each `<cavi-plug>`'s `node="N"` attribute is the ground truth for which index it's bound to, re-read whenever needed rather than only once at setup: if the cable's node count changes after the initial connection (today's only case: growing during `updateCableSession`, see above), whoever moves the free plug to a new index **must** also update this attribute — otherwise a later `_rebindAfterIndexShift` (triggered when this cable's WASM index shifts because a sibling cable was deleted — see below) would re-read the now-stale index and rebind the plug to an intermediate node instead of the real terminal.

### Auto-deleting a cable once it leaves the container (`auto-cleanup`)

Presence-based boolean attribute (like `plugged`/`freeze-on-drop`), **absent by default** — unchanged behavior until explicitly set, since this is an irreversible action (it also frees the cable's WASM memory).

When present, every frame of the `requestAnimationFrame` loop `CaviWireElement` already uses to sync its plugs also runs a synchronous check (`_cleanupIfOutsideContainer()`, easy to find via grep) that tests, via `getBoundingClientRect()`, whether **every** plug of the cable no longer overlaps the container passed to `new Renderer(container, world)` (exposed as `Cavi.getContainer()`/`Renderer.getContainer()` — see the [API reference](./03-api.md#renderer)). If so, the cable is destroyed (`_destroy()`): its `Wire` is deleted (`cavi.deleteWire(index)`, freeing the WASM memory) and the element is removed from the DOM — removal automatically triggers `disconnectedCallback` on every child `<cavi-plug>`, which in turn calls `detach()` (unplugging it from its Jack, if any).

Deliberately a synchronous per-frame check rather than `IntersectionObserver`: since the RAF loop already exists to sync plug positions, a bounding-box check in the same tick is precise to the exact frame and avoids the coalescing/latency `IntersectionObserver` is prone to (especially with a backgrounded tab).

**Important**: deleting a cable that isn't the last one created shifts the WASM index of every wire created after it (`World.deleteWire`, see the [API reference](./03-api.md#world)). `CaviWireElement` keeps its own static registry of every connected `<cavi-wire>` and, right after each deletion, rebinds (`_rebindAfterIndexShift`) every surviving cable whose index shifted to the correct fresh `Wire` — without this step, other cables would silently keep reading/writing the wrong wire. This does not cover a `Jack` that's actively creating a new cable (an unfinished `CableSession`) at the exact same moment a *different* auto-cleanup cable leaves — a very narrow edge case, not yet handled.

## Relationship to the physics engine

Neither `Jack` nor `Plug` talk to `WasmWorld` directly — they always go through a `Node` instance, which forwards position/fixed-state changes to the underlying WASM node (see [`Node` in the API reference](./03-api.md#node)). This keeps the connector UI consistent with the rest of the `cavijs` architecture (physics stays in WASM, DOM/interaction stays in TS).
