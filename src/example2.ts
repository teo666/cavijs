import { Cavi } from './cavi';
import { Renderer } from './renderer';
import './jack';
import './wirewc'; // registers cavi-wire and pulls in cavi-plug

await Cavi.initWasm();

const cavi = new Cavi();
const container = document.getElementById('container2')!;
const renderer = new Renderer(container, cavi.getWorld());

cavi.setRenderer(renderer);
cavi.setAcceleration(0, 5);

// Make the Cavi instance available to cavi-wire web components
Cavi.shared = cavi;
document.dispatchEvent(new CustomEvent('caviready', { detail: { cavi } }));

renderer.render();
