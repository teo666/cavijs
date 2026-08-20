import { Cavi } from './cavi';
import type { Wire } from './wire';
import type { Plug } from './plug';
import './plug';

export class CaviWireElement extends HTMLElement {
    private _wire: Wire | null = null;

    static get observedAttributes() {
        return ['length', 'tension', 'size', 'renderType', 'color'];
    }

    connectedCallback() {
        // Transparent to layout — child plugs position relative to the container
        this.style.display = 'contents';

        if (Cavi.shared) {
            this._setup(Cavi.shared);
        } else {
            document.addEventListener(
                'caviready',
                (e: Event) => this._setup((e as CustomEvent<{ cavi: Cavi }>).detail.cavi),
                { once: true }
            );
        }
    }

    private _setup(cavi: Cavi): void {
        const nodeCount = parseInt(this.getAttribute('length') ?? '10');
        const tension = parseFloat(this.getAttribute('tension') ?? '20');
        const radius = parseFloat(this.getAttribute('size') ?? '5');
        const renderType = this.getAttribute('renderType') === 'bezier' ? 1 : 0;
        const color = this.getAttribute('color') ?? '#ffffff';

        const plugEls = Array.from(this.children).filter(
            el => el.tagName.toLowerCase() === 'cavi-plug'
        ) as HTMLElement[];

        // Determine wire start/end from jack-bound plugs
        let x1 = 100, y1 = 100, x2 = 300, y2 = 300;
        for (const plugEl of plugEls) {
            const nodeIdx = parseInt(plugEl.getAttribute('node') ?? '0');
            const jackId = plugEl.getAttribute('jack');
            if (!jackId) continue;
            const jack = document.getElementById(jackId);
            if (!jack) continue;
            const jx = parseFloat(jack.getAttribute('x') ?? '0');
            const jy = parseFloat(jack.getAttribute('y') ?? '0');
            if (nodeIdx === 0) { x1 = jx; y1 = jy; }
            else if (nodeIdx === nodeCount - 1) { x2 = jx; y2 = jy; }
        }

        const wire = cavi.addWire(x1, y1, x2, y2, nodeCount, tension, radius, renderType);
        wire.setColor(color);
        this._wire = wire;

        for (const plugEl of plugEls) {
            const nodeIdx = parseInt(plugEl.getAttribute('node') ?? '0');
            const jackId = plugEl.getAttribute('jack');
            const node = wire.getNode(nodeIdx);
            if (!node) continue;

            if (jackId) {
                const jack = document.getElementById(jackId);
                if (jack) {
                    const jx = parseFloat(jack.getAttribute('x') ?? '0');
                    const jy = parseFloat(jack.getAttribute('y') ?? '0');
                    node.setPosition(jx, jy);
                    node.fixed = true;
                    plugEl.setAttribute('plugged', 'true');
                }
            }

            (plugEl as unknown as Plug).setNode(node);
        }
    }

    public getWire(): Wire | null {
        return this._wire;
    }
}

customElements.define('cavi-wire', CaviWireElement);
