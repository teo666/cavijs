import { Cavi } from './cavi';
import { Renderer } from './renderer';
import { Jack } from './jack';
import { Plug } from './plug';

// Initialize WASM
await Cavi.initWasm();

const cavi = new Cavi();
const container = document.getElementById('container2')!;
const observer = new MutationObserver( (mutations: MutationRecord[], observer: MutationObserver) => {
    // Update positions of plugs when DOM changes (e.g., new jacks added)
    
});
observer.observe(container, { childList: true, subtree: true });
const renderer = new Renderer(container, cavi.getWorld());

cavi.setRenderer(renderer);
cavi.setAcceleration(0, 5); // Stronger gravity for demonstration

// Add a wire
const wire = cavi.addWire(100, 100, 300, 300, 20, 20, 5, 1);
wire.setColor("#d69e19");
wire.setMetaData("thickness", 4);

// Create Jacks
const jack1 = new Jack();
// jack1.setAttribute('x', '100');
// jack1.setAttribute('y', '100');
// jack1.setAttribute('color', '#e74c3c'); // Red
// container.appendChild(jack1);

// const jack2 = new Jack();
// jack2.setAttribute('x', '500');
// jack2.setAttribute('y', '400');
// jack2.setAttribute('color', '#3498db'); // Blue
// container.appendChild(jack2);

// const jack3 = new Jack();
// jack3.setAttribute('x', '800');
// jack3.setAttribute('y', '200');
// jack3.setAttribute('color', '#2ecc71'); // Green
// container.appendChild(jack3);

// Create Plugs
const startNode = wire.getNode(0);
if (startNode) {
    const plug1 = new Plug();
    plug1.setNode(startNode);
    container.appendChild(plug1);
    
    // Fix start node to first jack
    startNode.fixed = true;
    startNode.setPosition(100, 100);
}

const endNode = wire.getNode(wire.getNodeCount() - 1);
if (endNode) {
    const plug2 = new Plug();
    plug2.setNode(endNode);

    container.appendChild(plug2);
    
    // Initially loose? Or fixed to another location?
    // Let's place it loosely near the middle
    endNode.fixed = true;
    endNode.setPosition(300, 300);
}

// Add another wire connected to GREEN jack
const wire2 = cavi.addWire(800, 200, 800, 500, 25, 10, 10, 1);
wire2.setColor("#00ffae");

const startNode2 = wire2.getNode(0);
if (startNode2) {
    const plug3 = new Plug();
    plug3.setNode(startNode2);
    container.appendChild(plug3);
    
    startNode2.fixed = true;
    startNode2.setPosition(800, 200);
}

const endNode2 = wire2.getNode(wire2.getNodeCount() - 1);
if (endNode2) {
    const plug4 = new Plug();
    plug4.setNode(endNode2);
    container.appendChild(plug4);
}


// Start rendering
renderer.render();
