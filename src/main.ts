import { Cavi } from './cavi';
import { Renderer } from './renderer';
import './style.css'
import initSync, { World, Wire, type InitOutput } from 'cavi'

let wasm: InitOutput;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let frameCount = 0;
let mouseX = -1000;
let mouseY = -1000;
let isDragging = false;
let draggedWire: number|null = null;
let draggedEndpoint: 'start' | 'end' | null = null;
let lastTime = performance.now();
let fpsFrameCount = 0;
let fps = 0;

await Cavi.initWasm();
const cavi = new Cavi();
// await cavi.init();
cavi.renderer = new Renderer(document.getElementById('wireCanvas') as HTMLCanvasElement, cavi.getWorld);

// Add multiple wires with different configurations
cavi.addWire(100.0, 200.0, 700.0, 200.0, 30, 10.0, 5.0, 1);  // Wire 0: horizontal (bezier)
cavi.addWire(150.0, 50.0,  400.0, 350.0, 25, 10,   5.0, 1);   // Wire 1: vertical (bezier)
cavi.addWire(10.0, 80.0, 550, 50.0, 20, 20, 10.0, 0);   // Wire 2: diagonal (segments)

cavi.renderer?.render();

cavi.setAcceleration(0, 10.0);


// function run() {
//     // Get canvas and context
//     const _canvas = document.getElementById('wireCanvas') as HTMLCanvasElement;
//     if (_canvas === null) {
//         throw new Error("Canvas element not found");
//     }
//     canvas = _canvas;
//     const _ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
//     if (_ctx === null) {
//         throw new Error("Failed to get 2D context");
//     }
//     ctx = _ctx;
    
//     // Create a new World
    
//     // Add multiple wires with different configurations
//     world.add_wire_with_count(100.0, 200.0, 700.0, 200.0, 30, 10.0, 5.0, 1);  // Wire 0: horizontal (bezier)
//     world.add_wire_with_count(150.0, 50.0,  400.0, 350.0, 25, 10,   5.0, 1);   // Wire 1: vertical (bezier)
//     world.add_wire_with_count(10.0, 80.0, 550, 50.0, 20, 20, 10.0, 0);   // Wire 2: diagonal (segments)

//     const wireCount = world.wire_count();
//     console.log(`Created ${wireCount} wires`);
    
//     for (let i = 0; i < wireCount; i++) {
//         const nodeCount = world.get_wire_node_count(i);
//         console.log(`Wire ${i}: ${nodeCount} nodes`);
//     }
    
//     // Setup control panel
//     setupControls();
    
//     // Setup action buttons
//     document.getElementById('addWireBtn')?.addEventListener('click', addRandomWire);
//     document.getElementById('clearBtn')?.addEventListener('click', clearWires);
    
//     // Add mouse interaction
//     canvas.addEventListener('mousemove', (e) => {
//         const rect = canvas.getBoundingClientRect();
//         mouseX = e.clientX - rect.left;
//         mouseY = e.clientY - rect.top;
        
//         if (isDragging && draggedWire !== null && draggedEndpoint !== null) {
//             // Update the dragged endpoint position
//             if (draggedEndpoint === 'start') {
//                 world.set_wire_start(draggedWire, mouseX, mouseY);
//             } else {
//                 world.set_wire_end(draggedWire, mouseX, mouseY);
//             }
//         } else {
//             world.set_mouse(mouseX, mouseY);
//         }
//     });
    
//     canvas.addEventListener('mousedown', (e) => {
//         const rect = canvas.getBoundingClientRect();
//         mouseX = e.clientX - rect.left;
//         mouseY = e.clientY - rect.top;
        
//         // Check if we're clicking near a wire endpoint
//         const clickRadius = 15; // Pixels
//         const wireCount = world.wire_count();
        
//         for (let i = 0; i < wireCount; i++) {
//             const nodeCount = world.get_wire_node_count(i);
//             if (nodeCount < 2) continue;
            
//             // Check start node
//             const startX = world.get_wire_node_x(i, 0);
//             const startY = world.get_wire_node_y(i, 0);
//             const distStart = Math.sqrt((mouseX - startX) ** 2 + (mouseY - startY) ** 2);
            
//             if (distStart < clickRadius) {
//                 isDragging = true;
//                 draggedWire = i;
//                 draggedEndpoint = 'start';
//                 canvas.style.cursor = 'grabbing';
//                 return;
//             }
            
//             // Check end node
//             const endX = world.get_wire_node_x(i, nodeCount - 1);
//             const endY = world.get_wire_node_y(i, nodeCount - 1);
//             const distEnd = Math.sqrt((mouseX - endX) ** 2 + (mouseY - endY) ** 2);
            
