# Cavijs — Debugging and events

## `<cavi-debug>`

A developer overlay attached to one Cavi world: live statistics, a wire table, a few runtime settings, and a log of the events the world emits.

```html
<!-- Floating window, draggable and resizable, bound by id -->
<cavi-debug for="panel" open></cavi-debug>

<!-- Panel docked to the right edge that slides in and out -->
<cavi-world id="panel">
  …
  <cavi-debug mode="panel"></cavi-debug>
</cavi-world>
```

```ts
import 'cavijs'; // also registers <cavi-debug>
// or, in the demos/sources only:
import './src/debug/debugwc';
```

### Which world it inspects

In this order:

1. `for="<id>"` — the `<cavi-world>` (or renderer container) with that id; if it doesn't exist yet, it binds on its first `caviready`.
2. the nearest enclosing `<cavi-world>`;
3. whatever `Cavi.whenReady` resolves (i.e. `Cavi.shared`);
4. by hand: `debug.attach(cavi)` or `debug.attach(worldElement)` — useful for a manual setup without `<cavi-world>`.

### Attributes

| Attribute     | Default       | Description                                                         |
| ------------- | ------------- | ------------------------------------------------------------------- |
| `mode`        | `floating`    | `floating` (draggable window) or `panel` (docked to the right).     |
| `open`        | —             | Shown. Reflects the `.open` property.                               |
| `hotkey`      | `alt+shift+d` | Shortcut that toggles it; `none` disables it. Ignored while typing. |
| `events`      | —             | Extra, space-separated event names to log.                          |
| `no-launcher` | —             | No button to reopen it while closed.                                |
| `interval`    | `250`         | Stats refresh period, in ms.                                        |
| `max-events`  | `200`         | Maximum log length.                                                 |

### API

`show()`, `hide()`, `toggle()`, `open`, `mode`, `attach(target)`, `detach()`, `cavi`, `log(name, detail?)` (adds an entry by hand, e.g. for app events), `clearLog()`.

### What it shows

- **FPS** (with a sparkline), **wires**, free ends and orphaned wires, **nodes** (total and min–max per wire), **plugged/total plugs**, jacks and full jacks (`max-plugs` reached).
- **Physics**: gravity, friction, mouse/pointer radii, response coefficient, size of the render buffer shared with WASM.
- **View**: pointer position in world coordinates, registered zoom and pan (`setCoordinateTransformProvider`), container size.
- **Settings**: node drawing, wire shadows, orphan cleanup, `cable-drop-behavior`, `plug-spread-mode`.
- **Wires**: per wire its index, color, nodes, radius, polyline length, fixed (●) or free (○) ends.
- **Events**: log with time and a summarized detail. Identical events close together (and bursts of `cavi-resize`/`cavi-transform-change`) are merged into one `×N` entry. Clicking a counter hides/shows that event type; _Pause_ suspends recording.

Stats are only read while it is open. Position, size and collapsed sections are remembered in `localStorage` (key `cavi-debug:<id>`).

The window lives in the browser's _top layer_ (`popover` API): a pan/zoom transform or `z-index` on an ancestor never clips or covers it, even when nested in a zoomed `<cavi-world>`. It also stops pointer and wheel events from propagating, so dragging or scrolling it never starts the page's own pan/zoom.

Theming: CSS variables on `cavi-debug` (`--cavi-debug-bg`, `--cavi-debug-surface`, `--cavi-debug-border`, `--cavi-debug-text`, `--cavi-debug-muted`, `--cavi-debug-accent`, `--cavi-debug-warn`, `--cavi-debug-font`, `--cavi-debug-mono`) and the parts `::part(window)`, `::part(header)`, `::part(launcher)`.

### `collectStats(cavi)`

The same snapshot the panel uses, exported for use elsewhere (tests, telemetry, a custom overlay): returns a `CaviStats`.

## Events

All are `CustomEvent`s with `bubbles: true`, dispatched on the renderer container (the `<cavi-world>` element), so you can listen on the world or on `document`. `detail` types are in `CaviEventDetailMap`; the full list is `CAVI_EVENT_NAMES`.

| Event                   | When                                                                             | `detail`                           |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| `caviready`             | the `<cavi-world>` created its `Cavi`                                            | `{ cavi }`                         |
| `cavierror`             | the WASM module failed to load (logged too; the next `<cavi-world>` tries again) | `{ error }`                        |
| `cavi-resize`           | the container changed size                                                       | `{ width, height }`                |
| `cavi-transform-change` | `notifyCoordinateTransformChanged()`                                             | —                                  |
| `cavi-wire-add`         | a `<cavi-wire>` created its WASM wire                                            | `{ wire, element }`                |
| `cavi-wire-remove`      | a `<cavi-wire>` deleted its wire                                                 | `{ wire, element, index, reason }` |
| `cavi-plug-attach`      | a plug attaches to a jack                                                        | `{ plug, jack }`                   |
| `cavi-plug-detach`      | a plug detaches from a jack                                                      | `{ plug, jack }`                   |
| `cavi-cable-start`      | a new cable starts being pulled from a jack                                      | `{ jack, wire }`                   |
| `cavi-cable-end`        | cable creation finished                                                          | `{ jack, wire, result, target }`   |

`cavi-wire-remove`'s `reason`: `cleanup` (an orphaned cable deleted once out of view, see [orphan cleanup](./05-jack-plug.md#deleting-orphaned-cables-once-out-of-view-orphan-cleanup)) or `removed` (the element left the DOM).

`cavi-cable-end`'s `result`: `connected` (to `target`), `dangle`, `detach`, `cancel` (per `cable-drop-behavior`) or `abort` (`cancelCableSession`).

Without a `Cavi` (e.g. a jack outside any world) plug/cable events are dispatched on the jack itself, and still bubble up to `document`.

Wires created in code with `cavi.addWire()` don't go through `<cavi-wire>` and so emit no `cavi-wire-add`/`-remove`; the panel still counts them, since stats are read from the world.
