# Zoom, pan and multiple worlds

## Pan/zoom

cavijs does not implement pan/zoom itself: the consuming page applies a CSS transform (e.g. with d3-zoom) to some wrapper around `<cavi-world>`, and tells cavijs about it through a **coordinate transform provider**:

```typescript
worldEl.setCoordinateTransform(() => ({ scale: t.k, translateX: t.x, translateY: t.y }));
worldEl.notifyCoordinateTransformChanged(); // after every zoom/pan step
```

(`Cavi.setCoordinateTransformProvider` / `Cavi.notifyCoordinateTransformChanged` for a manual setup.) Every pointer position and every CSS-positioned jack is converted back to world coordinates through it (`clientToWorld` in `src/core/coords.ts`), so the physics never sees zoom-scaled values. Calling `setCoordinateTransform` before the world is ready is fine: the provider is applied as soon as it is.

### The drawing surface (`surface`)

By default the canvas (or svg) lives inside the world container and is CSS-scaled with it. That has two drawbacks:

- **clipping**: the canvas is only as big as the container, so once you zoom out, cables that leave the container's box disappear;
- **blur**: zooming in scales up a fixed-resolution bitmap.

Give the world a **surface** — an element _outside_ the transformed subtree, typically the fixed frame the zoom listens on:

```html
<div id="zoomFrame">
  <!-- untransformed; d3-zoom listens here -->
  <div id="viewport">
    <!-- transformed by d3-zoom -->
    <cavi-world surface="#zoomFrame"> ... </cavi-world>
  </div>
</div>
```

or, with a renderer created by hand:

```typescript
new Renderer(container, world, { surface: frame });
new SvgRenderer(container, world, { surface: frame });
```

The canvas/svg is then placed in the surface and sized to it (at `devicePixelRatio` resolution for the canvas), and the renderer maps world coordinates through the registered transform and the container's on-screen origin every frame. Cables stay visible wherever they go and stay sharp at any zoom.

Notes:

- The surface must be positioned; `<cavi-world>` sets `position: relative` on it if it is `static`.
- Cables are drawn _beneath_ the world content, so jacks and plugs stay on top. The world content must therefore not have an opaque background — put the background on the surface.
- `auto-cleanup` treats a cable as gone only once it has left both the container and the surface.

See `examples/demo-patchbay-zoom.html` (canvas) and `examples/demo-patchbay-zoom-svg.html` (SVG).

## Using your own canvas (or svg)

`<cavi-world>` creates a canvas only if it isn't given one. To draw into your own — for example **above** the jacks and plugs — name it with the `canvas` attribute (any CSS selector), or assign it to the `.canvas` property before the element connects:

```html
<cavi-world surface="#zoomFrame" canvas="#cables"> ... </cavi-world>
<canvas
  id="cables"
  style="position: absolute; top: 0; left: 0; z-index: 30; pointer-events: none"
></canvas>
```

With a hand-made renderer: `new Renderer(container, world, { canvas })` / `new SvgRenderer(container, world, { svg })`.

The canvas can sit anywhere on the page: the renderer measures its on-screen position (and scale, if it lives inside a zoomed element) every frame and aligns the drawing to the world. `<cavi-world>` only keeps its size matched to the world (or its surface) and never removes a canvas it didn't create.

Stacking notes:

- `pointer-events: none` is required, or the canvas swallows the clicks meant for jacks and plugs.
- Jacks have `z-index` 10, plugs 20, a plug being dragged 1000 — pick the value that fits (with 30, cables cover jacks and plugs but not a plug in mid-drag).
- `z-index` only competes within the same stacking context: a canvas inside an element with a `transform` (e.g. a draggable module) cannot rise above plugs outside it.

## Multiple worlds on one page

Every Jack, Plug, Wire and interaction controller resolves the `Cavi` instance it belongs to with `Cavi.for(element)`: the instance whose renderer container (registered by `Cavi.setRenderer`) is the element or its nearest ancestor. So several `<cavi-world>`s can coexist:

- each world has its own physics, coordinate transform and settings;
- a cable never snaps to a jack of another world;
- each world's `<cavi-interaction>` only handles pointer events on its own elements;
- `caviready` is dispatched on the `<cavi-world>` itself (and bubbles to `document`), and `Cavi.whenReady(el, fn)` waits for the element's own world.

`Cavi.shared` still exists — it points at the most recently initialized world and is the fallback for elements that live outside any registered container (single-world pages with a manual setup, tests).

## Using cavijs as a library

`pnpm build:lib` builds `dist-lib/cavijs.js` (ES module, `cavi` left external so your bundler serves its `.wasm`) and the type declarations in `dist-lib/types/`. `package.json` exposes them through `exports`, so the package can be consumed from a workspace or a git dependency; it is still marked `private`, so remove that flag before publishing to npm.
