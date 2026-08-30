import type { World } from "../core/world";
import type { Cavi } from "../core/cavi";

/**
 * CaviControls is a web component that provides a GUI for controlling
 * the Cavi simulation. It's scrollable and can be easily instantiated in HTML.
 */
export class CaviControls extends HTMLElement {
    private cavi: Cavi | null = null;
    private world: World | null = null;
    private statsUpdateInterval: number | null = null;
    public shadowRoot: ShadowRoot;

    constructor() {
        super();
        this.shadowRoot = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
    }

    /**
     * Set the Cavi instance
     */
    public setCavi(cavi: Cavi): void {
        this.cavi = cavi;
        this.world = cavi.getWorld();
        this.setupEventListeners();
        this.startStatsUpdate();
    }

    /**
     * Start updating stats
     */
    private startStatsUpdate(): void {
        // Update stats every 100ms
        this.statsUpdateInterval = window.setInterval(() => {
            this.updateStats();
        }, 100);
    }

    /**
     * Update statistics display
     */
    private updateStats(): void {
        if (!this.world || !this.cavi) return;

        const renderer = this.cavi.getRenderer() as any;
        const wasmWorld = this.world.getWasmWorld();
        
        // Update FPS
        const fpsDisplay = this.shadowRoot.getElementById('fpsValue');
        if (fpsDisplay && renderer && typeof renderer.getFPS === 'function') {
            fpsDisplay.textContent = renderer.getFPS().toString();
        }

        // Update wire count
        const wireCountDisplay = this.shadowRoot.getElementById('wireCountValue');
        if (wireCountDisplay) {
            wireCountDisplay.textContent = wasmWorld.wire_count().toString();
        }

        // Update total points
        const totalPointsDisplay = this.shadowRoot.getElementById('totalPointsValue');
        if (totalPointsDisplay) {
            let totalPoints = 0;
            const wireCount = wasmWorld.wire_count();
            for (let i = 0; i < wireCount; i++) {
                totalPoints += wasmWorld.get_wire_node_count(i);
            }
            totalPointsDisplay.textContent = totalPoints.toString();
        }

        // Update buffer size
        const bufferSizeDisplay = this.shadowRoot.getElementById('bufferSizeValue');
        if (bufferSizeDisplay) {
            const bufferLen = wasmWorld.wire_data_len();
            const bufferSizeKB = (bufferLen * 4 / 1024).toFixed(2); // Float32 = 4 bytes
            bufferSizeDisplay.textContent = `${bufferSizeKB}KB`;
        }

        // Update mouse position
        const mouseXDisplay = this.shadowRoot.getElementById('mouseXValue');
        const mouseYDisplay = this.shadowRoot.getElementById('mouseYValue');
        if (renderer && mouseXDisplay && mouseYDisplay) {
            if (renderer.mouseX !== undefined && renderer.mouseY !== undefined) {
                mouseXDisplay.textContent = Math.round(renderer.mouseX).toString();
                mouseYDisplay.textContent = Math.round(renderer.mouseY).toString();
            }
        }

        // Update acceleration values
        const accel = wasmWorld.get_acceleration();
        const accelXDisplay = this.shadowRoot.getElementById('accelXValue');
        const accelYDisplay = this.shadowRoot.getElementById('accelYValue');
        if (accelXDisplay) accelXDisplay.textContent = accel.x.toFixed(1);
        if (accelYDisplay) accelYDisplay.textContent = accel.y.toFixed(1);
    }

    /**
     * Clean up when element is removed
     */
    disconnectedCallback(): void {
        if (this.statsUpdateInterval !== null) {
            window.clearInterval(this.statsUpdateInterval);
        }
    }

    /**
     * Render the component
     */
    private render(): void {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    background: #2a2a2a;
                    border-radius: 8px;
                    border: 2px solid #444;
                    min-width: 280px;
                    max-width: 320px;
                    max-height: 80vh;
                    overflow-y: auto;
                    overflow-x: hidden;
                }

                /* Scrollbar styles */
                :host::-webkit-scrollbar {
                    width: 8px;
                }

                :host::-webkit-scrollbar-track {
                    background: #1a1a1a;
                    border-radius: 4px;
                }

                :host::-webkit-scrollbar-thumb {
                    background: #4A90E2;
                    border-radius: 4px;
                }