//             if (distEnd < clickRadius) {
//                 isDragging = true;
//                 draggedWire = i;
//                 draggedEndpoint = 'end';
//                 canvas.style.cursor = 'grabbing';
//                 return;
//             }
//         }
//     });
    
//     canvas.addEventListener('mouseup', () => {
//         isDragging = false;
//         draggedWire = null;
//         draggedEndpoint = null;
//         canvas.style.cursor = 'default';
//     });
    
//     canvas.addEventListener('mouseleave', () => {
//         // Reset mouse position to outside canvas when mouse leaves
//         mouseX = -1000;
//         mouseY = -1000;
//         world.set_mouse(mouseX, mouseY);
        
//         // Also stop dragging
//         isDragging = false;
//         draggedWire = null;
//         draggedEndpoint = null;
//         canvas.style.cursor = 'default';
//     });
    
//     // Start animation loop
//     animate();
// }

// function animate() {
//     const currentTime = performance.now();
    
//     // Update FPS counter every second
//     fpsFrameCount++;
//     if (currentTime - lastTime >= 1000) {
//         fps = fpsFrameCount;
//         fpsFrameCount = 0;
//         lastTime = currentTime;
//     }
    
//     // Update physics
//     world.update();
    
//     // Clear canvas
//     ctx.fillStyle = '#0a0a0a';
//     ctx.fillRect(0, 0, canvas.width, canvas.height);
    
//     // Draw all wires using efficient memory access
//     drawAllWiresEfficient();
    
//     // Draw wire endpoints to show they're draggable
//     drawWireEndpoints();
    
//     // Draw interaction radii at mouse position
//     drawInteractionRadii();
    
//     // Update debug info
//     updateDebugInfo();
    
//     // Continue animation
//     requestAnimationFrame(animate);
// }

// function drawAllWiresEfficient() {
//     // Access wire data directly from WASM memory (ZERO COPY!)
//     const ptr = world.wire_data_ptr();
//     const len = world.wire_data_len();
    
//     if (len === 0) return;
    
//     // Create Float32Array view directly into WASM memory (buffer is now f32)
//     const wireData = new Float32Array(
//         wasm.memory.buffer,
//         ptr,
//         len
//     );
    
//     const colors = ['#00ff88', '#ff00ff', '#ffaa00'];
//     const colors2 = ['#acfbd6', '#fd71ea', '#fdcd6b'];
//     const movableColors = ['#4488ff', '#ff44ff', '#ffaa44'];
    
//     let offset = 0;
//     const wireCount = world.wire_count();
    
//     for (let wireIdx = 0; wireIdx < wireCount; wireIdx++) {
//         const nodeCount = wireData[offset++];
//         const radius = wireData[offset++];
//         const renderType = wireData[offset++];
//         const pathLength = wireData[offset++];
        
//         // Draw wire path
//         if (pathLength >= 2) {
//             ctx.strokeStyle = colors[wireIdx % colors.length];
//             ctx.lineWidth = radius * 2;
//             ctx.lineCap = 'round';
//             ctx.lineJoin = 'round';
            
//             ctx.beginPath();
            
//             // Start at first point
//             ctx.moveTo(wireData[offset], wireData[offset + 1]);
            
//             offset += 2;

//             if (renderType === 0) {
//                 // Render as segments
//                 const targetOffset = offset + pathLength - 2;
//                 while (offset < targetOffset) {
//                     const x = wireData[offset++];
//                     const y = wireData[offset++];
//                     ctx.lineTo(x, y);
//                 }
//             } else {
//                 // Render as Bezier curves
//                 const targetOffset = offset + pathLength - 2;
//                 while (offset < targetOffset) {
//                     const cp1x = wireData[offset++];
//                     const cp1y = wireData[offset++];
//                     const cp2x = wireData[offset++];
//                     const cp2y = wireData[offset++];
//                     const x = wireData[offset++];
//                     const y = wireData[offset++];
                    
//                     ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
//                 }
//             }
            
//             ctx.stroke();
//         } else {
//             offset += pathLength;
//         }

//         // Draw nodes (we still use the original API for this since we need node fixed state)
//         //  drawNodesForWire(wireIdx, radius, movableColors[wireIdx % movableColors.length]);
//     }
// }

// function drawNodesForWire(wireIdx:number, radius:number, movableColor:string) {
//     const nodeCount = world.get_wire_node_count(wireIdx);
    
//     for (let i = 0; i < nodeCount; i++) {
//         const x = world.get_wire_node_x(wireIdx, i);    
//         const y = world.get_wire_node_y(wireIdx, i);
//         const node = world.get_wire_node(wireIdx, i);
        
