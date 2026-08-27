# Cavijs — Jack & Plug Components

`Jack` (`<cavi-jack>`) and `Plug` (`<cavi-plug>`) model connection points and cable terminals — e.g. for diagrams where cables ("wires", see `<cavi-wire>`) connect into fixed sockets, with a compatibility rule based on a single string type (e.g. `"audio"`, `"midi"`, `"scsi"`).

> This feature is newer than the core `Cavi`/`World`/`Wire` API and evolving — treat details here as a snapshot of `src/jack.ts` / `src/plug.ts` / `src/wirewc.ts` as currently implemented.

## Concept

- **`Plug`** models the terminal node of a cable (the draggable end of a `<cavi-wire>`). For now a plug always represents one of the cable's **two terminal nodes** (index `0` or `nodeCount - 1`); intermediate nodes are not supported yet.
- **`Jack`** models a fixed socket a plug can connect to, with its own string `type`.
- **`<cavi-wire>`** (the "Cable") owns its own `type`, automatically propagated to all of its child `<cavi-plug>` elements — a plug has no independent type settable via markup.
- A plug→jack connection is allowed if and only if `plug.type === jack.type` (plain equality; a jack with no `type` configured accepts no connection).
- Dragging a `Plug` over a compatible `Jack` snaps it into place ("magnet" effect); while approaching, both the candidate jack and the plug receive a configurable CSS class for visual preview (e.g. blur/glow), continuously during the drag — not only on drop. Dropping elsewhere leaves the underlying wire node unfixed by default, so the cable hangs freely and can be reattached later — unless the plug has the `freeze-on-drop` attribute, in which case it stays fixed exactly where it was dropped, always re-grabbable with a plain click/tap instead of having to chase a moving target.
- Both are Web Components that accept optional user-provided template content (with expected structure/classes).
- Z-order: `Plug` must always render above `Jack`, which renders above the canvas — so the plug is never occluded while dragging.
- Drag-and-drop works with both mouse and touch/pen via unified Pointer Events.

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
| `cable-tension`, `cable-size`, `cable-color` | Optional tension/radius/color values applied to a cable created by dragging from this jack (see below); when omitted, the cable uses `<cavi-wire>`'s own fixed defaults |
| `cable-node-spawn` | `"interpolate"` (default) or `"stack"` — where newly-inserted nodes appear as the cable grows longer during the drag (see below) |

**API**
| Method | Description |
|---|---|
| `canAccept(type: string) -> boolean` | Returns true if `type` equals the jack's own `type` (and the jack has one configured) |
| `canAcceptMore() -> boolean` | Returns true if the jack hasn't reached `max-plugs` |
| `attach(plug: Plug)` / `detach(plug: Plug)` | Registers/removes an attached plug (updates `plugCount`) |
| `plugCount` | Number of currently attached plugs |
| `getCenter() -> { x, y }` | Center point in viewport coordinates (`getBoundingClientRect`) |
| `type` (getter) | The jack's current `type` |
| `setMagnetActive(active: boolean)` | Toggles the `magnet-class` class on the host, used for the magnet preview during drag |

By default renders a small dark circle (`.inner`); if the element has child content, it renders that instead (via `<slot>`), letting consumers customize appearance while keeping the same drop-target semantics.

The host has an explicit `24×24px` size and receives native pointer events (`pointer-events: auto`) — this is what lets it act as a cable-creation drag source (see below). Note that hit-testing for an *existing* `Plug` snapping onto a jack is still entirely distance-based (`Plug._findSnapTarget()` via `Jack.registry`), not driven by native events on the jack; the jack's own pointer events are only used to start a *new* cable.

## Creating a cable from a Jack (`src/jack.ts`)

Besides being a drop target, a `Jack` is also a drag **source**: right-click, or left-click + <kbd>Shift</kbd>, on a jack with spare capacity (`canAcceptMore()`) immediately creates a brand new `<cavi-wire>` — one `<cavi-plug>` attached to that jack right away, the other following the cursor.

