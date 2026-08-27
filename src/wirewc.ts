import { Cavi } from './cavi';
import type { Wire } from './wire';
import type { Plug } from './plug';
import type { Jack } from './jack';
import './plug';

export class CaviWireElement extends HTMLElement {
  private _wire: Wire | null = null;
  private _plugs: Plug[] = [];
  private _rafId: number | null = null;

  static get observedAttributes() {
    return ['length', 'tension', 'size', 'renderType', 'color', 'type'];
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

  disconnectedCallback() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  private _setup(cavi: Cavi): void {
    const nodeCount = parseInt(this.getAttribute('length') ?? '10');
    const tension = parseFloat(this.getAttribute('tension') ?? '20');
    const radius = parseFloat(this.getAttribute('size') ?? '5');
    // Bezier by default; explicit renderType="segments" opts back into
    // straight-segment rendering.
    const renderType = this.getAttribute('renderType') === 'segments' ? 0 : 1;
    const color = this.getAttribute('color') ?? '#ffffff';
    const type = this.getAttribute('type') ?? '';

    const plugEls = Array.from(this.children).filter(
      (el) => el.tagName.toLowerCase() === 'cavi-plug'
    ) as HTMLElement[];

    // Only terminal nodes (first/last) are supported for now — plugs
    // bound to intermediate node indices are skipped with a warning.
    const validPlugs = plugEls.reduce<
      { plugEl: HTMLElement; nodeIdx: number; jackId: string | null }[]
    >((acc, plugEl) => {
      const nodeIdx = parseInt(plugEl.getAttribute('node') ?? '0');
      const isTerminal = nodeIdx === 0 || nodeIdx === nodeCount - 1;
      if (!isTerminal) {
        console.warn(
          `<cavi-wire>: <cavi-plug node="${nodeIdx}"> is not a terminal node ` +
            `(expected 0 or ${nodeCount - 1}); intermediate-node plugs are not ` +
            `supported yet and this plug will be ignored.`
        );
        return acc;
      }
      acc.push({ plugEl, nodeIdx, jackId: plugEl.getAttribute('jack') });
      return acc;
    }, []);

    // Determine wire start/end from jack-bound plugs
    let x1 = 100,
      y1 = 100,
      x2 = 300,
      y2 = 300;
    for (const { nodeIdx, jackId } of validPlugs) {
      if (!jackId) continue;
      const jack = document.getElementById(jackId);
      if (!jack) continue;
      const jx = parseFloat(jack.getAttribute('x') ?? '0');
      const jy = parseFloat(jack.getAttribute('y') ?? '0');
      if (nodeIdx === 0) {
        x1 = jx;
        y1 = jy;
      } else if (nodeIdx === nodeCount - 1) {
        x2 = jx;
        y2 = jy;
      }
    }

    const wire = cavi.addWire(x1, y1, x2, y2, nodeCount, tension, radius, renderType);
    wire.setColor(color);
    this._wire = wire;

    for (const { plugEl, nodeIdx, jackId } of validPlugs) {
      const node = wire.getNode(nodeIdx);
      if (!node) continue;

      const plug = plugEl as unknown as Plug;
      plug.setType(type);
      plug.setNode(node);
      this._plugs.push(plug);

      if (jackId) {
        const jackEl = document.getElementById(jackId) as unknown as Jack | null;
        if (jackEl) {
          const jx = parseFloat(jackEl.getAttribute('x') ?? '0');
          const jy = parseFloat(jackEl.getAttribute('y') ?? '0');
          node.setPosition(jx, jy);
          node.fixed = true;

          if (jackEl.type !== type) {
            console.warn(
              `<cavi-wire>: <cavi-plug node="${nodeIdx}"> (type="${type}") is ` +
                `declaratively wired to jack #${jackId} (type="${jackEl.type}") — ` +
                `types do not match.`
            );
          }

          plug.attach(jackEl);
          plugEl.setAttribute('plugged', 'true');
        }
      }
    }

    this._startUpdateLoop();
  }

  /**
   * Keeps each Plug's DOM position in sync with its physics node every
   * frame. Without this, a Plug dropped away from any Jack freezes at the
   * drop point while its underlying node keeps moving under gravity/tension
   * — visually detaching the plug icon from the wire it's still bound to.
   */
  private _startUpdateLoop(): void {
    const tick = () => {
      for (const plug of this._plugs) {
        plug.update();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  public getWire(): Wire | null {
    return this._wire;
  }
}

customElements.define('cavi-wire', CaviWireElement);