//         if (!node) continue;
        
//         // Draw node circle
//         ctx.beginPath();
//         ctx.arc(x, y, radius, 0, Math.PI * 2);
        
//         // Color based on whether node is fixed
//         if (node.is_fixed()) {
//             ctx.fillStyle = '#ff4444';
//         } else {
//             ctx.fillStyle = movableColor;
//         }
//         ctx.fill();
        
//         // Draw node outline
//         ctx.strokeStyle = '#ffffff';
//         ctx.lineWidth = 2;
//         ctx.stroke();
//     }
// }

// function printNodePositions(world:World, wireIndex:number, nodeCount:number) {
//     const positions = [];
//     for (let i = 0; i < nodeCount; i++) {
//         const x = world.get_wire_node_x(wireIndex, i);
//         const y = world.get_wire_node_y(wireIndex, i);
//         positions.push({ node: i, x: x.toFixed(2), y: y.toFixed(2) });
//     }
//     console.table(positions);
// }

// /**
//  * Setup control panel sliders and event listeners
//  */
// function setupControls() {
//     // Mouse Radius
//     const mouseRadiusSlider = document.getElementById('mouseRadius');
//     const mouseRadiusValue = document.getElementById('mouseRadiusValue');
//     mouseRadiusSlider?.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         world.set_mouse_radius(value);
//         mouseRadiusValue!.textContent = value.toFixed(1);
//     });
    
//     // Pointer Radius
//     const pointerRadiusSlider = document.getElementById('pointerRadius');
//     const pointerRadiusValue = document.getElementById('pointerRadiusValue');
//     pointerRadiusSlider?.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         world.set_pointer_radius(value);
//         pointerRadiusValue!.textContent = value.toFixed(1);
//     });
    
//     // Response Coefficient
//     const responseCoefSlider = document.getElementById('responseCoef');
//     const responseCoefValue = document.getElementById('responseCoefValue');
//     responseCoefSlider?.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         world.set_response_coef(value);
//         responseCoefValue!.textContent = value.toFixed(2);
//     });
    
//     // Friction
//     const frictionSlider = document.getElementById('friction');
//     const frictionValue = document.getElementById('frictionValue');
//     frictionSlider?.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         world.set_friction(value);
//         frictionValue!.textContent = value.toFixed(2);
//     });
    
//     // Acceleration X
//     const accelerationXSlider = document.getElementById('accelerationX');
//     const accelerationXValue = document.getElementById('accelerationXValue');
//     accelerationXSlider?.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         const currentAccel = world.get_acceleration();
//         world.set_acceleration(value, currentAccel.y);
//         accelerationXValue!.textContent = value.toFixed(1);
//     });
    
//     // Acceleration Y
//     const accelerationYSlider = document.getElementById('accelerationY');
//     const accelerationYValue = document.getElementById('accelerationYValue');
//     accelerationYSlider?.addEventListener('input', (e) => {
//         const value = parseFloat((e.target as HTMLInputElement).value);
//         const currentAccel = world.get_acceleration();
//         world.set_acceleration(currentAccel.x, value);
//         accelerationYValue!.textContent = value.toFixed(1);
//     });
    
//     // Node Count Controls
//     for (let i = 0; i < 3; i++) {
//         const slider = document.getElementById(`nodeCount${i}`);
//         const valueDisplay = document.getElementById(`nodeCount${i}Value`);
        
//         if (slider && valueDisplay) {
//             slider.addEventListener('input', (e) => {
//                 const value = parseInt((e.target as HTMLInputElement).value);
//                 world.set_wire_node_count(i, value);
//                 valueDisplay.textContent = value.toString();
//             });
//         }
//     }
    
//     // Calculate Default Node Counts
//     const calculateDefaultBtn = document.getElementById('calculateDefault');
//     if (calculateDefaultBtn) {
//         calculateDefaultBtn.addEventListener('click', () => {
//             const wireCount = world.wire_count();
            
//             for (let i = 0; i < Math.min(wireCount, 3); i++) {
//                 const nodeCount = world.get_wire_node_count(i);
//                 const startX = world.get_wire_node_x(i, 0);
//                 const startY = world.get_wire_node_y(i, 0);
//                 const endX = world.get_wire_node_x(i, nodeCount - 1);
//                 const endY = world.get_wire_node_y(i, nodeCount - 1);
//                 const radius = world.get_wire_radius(i);
                
//                 const defaultCount = World.wire_optimal_length(startX, startY, endX, endY, 10.0);
                
//                 // Apply default
//                 world.set_wire_node_count(i, defaultCount);
                
