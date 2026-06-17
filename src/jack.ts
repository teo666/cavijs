
/**
 * Jack represents a fixed connection point.
 * Plug elements can be dropped onto Jack elements.
 */
export class Jack extends HTMLElement {
    static get observedAttributes() {
        return ['color', 'x', 'y'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
        this.updatePosition();
    }

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (name === 'color') {
            this.render();
        }
        if (name === 'x' || name === 'y') {
            this.updatePosition();
        }
    }

    private updatePosition() {
        const x = this.getAttribute('x') || '0';
        const y = this.getAttribute('y') || '0';
        this.style.left = `${x}px`;
        this.style.top = `${y}px`;
    }

    private render() {
        const color = this.getAttribute('color') || '#333';
        // Basic default style
        const style = `
            :host {
                display: block;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background-color: ${color};
                border: 2px solid #555;
                position: absolute;
                box-sizing: border-box;
                z-index: 10; /* Jack under Plug */
                transform: translate(-50%, -50%); /* Centered on coordinates */
                pointer-events: none; /* Let clicks pass through if covered, but maybe we want it to be a drop target. */
            }
            .inner {
                width: 8px;
                height: 8px;
                background-color: #000;
                border-radius: 50%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }
        `;

        if (this.children.length > 0) {
            // If user provided content, just add style and slot
            this.shadowRoot!.innerHTML = `<style>${style}</style><slot></slot>`;
        } else {
            // Default appearance
             this.shadowRoot!.innerHTML = `
                <style>${style}</style>
                <div class="inner"></div>
             `;
        }
    }

    public getCenter(): { x: number, y: number } {
        const rect = this.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }
}

customElements.define('cavi-jack', Jack);