                :host::-webkit-scrollbar-thumb:hover {
                    background: #357ABD;
                }

                .controls-container {
                    padding: 20px;
                }

                h2 {
                    margin-top: 0;
                    color: #4A90E2;
                    font-size: 18px;
                    border-bottom: 1px solid #444;
                    padding-bottom: 10px;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }

                .control-group {
                    margin-bottom: 20px;
                }

                .control-group label {
                    display: block;
                    margin-bottom: 5px;
                    font-size: 13px;
                    color: #aaa;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }

                .value-display {
                    float: right;
                    color: #4A90E2;
                    font-weight: bold;
                }

                input[type="range"] {
                    width: 100%;
                    height: 6px;
                    border-radius: 3px;
                    background: #444;
                    outline: none;
                    -webkit-appearance: none;
                }

                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #4A90E2;
                    cursor: pointer;
                }

                input[type="range"]::-moz-range-thumb {
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background: #4A90E2;
                    cursor: pointer;
                    border: none;
                }

                input[type="number"] {
                    width: 100%;
                    padding: 6px;
                    font-size: 14px;
                    border-radius: 4px;
                    border: 1px solid #444;
                    background: #1a1a1a;
                    color: white;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    box-sizing: border-box;
                }

                .section {
                    margin-top: 20px;
                    padding-top: 15px;
                    border-top: 1px solid #444;
                }

                .section:first-child {
                    margin-top: 0;
                    padding-top: 0;
                    border-top: none;
                }

                h3 {
                    color: #4A90E2;
                    font-size: 14px;
                    margin-bottom: 10px;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    margin-top: 0;
                }

                button {
                    background: #4A90E2;
                    color: white;
                    border: none;
                    padding: 10px 15px;
                    margin: 5px 0;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: bold;
                    width: 100%;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }

                button:hover {
                    background: #357ABD;
                }

                button.danger {
                    background: #e74c3c;
                }

                button.danger:hover {
                    background: #c0392b;
                }

                button.success {
                    background: #27ae60;
                }

                button.success:hover {
                    background: #229954;
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    background: #1a1a1a;
                    padding: 12px;
                    border-radius: 6px;
                    border: 1px solid #333;
                }

