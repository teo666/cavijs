import type { Plug } from './plug';

/**
 * Jack represents a fixed connection point.
 * Plug elements can be dropped onto Jack elements.
 */
export class Jack extends HTMLElement {
  private static readonly _registry = new Set<Jack>();

  /**
   * All Jack elements currently connected to the document.
   */
  public static get registry(): ReadonlySet<Jack> {
    return Jack._registry;
  }

  private _type: string = '';
  private _magnetClass: string = 'cavi-magnet-target';
  private _plugs = new Set<Plug>();
  private _maxPlugs: number = Infinity;

  static get observedAttributes() {
    return ['color', 'x', 'y', 'type', 'max-plugs', 'magnet-class'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    Jack._registry.add(this);
    this.render();
    this.updatePosition();
  }

  disconnectedCallback() {
    Jack._registry.delete(this);
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === 'color') {
      this.render();
    }
    if (name === 'x' || name === 'y') {
      this.updatePosition();
    }
    if (name === 'type') {
      this._type = newValue ?? '';
    }
    if (name === 'max-plugs') {
      const n = newValue ? parseInt(newValue, 10) : NaN;
      this._maxPlugs = Number.isFinite(n) && n > 0 ? n : Infinity;
    }
    if (name === 'magnet-class') {
      this._magnetClass = newValue || 'cavi-magnet-target';
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

  public canAccept(type: string): boolean {
    return this._type !== '' && this._type === type;
  }

  public get type(): string {
    return this._type;
  }

  /**
   * Toggles the configurable "magnet" highlight class on this Jack's host
   * element, used to preview an in-range compatible connection during drag.
   */
  public setMagnetActive(active: boolean): void {
    this.classList.toggle(this._magnetClass, active);
  }

  /**
   * Whether this Jack can accept an additional Plug, based on `max-plugs`.
   */
  public canAcceptMore(): boolean {
    return this._plugs.size < this._maxPlugs;
  }

  /**
   * Registers a Plug as connected to this Jack.
   */
  public attach(plug: Plug): void {
    this._plugs.add(plug);
  }

  /**
   * Unregisters a Plug from this Jack.
   */
  public detach(plug: Plug): void {
    this._plugs.delete(plug);
  }

  public get plugCount(): number {
    return this._plugs.size;
  }

  public getCenter(): { x: number; y: number } {
    const rect = this.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }
}

customElements.define('cavi-jack', Jack);
