import { Cavi } from '../src/core/cavi';
import { SvgRenderer } from '../src/renderer/renderer-svg';
import { CaviControls } from '../src/component/controls';
import './style.css'

/**
 * Same demo setup as main.ts (see demo-basic.html), but wired to SvgRenderer
 * instead of the canvas Renderer, to show the two are drop-in interchangeable.
 * SvgRenderer creates its own <svg> inside #wireArea, so the container here
 * is a plain positioned <div> rather than a pre-made <canvas>.
 */
await Cavi.initWasm();
const cavi = new Cavi();
const renderer = new SvgRenderer(document.getElementById('wireArea') as HTMLElement, cavi.getWorld());

cavi.setRenderer(renderer);

// Add multiple wires with different configurations
const wire = cavi.addWire(100.0, 200.0, 700.0, 200.0, 30, 10.0, 5.0, 1);  // Wire 0: horizontal (bezier)
const wire2 = cavi.addWire(150.0, 50.0,  400.0, 350.0, 25, 10,   5.0, 1);   // Wire 1: vertical (bezier)
const wire3 = cavi.addWire(10.0, 80.0, 550, 50.0, 20, 20, 10.0, 0);   // Wire 2: diagonal (segments)

wire.setMetaData("color", "red");
wire2.setMetaData("color", "yellow");
wire3.setMetaData("color", "green");

renderer.render();

cavi.setAcceleration(0, 10.0);

// Initialize the controls web component
const controlsElement = document.getElementById('controls') as CaviControls;
if (controlsElement) {
    controlsElement.setCavi(cavi);
}