- **Trigger**: `pointerdown` with `button === 2` (right button) or `button === 0 && shiftKey`. The jack's native context menu is suppressed unconditionally (`contextmenu` → `preventDefault()`), since the jack is always a potential right-click drag source. A jack already at `max-plugs` ignores the gesture.
- **Cable construction**: builds a `<cavi-wire type="{jack.type}" length="4">` with two `<cavi-plug>` children (`node="0"` / `node="3"`), inserted as a sibling of the jack (so it shares the same `offsetParent`/coordinate space Plug already relies on). Node `0` is immediately positioned at the jack's center, fixed, and attached (`plugged`); node `3` is placed at the initial cursor position. The new `<cavi-wire>`'s tension (`tension`), radius (`size`) and color (`color`) are copied from the origin jack's `cable-tension`/`cable-size`/`cable-color` attributes when present; any omitted one falls back to `<cavi-wire>`'s own fixed default (render type excluded: always bezier by default, unless `renderType="segments"` on the cable — there's no `cable-render-type` equivalent).
- **Growing while dragging**: on every `pointermove`, the free node's position tracks the cursor, and the node count grows with the distance from the origin jack — `4 + floor(distance / 30)`, capped at `60`. **The cable only ever grows during a drag, never shrinks back** as the cursor approaches again — like pulling a cable out of the screen, once it's out it stays out until release. A growth step inserts only the missing nodes one at a time with `Wire.addNodeAt()` (see [`Wire` in the API reference](./03-api.md#wire)) — unlike an earlier approach based on `Wire.setNodeCount()`, which rebuilt the whole cable, this leaves every already-existing, physics-settled node's state (position, velocity) untouched. Each newly-inserted node is placed according to `cable-node-spawn`: `"interpolate"` (default) puts it immediately on the straight line between the last settled node and the cursor; `"stack"` spawns it on top of the last settled node, leaving the constraint solver to spread it out over following frames. Either way the free `Plug` is rebound to the new last node, since growth shifts the terminal index. Just like `Plug.handlePointerMove`, every `pointermove` also calls `node.setMousePosition(x, y)` on the free node: without it, `preventDefault()` in `handlePointerDown` (needed to suppress text selection during Shift+drag) makes the browser stop firing native `mousemove` for the duration of the interaction, freezing the "world mouse" interaction (physics repulsion of other wires) that `Renderer` normally drives from that event, until release.
- **Magnet preview**: identical mechanics to `Plug`'s own drag — same `20`px snap distance, same continuous highlight toggling (`setMagnetActive`) on both the candidate jack and the free plug while in range, computed via the same `Jack.registry` scan (excluding the origin jack itself, so a cable can't snap back onto its own source).
- **On release**: if a compatible jack is in range, the free plug snaps to it exactly like a normal `Plug` drop (`fixed = true`, `attach()`, `plugged`). Otherwise the cable stays attached at the origin with the free end left dangling — `node.fixed = false`, identical to a plain `Plug` dropped away from every jack today (free to move under physics, and already fully re-draggable on its own since it's a real `<cavi-plug>`). A `pointercancel` is treated the same as an empty release.
- **A full jack shows a "forbidden" cursor**: if the cursor is within `20`px of the center of a jack that's at `max-plugs` (`!canAcceptMore()`) **while Shift is held or a drag that could try to connect to it is in progress**, the host gets `cursor: not-allowed` (inline style, always wins over the `:host { cursor: crosshair }` rule) plus the `full-class` class. This already applies on a plain Shift+hover, before any drag starts from this jack. Hover detection is distance-based off the last known pointer position (a single `pointermove` listener on `document`, shared by every jack), **not** native `pointerenter`/`pointerleave` on the jack: a jack with at least one plug attached has that `<cavi-plug>` sitting exactly at its center with a higher `z-index`, which would occlude it and keep native hover events from ever reaching the jack underneath — the same shared `pointermove` listener also picks up an in-progress drag's movement (its events still bubble up to `document` even under `setPointerCapture`), so no extra wiring is needed to track its position.

  The "Shift held" and "a drag is in progress" conditions are **kept deliberately separate**: `Jack._shiftHeld` is just the raw Shift key state, valid even before any drag starts (the pre-drag hover preview); `Jack._dragActive` (an internal counter, not a boolean, so overlapping drags — e.g. multi-touch — don't clear each other's state) is active for the whole duration of **two** distinct gestures instead, via the public `Jack.setDragActive(active)` method:
  1. `Plug` relocating an existing plug from one jack to another (`handlePointerDown`/`_endDrag`).
  2. This same `Jack`'s own cable-creation drag (`handlePointerDown`/`_endCableDrag`, see above) — **needed because Shift/right-click are only required to *start* that drag, not to keep it going**: once it starts, the new cable keeps following the cursor even after Shift is released (intentional, so you don't have to hold a key down for the whole drag). Without `_dragActive`, the forbidden preview would disappear the moment Shift comes up mid-drag, even while still actively dragging the free end toward a full jack.

  The state also re-evaluates without the cursor moving whenever this jack's own capacity changes (`attach`/`detach`) or either drag starts/ends, while it's already being watched.
- **A full jack always carries `at-capacity-class`**: unlike `full-class`, this one is unconditional — it simply mirrors `!canAcceptMore()`, independent of hover or Shift, so it stays usable for a persistent "full" style (e.g. a border or icon) visible even without interacting with the jack. Refreshed from the same recompute points as `full-class` (`attach`/`detach`/`max-plugs` change), via the same internal `_refreshFullState()` method.
- **Existing plugs don't move while Shift is held**: `Plug.handlePointerDown` ignores any `pointerdown` with `shiftKey` set, since Shift is reserved for starting a new cable — see the `Plug` section below.

## `Plug` (`src/plug.ts`)

A custom element (`cavi-plug`) with Shadow DOM, draggable via **Pointer Events** (mouse, touch and pen through the same code path).

**Observed attributes**
| Attribute | Effect |
|---|---|
| `plugged` | Toggles the "connected" visual style (set/removed on snap/unsnap) |
| `magnet-class` | Name of the CSS class applied to the host when the plug is near a compatible jack during a drag (default `cavi-magnet-active`) |
| `freeze-on-drop` | Presence-based boolean attribute (like `plugged`). When present, dropping away from every compatible jack leaves the underlying node **fixed** (`node.fixed = true`) instead of free — the plug stays put at the drop point instead of swinging under gravity/tension, so it stays re-grabbable with a plain click/tap. Defaults to absent (unchanged behavior: free node). Applies to both a normal drop and a `pointercancel` |

`type` is **not** an attribute on the plug: it is only received via `setType(type)`, called by the owning `<cavi-wire>` from its own `type` attribute.

**API**
| Method | Description |
|---|---|
| `setNode(node: Node)` | Binds the plug visually to a physical wire node |
| `setType(type: string)` | Sets the plug's connection type (propagated by the Cable, not settable via markup) |
| `attach(jack: Jack)` / `detach()` | Attaches/detaches the plug from a jack, going through the same jack-side `attach`/`detach` bookkeeping used by both dragging and `<cavi-wire>`'s declarative binding |
| `setMagnetActive(active: boolean)` | Toggles the `magnet-class` class on the host |

**Behavior**
1. `setNode(node: Node)` binds the plug visually to a `Node` instance (from a `Wire`); `updatePosition()` keeps it synced to the node's `x`/`y` unless currently being dragged.
2. On `pointerdown`: if it's a right-click or a Shift+left-click (the two cable-creation gestures from `Jack`, see above) **and** this plug is currently attached to a jack, the event is forwarded verbatim to `jack.handlePointerDown(e)` instead of being handled here — see the jack↔plug occlusion note below. Otherwise, for a primary-button `pointerdown` without Shift: starts dragging, immediately detaches from any current jack, fixes the underlying node (`node.fixed = true`), attempts `setPointerCapture` (feature-detected — not every environment supports it, see the jsdom note below), registers `pointermove`/`pointerup`/`pointercancel` listeners on itself, raises `z-index`. A plug that isn't attached to any jack ignores right-click and Shift+click (unchanged from before).
3. On every `pointermove` while dragging: computes position relative to `offsetParent`, calls `node.setPosition(x, y)` **and** `node.setMousePosition(x, y)` (the latter forwards to `WasmWorld.set_mouse`, keeping physics mouse-repulsion in sync with the dragged plug), updates its own screen position, and recomputes the candidate magnet jack (`_findSnapTarget()`), toggling the `magnet-class` classes on both jack and plug accordingly — continuously, not only on drop.
4. On `pointerup`: recomputes the nearest compatible jack (matching type, available capacity) within `_snapDistance` (default `20`px); if found, snaps the node to the jack's center, calls `attach(jack)` and sets `plugged`; otherwise calls `detach()` and sets `node.fixed` based on `freeze-on-drop` (`true` if present, `false` otherwise), removing `plugged`.
5. On `pointercancel` (e.g. a gesture interrupted by the system, common on touch): same as an empty drop in step 4, without attempting any snap.

**Implementation notes**
- Jack lookup is done via the static `Jack.registry`, not a DOM query.
- `z-index`: plug uses `20`, jack uses `10`, matching the "jack under plug" requirement from the spec.
- `touch-action: none` is set on the plug's shadow-DOM host to prevent the browser from hijacking scroll during a touch drag.
- **jsdom**: `setPointerCapture`/`releasePointerCapture` are not implemented in jsdom (verified with jsdom 30.x) — the code feature-detects and degrades gracefully without native capture; tests simulate dragging by dispatching `PointerEvent`s directly on the plug.
- **Jack↔plug occlusion when starting a new cable**: a plug attached to a jack is fixed exactly at the jack's center with a higher `z-index` (`20` vs `10`, see below) — and they're DOM siblings, never ancestor/descendant. In a real browser a click at that point always resolves to the plug, and a `pointerdown` registered directly on `<cavi-jack>` would never receive it (the event has nowhere sideways to bubble to reach the jack). Fixed by having `Plug.handlePointerDown` recognize the two cable-creation gestures (right-click or Shift+click) while attached and forward them straight to `this._jack.handlePointerDown(e)` — which works correctly even though it wasn't the event's original target (`setPointerCapture` doesn't require the capturing element to be the original target). For the same reason `Plug` also suppresses its own native `contextmenu` while attached (`handleContextMenu`), otherwise a right-click landing on the plug would still pop the browser's context menu during what's meant to be a cable-creation drag.

## `<cavi-wire>` — `type` propagation and terminal nodes (`src/wirewc.ts`)

- The `type` attribute on `<cavi-wire>` is read once during setup and propagated to every child `<cavi-plug>` via `plug.setType(type)`.
- Only `<cavi-plug node="...">` elements with index `0` or `nodeCount - 1` (the two terminal nodes) are wired up; an intermediate index logs a `console.warn` and the plug is skipped — intermediate nodes are not supported yet.
- If a `<cavi-plug>` has a `jack="id"` attribute, it is declaratively attached to the matching jack during setup, going through the same `plug.attach(jack)` used by dragging (so `jack.plugCount`/`max-plugs` stay correct for declarative connections too). If the jack's `type` doesn't match the cable's, a `console.warn` is logged but the connection is still made (the markup takes precedence).
- Each `<cavi-plug>`'s `node="N"` attribute is the ground truth for which index it's bound to, re-read whenever needed rather than only once at setup: if the cable's node count changes after the initial connection (today's only case: growing during a Jack cable-creation drag, see above), whoever moves the free plug to a new index **must** also update this attribute — otherwise a later `_rebindAfterIndexShift` (triggered when this cable's WASM index shifts because a sibling cable was deleted — see below) would re-read the now-stale index and rebind the plug to an intermediate node instead of the real terminal.

### Auto-deleting a cable once it leaves the container (`auto-cleanup`)

Presence-based boolean attribute (like `plugged`/`freeze-on-drop`), **absent by default** — unchanged behavior until explicitly set, since this is an irreversible action (it also frees the cable's WASM memory).

When present, every frame of the `requestAnimationFrame` loop `CaviWireElement` already uses to sync its plugs also runs a synchronous check (`_cleanupIfOutsideContainer()`, easy to find via grep) that tests, via `getBoundingClientRect()`, whether **every** plug of the cable no longer overlaps the container passed to `new Renderer(container, world)` (exposed as `Cavi.getContainer()`/`Renderer.getContainer()` — see the [API reference](./03-api.md#renderer)). If so, the cable is destroyed (`_destroy()`): its `Wire` is deleted (`cavi.deleteWire(index)`, freeing the WASM memory) and the element is removed from the DOM — removal automatically triggers `disconnectedCallback` on every child `<cavi-plug>`, which in turn calls `detach()` (unplugging it from its Jack, if any) and drops its own drag listeners.

Deliberately a synchronous per-frame check rather than `IntersectionObserver`: since the RAF loop already exists to sync plug positions, a bounding-box check in the same tick is precise to the exact frame and avoids the coalescing/latency `IntersectionObserver` is prone to (especially with a backgrounded tab).

**Important**: deleting a cable that isn't the last one created shifts the WASM index of every wire created after it (`World.deleteWire`, see the [API reference](./03-api.md#world)). `CaviWireElement` keeps its own static registry of every connected `<cavi-wire>` and, right after each deletion, rebinds (`_rebindAfterIndexShift`) every surviving cable whose index shifted to the correct fresh `Wire` — without this step, other cables would silently keep reading/writing the wrong wire. This does not cover a `Jack` that's actively creating a new cable at the exact same moment a *different* auto-cleanup cable leaves — a very narrow edge case, not yet handled.

## Relationship to the physics engine

Neither `Jack` nor `Plug` talk to `WasmWorld` directly — they always go through a `Node` instance, which forwards position/fixed-state changes to the underlying WASM node (see [`Node` in the API reference](./03-api.md#node)). This keeps the connector UI consistent with the rest of the `cavijs` architecture (physics stays in WASM, DOM/interaction stays in TS).