//                 // Update UI
//                 const slider = document.getElementById(`nodeCount${i}`) as HTMLInputElement;
//                 const valueDisplay = document.getElementById(`nodeCount${i}Value`);
//                 if (slider && valueDisplay) {
//                     slider.value = defaultCount.toString();
//                     valueDisplay.textContent = defaultCount.toString();
//                 }
//             }
//         });
//     }
// }

// /**
//  * Draws visual indicators for mouse_radius and pointer_radius at the current mouse position
//  */
// function drawInteractionRadii() {
//     // Only draw if mouse is within canvas bounds
//     if (mouseX < 0 || mouseY < 0 || mouseX > canvas.width || mouseY > canvas.height) {
//         return;
//     }
    
//     const mouseRadius = world.get_mouse_radius();
//     const pointerRadius = world.get_pointer_radius();
    
//     // Draw pointer radius (inner circle)
//     ctx.beginPath();
//     ctx.arc(mouseX, mouseY, pointerRadius, 0, Math.PI * 2);
//     ctx.strokeStyle = '#ffff00'; // Yellow
//     ctx.lineWidth = 2;
//     ctx.setLineDash([5, 5]);
//     ctx.stroke();
//     ctx.setLineDash([]);
    
//     // Draw mouse radius (outer circle)
//     ctx.beginPath();
//     ctx.arc(mouseX, mouseY, mouseRadius, 0, Math.PI * 2);
//     ctx.strokeStyle = '#ff00ff'; // Magenta
//     ctx.lineWidth = 2;
//     ctx.setLineDash([5, 5]);
//     ctx.stroke();
//     ctx.setLineDash([]);
    
//     // Draw center point
//     ctx.beginPath();
//     ctx.arc(mouseX, mouseY, 3, 0, Math.PI * 2);
//     ctx.fillStyle = '#ffffff';
//     ctx.fill();
    
//     // Draw labels
//     ctx.font = '12px monospace';
//     ctx.fillStyle = '#ffffff';
//     ctx.strokeStyle = '#000000';
//     ctx.lineWidth = 3;
    
//     // Pointer radius label
//     const pointerLabelX = mouseX + pointerRadius * 0.7;
//     const pointerLabelY = mouseY - pointerRadius * 0.7;
//     ctx.strokeText(`pointer: ${pointerRadius.toFixed(1)}`, pointerLabelX, pointerLabelY);
//     ctx.fillText(`pointer: ${pointerRadius.toFixed(1)}`, pointerLabelX, pointerLabelY);
    
//     // Mouse radius label
//     const mouseLabelX = mouseX + mouseRadius * 0.7;
//     const mouseLabelY = mouseY - mouseRadius * 0.7;
//     ctx.strokeText(`mouse: ${mouseRadius.toFixed(1)}`, mouseLabelX, mouseLabelY);
//     ctx.fillText(`mouse: ${mouseRadius.toFixed(1)}`, mouseLabelX, mouseLabelY);
// }

// /**
//  * Draws the wire endpoints to indicate they're draggable
//  */
// function drawWireEndpoints() {
//     const wireCount = world.wire_count();
//     const clickRadius = 15;
    
//     for (let i = 0; i < wireCount; i++) {
//         const nodeCount = world.get_wire_node_count(i);
//         if (nodeCount < 2) continue;
        
//         // Get start and end positions
//         const startX = world.get_wire_node_x(i, 0);
//         const startY = world.get_wire_node_y(i, 0);
//         const endX = world.get_wire_node_x(i, nodeCount - 1);
//         const endY = world.get_wire_node_y(i, nodeCount - 1);
        
//         // Check if mouse is hovering over endpoints
//         const distStart = Math.sqrt((mouseX - startX) ** 2 + (mouseY - startY) ** 2);
//         const distEnd = Math.sqrt((mouseX - endX) ** 2 + (mouseY - endY) ** 2);
//         const hoveringStart = distStart < clickRadius;
//         const hoveringEnd = distEnd < clickRadius;
        
//         // Draw start endpoint
//         ctx.beginPath();
//         ctx.arc(startX, startY, 8, 0, Math.PI * 2);
//         if (isDragging && draggedWire === i && draggedEndpoint === 'start') {
//             ctx.fillStyle = '#00ff00'; // Green when dragging
//         } else if (hoveringStart) {
//             ctx.fillStyle = '#ffff00'; // Yellow when hovering
//         } else {
//             ctx.fillStyle = '#ff4444'; // Red normally
//         }
//         ctx.fill();
//         ctx.strokeStyle = '#ffffff';
//         ctx.lineWidth = 2;
//         ctx.stroke();
        
