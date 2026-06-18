import { Node } from "./node";
import { Jack } from "./jack"; // Ensure Jack is imported if we check types

/**
 * Plug represents a movable terminal of a cable.
 * Can be dragged and snapped to Jack elements.
 */
export class Plug extends HTMLElement {
    private _node: Node | null = null;
    private _dragging: boolean = false;
    private _dragOffsetX: number = 0;
    private _dragOffsetY: number = 0;
    private _snapDistance: number = 20;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        
        // Bind methods
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
    }

    private _in: string[] = [];
    private _out: string[] = [];

    static get observedAttributes() {
        return ['plugged', 'in', 'out'];
    }

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (name === 'plugged') {
            this.render();
        }
        if (name === 'in') {
            this._in = newValue ? newValue.split(',').map(s => s.trim()) : [];
        }
        if (name === 'out') {
            this._out = newValue ? newValue.split(',').map(s => s.trim()) : [];
        }
    }

    connectedCallback() {
        this.render();
        this.addEventListener('mousedown', this.handleMouseDown);
    }

    disconnectedCallback() {
        this.removeEventListener('mousedown', this.handleMouseDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
    }

    public setNode(node: Node) {
        this._node = node;
        this.updatePosition();
    }

    public update() {
        if (!this._dragging) {
            this.updatePosition();
        }
    }

    private updatePosition() {
        if (this._node) {
            const x = this._node.x;
            const y = this._node.y;
            this.style.left = `${x}px`;
            this.style.top = `${y}px`;
        }
    }

    private handleMouseDown(e: MouseEvent) {
        if (!this._node) return;
        
        e.preventDefault();
        this._dragging = true;
        
        // Interaction usually fixes the node temporarily while dragging
        this._node.fixed = true;

        // Calculate offset if we want to drag from exact click point, 
        // but typically for plugs we drag the center. 
        // Let's assume the element is centered on the node.
        
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
        
        this.style.zIndex = '1000';
    }

    private handleMouseMove(e: MouseEvent) {
        if (!this._dragging || !this._node) return;

        // Calculate position relative to the offset parent (the container)
        const offsetParent = this.offsetParent || document.body;
        const parentRect = offsetParent.getBoundingClientRect();
        
        const x = e.clientX - parentRect.left;
        const y = e.clientY - parentRect.top;
        
        this._node.setPosition(x, y);
        //always update mouse position in the world for physics interaction with other nodes/wires
        this._node.setMousePosition(x, y);
        this.updatePosition(); 
    }

    private handleMouseUp(e: MouseEvent) {
        if (!this._dragging || !this._node) return;

        this._dragging = false;
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
        this.style.zIndex = '';

        // Check for drop on Jack
        //todo better iterate on world jacks instead of DOM query, but for now let's use DOM
        const jacks = document.querySelectorAll('cavi-jack');
        let snapped = false;

        const rect = this.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        for (let i = 0; i < jacks.length; i++) {
            const jack = jacks[i] as HTMLElement; 
            const jRect = jack.getBoundingClientRect();
            const jCenterX = jRect.left + jRect.width / 2;
            const jCenterY = jRect.top + jRect.height / 2;

            const dist = Math.sqrt(Math.pow(centerX - jCenterX, 2) + Math.pow(centerY - jCenterY, 2));
            
            if (dist < this._snapDistance && (jack as Jack).canAccept(this._in, this._out)) {
                // Snap!
                // Calculate position relative to offsetParent
                const offsetParent = this.offsetParent || document.body;
                const parentRect = offsetParent.getBoundingClientRect();
                
                const relativeX = jCenterX - parentRect.left;
                const relativeY = jCenterY - parentRect.top;

                this._node.setPosition(relativeX, relativeY);
                this._node.fixed = true;
                this.updatePosition();
                snapped = true;
                this.setAttribute('plugged', 'true');
                break;
            } else {
                this.removeAttribute('plugged');
            }
        }

        if (!snapped) {
            // Unfix the node so it falls or moves with physics
            this._node.fixed = true;
        }
    }

    private render() {
        const style = `
            :host {
                display: block;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background-color: #eee;
                border: 2px solid #333;
                position: absolute;
                box-sizing: border-box;
                z-index: 20; /* Over everything */
                transform: translate(-50%, -50%); /* Center on position */
                cursor: grab;
            }
            :host(:active) {
                cursor: grabbing;
                border-color: #007bff;
            }
            :host([plugged]) {
                background-color: #007bff;
                border-color: #0056b3;
            }
        `;
        
        if (this.children.length > 0) {
             this.shadowRoot!.innerHTML = `<style>${style}</style><slot></slot>`;
        } else {
             this.shadowRoot!.innerHTML = `<style>${style}</style>`;
        }
    }
}

customElements.define('cavi-plug', Plug);