                .stat-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 8px;
                    background: #2a2a2a;
                    border-radius: 4px;
                }

                .stat-label {
                    font-size: 12px;
                    color: #888;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }

                .stat-value {
                    font-size: 14px;
                    font-weight: bold;
                    color: #4A90E2;
                    font-family: 'Courier New', monospace;
                }
            </style>

            <div class="controls-container">
                <h2>🎛️ World Configuration</h2>
                
                <div class="section">
                    <h3>📊 Statistics</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">FPS:</span>
                            <span class="stat-value" id="fpsValue">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Wires:</span>
                            <span class="stat-value" id="wireCountValue">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Total Points:</span>
                            <span class="stat-value" id="totalPointsValue">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Buffer Size:</span>
                            <span class="stat-value" id="bufferSizeValue">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Mouse X:</span>
                            <span class="stat-value" id="mouseXValue">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Mouse Y:</span>
                            <span class="stat-value" id="mouseYValue">0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Accel X:</span>
                            <span class="stat-value" id="accelXValue">0.0</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">Accel Y:</span>
                            <span class="stat-value" id="accelYValue">0.0</span>
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <div class="control-group">
                        <label>
                            Mouse Radius
                            <span class="value-display" id="mouseRadiusValue">40.0</span>
                        </label>
                        <input type="range" id="mouseRadius" min="10" max="100" step="1" value="40">
                    </div>
                    
                    <div class="control-group">
                        <label>
                            Pointer Radius
                            <span class="value-display" id="pointerRadiusValue">20.0</span>
                        </label>
                        <input type="range" id="pointerRadius" min="5" max="50" step="1" value="20">
                    </div>
                </div>
                
                <div class="section">
                    <div class="control-group">
                        <label>
                            Response Coefficient
                            <span class="value-display" id="responseCoefValue">0.0</span>
                        </label>
                        <input type="range" id="responseCoef" min="0" max="2" step="0.05" value="0">
                    </div>
                    
                    <div class="control-group">
                        <label>
                            Friction
                            <span class="value-display" id="frictionValue">0.95</span>
                        </label>
                        <input type="range" id="friction" min="0.5" max="1" step="0.01" value="0.95">
                    </div>
                </div>
                
                <div class="section">
                    <div class="control-group">
                        <label>
                            Acceleration X
                            <span class="value-display" id="accelerationXValue">0.0</span>
                        </label>
                        <input type="range" id="accelerationX" min="-20" max="20" step="0.5" value="0">
                    </div>
                    
                    <div class="control-group">
                        <label>
                            Acceleration Y
                            <span class="value-display" id="accelerationYValue">10.0</span>
                        </label>
                        <input type="range" id="accelerationY" min="-20" max="20" step="0.5" value="10">
                    </div>
                </div>
                
                <div class="section">
                    <h3>Node Count</h3>
                    
                    <div class="control-group">
                        <label>
                            Wire 0
                            <span class="value-display" id="nodeCount0Value">30</span>
                        </label>
                        <input type="range" id="nodeCount0" min="2" max="100" step="1" value="30">
                    </div>
                    
                    <div class="control-group">
                        <label>
                            Wire 1
                            <span class="value-display" id="nodeCount1Value">25</span>
                        </label>
                        <input type="range" id="nodeCount1" min="2" max="100" step="1" value="25">
                    </div>
                    
                    <div class="control-group">
                        <label>
                            Wire 2
                            <span class="value-display" id="nodeCount2Value">20</span>
                        </label>
                        <input type="range" id="nodeCount2" min="2" max="100" step="1" value="20">
                    </div>
                    
                    <button id="calculateDefault">Calculate Defaults</button>
                </div>
                
                <div class="section">
                    <h3>Actions</h3>
                    <button id="addWireBtn">Add Random Wire</button>
                    <button id="clearBtn" class="danger">Clear All Wires</button>
                </div>
                
                <div class="section">
                    <h3>Add Node to Wire</h3>
                    <div class="control-group">
                        <label>Wire Index</label>
                        <input type="number" id="addNodeWireIndex" min="0" value="0" step="1">
                    </div>
                    <div class="control-group">
                        <label>Node Position</label>
                        <input type="number" id="addNodePosition" min="0" value="1" step="1">
                    </div>
                    <button id="addNodeBtn" class="success">Add Node</button>
                </div>
            </div>
        `;
    }

    /**
     * Setup event listeners for all controls
     */
    private setupEventListeners(): void {
        if (!this.world || !this.cavi) return;

        const wasmWorld = this.world.getWasmWorld();

        // Mouse Radius
        this.setupRangeControl('mouseRadius', 'mouseRadiusValue', (value) => {
            wasmWorld.set_mouse_radius(value);
        });

        // Pointer Radius
        this.setupRangeControl('pointerRadius', 'pointerRadiusValue', (value) => {
            wasmWorld.set_pointer_radius(value);
        });

        // Response Coefficient
        this.setupRangeControl('responseCoef', 'responseCoefValue', (value) => {
            wasmWorld.set_response_coef(value);
        }, 2);

        // Friction
        this.setupRangeControl('friction', 'frictionValue', (value) => {
            wasmWorld.set_friction(value);
        }, 2);

        // Acceleration X
        this.setupRangeControl('accelerationX', 'accelerationXValue', (value) => {
            const currentAccel = wasmWorld.get_acceleration();
            wasmWorld.set_acceleration(value, currentAccel.y);
        });

        // Acceleration Y
        this.setupRangeControl('accelerationY', 'accelerationYValue', (value) => {
            const currentAccel = wasmWorld.get_acceleration();
            wasmWorld.set_acceleration(currentAccel.x, value);
        });

        // Node Count Controls
        for (let i = 0; i < 3; i++) {
            this.setupRangeControl(`nodeCount${i}`, `nodeCount${i}Value`, (value) => {
                wasmWorld.set_wire_node_count(i, value);
            }, 0);
        }

        // Calculate Default Button
        const calculateDefaultBtn = this.shadowRoot.getElementById('calculateDefault');
        calculateDefaultBtn?.addEventListener('click', () => {
            const wireCount = wasmWorld.wire_count();
            
            for (let i = 0; i < Math.min(wireCount, 3); i++) {
                const nodeCount = wasmWorld.get_wire_node_count(i);
                const startX = wasmWorld.get_wire_node_x(i, 0);
                const startY = wasmWorld.get_wire_node_y(i, 0);
                const endX = wasmWorld.get_wire_node_x(i, nodeCount - 1);
                const endY = wasmWorld.get_wire_node_y(i, nodeCount - 1);
                
                const defaultCount = this.calculateOptimalLength(startX, startY, endX, endY, 10.0);
                
                // Apply default
                wasmWorld.set_wire_node_count(i, defaultCount);
                
                // Update UI
                const slider = this.shadowRoot.getElementById(`nodeCount${i}`) as HTMLInputElement;
                const valueDisplay = this.shadowRoot.getElementById(`nodeCount${i}Value`);
                if (slider && valueDisplay) {
                    slider.value = defaultCount.toString();
                    valueDisplay.textContent = defaultCount.toString();
                }
            }
        });

        // Add Wire Button
        const addWireBtn = this.shadowRoot.getElementById('addWireBtn');
        addWireBtn?.addEventListener('click', () => {
            // Get canvas dimensions (assuming 1000x600 default)
            const canvasWidth = 1000;
            const canvasHeight = 600;
            
            const x1 = Math.random() * (canvasWidth - 200) + 100;
            const y1 = Math.random() * (canvasHeight - 200) + 100;
            const x2 = Math.random() * (canvasWidth - 200) + 100;
            const y2 = Math.random() * (canvasHeight - 200) + 100;
            const nodeCount = Math.floor(Math.random() * 30) + 10;
            const radius = Math.random() * 8 + 3;
            const renderType = Math.random() > 0.5 ? 1 : 0;
            
            this.cavi!.addWire(x1, y1, x2, y2, nodeCount, 10, radius, renderType);
        });

        // Clear Button
        const clearBtn = this.shadowRoot.getElementById('clearBtn');
        clearBtn?.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all wires?')) {
                this.cavi!.clearAllWires();
            }
        });

        // Add Node Button
        const addNodeBtn = this.shadowRoot.getElementById('addNodeBtn');
        const addNodeWireIndexInput = this.shadowRoot.getElementById('addNodeWireIndex') as HTMLInputElement;
        const addNodePositionInput = this.shadowRoot.getElementById('addNodePosition') as HTMLInputElement;

        addNodeBtn?.addEventListener('click', () => {
            const wireIndex = parseInt(addNodeWireIndexInput.value);
            const nodePosition = parseInt(addNodePositionInput.value);
            
            // Validate wire index
            const wire = this.cavi!.getWireByIndex(wireIndex);
            if (!wire) {
                alert(`Wire ${wireIndex} does not exist. Please select a valid wire index (0-${wasmWorld.wire_count() - 1}).`);
                return;
            }
            
            // Get node count for validation
            const nodeCount = wire.getNodeCount();
            if (nodePosition < 0 || nodePosition >= nodeCount) {
                alert(`Invalid node position. Must be between 0 and ${nodeCount - 1}.`);
                return;
            }
            
            // Get the current position of the node at the specified index
            const x = wasmWorld.get_wire_node_x(wireIndex, nodePosition);
            const y = wasmWorld.get_wire_node_y(wireIndex, nodePosition);
            
            // Add the new node at this position
            wire.addNodeAt(nodePosition, x, y, false);
            
            console.log(`Added node to wire ${wireIndex} at position ${nodePosition} (${x.toFixed(2)}, ${y.toFixed(2)})`);
            
        });
    }

    /**
     * Helper method to setup range controls
     */
    private setupRangeControl(
        sliderId: string,
        valueId: string,
        onChange: (value: number) => void,
        decimals: number = 1
    ): void {
        const slider = this.shadowRoot.getElementById(sliderId) as HTMLInputElement;
        const valueDisplay = this.shadowRoot.getElementById(valueId);

        if (slider && valueDisplay) {
            slider.addEventListener('input', (e) => {
                const value = parseFloat((e.target as HTMLInputElement).value);
                onChange(value);
                valueDisplay.textContent = value.toFixed(decimals);
            });
        }
    }

    /**
     * Calculate optimal wire length
     */
    private calculateOptimalLength(x1: number, y1: number, x2: number, y2: number, tension: number): number {
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        return Math.max(2, Math.floor(distance / tension));
    }
}

// Register the custom element
customElements.define('cavi-controls', CaviControls);