//         // Draw end endpoint
//         ctx.beginPath();
//         ctx.arc(endX, endY, 8, 0, Math.PI * 2);
//         if (isDragging && draggedWire === i && draggedEndpoint === 'end') {
//             ctx.fillStyle = '#00ff00'; // Green when dragging
//         } else if (hoveringEnd) {
//             ctx.fillStyle = '#ffff00'; // Yellow when hovering
//         } else {
//             ctx.fillStyle = '#ff4444'; // Red normally
//         }
//         ctx.fill();
//         ctx.strokeStyle = '#ffffff';
//         ctx.lineWidth = 2;
//         ctx.stroke();
//     }
    
//     // Update cursor style based on hover
//     const wireCount2 = world.wire_count();
//     let hovering = false;
    
//     if (!isDragging) {
//         for (let i = 0; i < wireCount2; i++) {
//             const nodeCount = world.get_wire_node_count(i);
//             if (nodeCount < 2) continue;
            
//             const startX = world.get_wire_node_x(i, 0);
//             const startY = world.get_wire_node_y(i, 0);
//             const endX = world.get_wire_node_x(i, nodeCount - 1);
//             const endY = world.get_wire_node_y(i, nodeCount - 1);
            
//             const distStart = Math.sqrt((mouseX - startX) ** 2 + (mouseY - startY) ** 2);
//             const distEnd = Math.sqrt((mouseX - endX) ** 2 + (mouseY - endY) ** 2);
            
//             if (distStart < clickRadius || distEnd < clickRadius) {
//                 hovering = true;
//                 break;
//             }
//         }
        
//         canvas.style.cursor = hovering ? 'grab' : 'default';
//     }
// }

// /**
//  * Add a random wire to the world
//  */
// function addRandomWire() {
//     const x1 = Math.random() * (canvas.width - 200) + 100;
//     const y1 = Math.random() * (canvas.height - 200) + 100;
//     const x2 = Math.random() * (canvas.width - 200) + 100;
//     const y2 = Math.random() * (canvas.height - 200) + 100;
//     const nodeCount = Math.floor(Math.random() * 30) + 10;
//     const radius = Math.random() * 8 + 3;
//     const renderType = Math.random() > 0.5 ? 1 : 0;
    
//     world.add_wire_with_count(x1, y1, x2, y2, nodeCount, 10, radius, renderType);
// }

// /**
//  * Clear all wires from the world
//  */
// function clearWires() {
//     world = new World();
// }

// /**
//  * Update the debug info panel with current stats
//  */
// function updateDebugInfo() {
//     const ptr = world.wire_data_ptr();
//     const len = world.wire_data_len();
//     const wireCount = world.wire_count();
    
//     // Update basic stats
//     (document.getElementById('fps') as HTMLElement).textContent = fps.toString();
//     (document.getElementById('wireCount') as HTMLElement).textContent = wireCount.toString();
//     (document.getElementById('dataPoints') as HTMLElement).textContent = len.toString();
//     (document.getElementById('bufferSize') as HTMLElement).textContent = (len * 4).toLocaleString();
    
//     // Update mouse position
//     if (mouseX >= 0 && mouseY >= 0 && mouseX <= canvas.width && mouseY <= canvas.height) {
//         (document.getElementById('mouseX') as HTMLElement).textContent = mouseX.toFixed(0);
//         (document.getElementById('mouseY') as HTMLElement).textContent = mouseY.toFixed(0);
//     } else {
//         (document.getElementById('mouseX') as HTMLElement).textContent = '-';
//         (document.getElementById('mouseY') as HTMLElement).textContent = '-';
//     }
    
//     // Update wire details
//     const wireData = len > 0 ? new Float32Array(wasm.memory.buffer, ptr, len) : null;
//     let detailsHTML = '';
    
//     if (wireData && wireCount > 0) {
//         let offset = 0;
//         for (let i = 0; i < wireCount; i++) {
//             const nodeCount = wireData[offset++];
//             const radius = wireData[offset++];
//             const renderType = wireData[offset++];
//             const pathLength = wireData[offset++];
//             offset += pathLength;
            
//             const renderTypeStr = renderType === 0 ? 'segments' : 'bezier';
//             detailsHTML += `<div class="wire-info">Wire ${i}: ${nodeCount} nodes, r=${radius.toFixed(1)}, ${pathLength} pts (${renderTypeStr})</div>`;
//         }
//     } else {
//         detailsHTML = '<div class="wire-info" style="color: #666;">No wires</div>';
//     }
    
//     (document.getElementById('wireDetails') as HTMLElement).innerHTML = detailsHTML;
// }

