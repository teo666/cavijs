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

By default renders a small dark circle (`.inner`); if the element has child content, it renders that instead (via `<slot>`), letting consumers customize appearance while keeping the same drop-target semantics. `pointer-events: none` by default — hit-testing is handled entirely by `Plug` via distance-to-center, not by native events on the jack.

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
2. On `pointerdown` (primary button/touch only): starts dragging, immediately detaches from any current jack, fixes the underlying node (`node.fixed = true`), attempts `setPointerCapture` (feature-detected — not every environment supports it, see the jsdom note below), registers `pointermove`/`pointerup`/`pointercancel` listeners on itself, raises `z-index`.
3. On every `pointermove` while dragging: computes position relative to `offsetParent`, calls `node.setPosition(x, y)` **and** `node.setMousePosition(x, y)` (the latter forwards to `WasmWorld.set_mouse`, keeping physics mouse-repulsion in sync with the dragged plug), updates its own screen position, and recomputes the candidate magnet jack (`_findSnapTarget()`), toggling the `magnet-class` classes on both jack and plug accordingly — continuously, not only on drop.
4. On `pointerup`: recomputes the nearest compatible jack (matching type, available capacity) within `_snapDistance` (default `20`px); if found, snaps the node to the jack's center, calls `attach(jack)` and sets `plugged`; otherwise calls `detach()` and sets `node.fixed` based on `freeze-on-drop` (`true` if present, `false` otherwise), removing `plugged`.
5. On `pointercancel` (e.g. a gesture interrupted by the system, common on touch): same as an empty drop in step 4, without attempting any snap.

**Implementation notes**
- Jack lookup is done via the static `Jack.registry`, not a DOM query.
- `z-index`: plug uses `20`, jack uses `10`, matching the "jack under plug" requirement from the spec.
- `touch-action: none` is set on the plug's shadow-DOM host to prevent the browser from hijacking scroll during a touch drag.
- **jsdom**: `setPointerCapture`/`releasePointerCapture` are not implemented in jsdom (verified with jsdom 30.x) — the code feature-detects and degrades gracefully without native capture; tests simulate dragging by dispatching `PointerEvent`s directly on the plug.

## `<cavi-wire>` — `type` propagation and terminal nodes (`src/wirewc.ts`)

- The `type` attribute on `<cavi-wire>` is read once during setup and propagated to every child `<cavi-plug>` via `plug.setType(type)`.
- Only `<cavi-plug node="...">` elements with index `0` or `nodeCount - 1` (the two terminal nodes) are wired up; an intermediate index logs a `console.warn` and the plug is skipped — intermediate nodes are not supported yet.
- If a `<cavi-plug>` has a `jack="id"` attribute, it is declaratively attached to the matching jack during setup, going through the same `plug.attach(jack)` used by dragging (so `jack.plugCount`/`max-plugs` stay correct for declarative connections too). If the jack's `type` doesn't match the cable's, a `console.warn` is logged but the connection is still made (the markup takes precedence).

## Relationship to the physics engine

Neither `Jack` nor `Plug` talk to `WasmWorld` directly — they always go through a `Node` instance, which forwards position/fixed-state changes to the underlying WASM node (see [`Node` in the API reference](./03-api.md#node)). This keeps the connector UI consistent with the rest of the `cavijs` architecture (physics stays in WASM, DOM/interaction stays in TS).
