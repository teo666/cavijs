import initSync, { Point, World ,type InitOutput} from "cavi";

import type { IRenderer } from "./types";
import { Renderer } from "./renderer";
import { Wire } from "./wire";

export class Cavi {

    static wasm: InitOutput;

    private world:World;
    private _renderer:IRenderer|null = null;
    private wasm: InitOutput | null = null;
    private wires: number[] = [];

    constructor() {
        this.world =  new World();
    }
    
    static initWasm():Promise<void> {
        return initSync().then((wasmModule) => {
          Cavi.wasm = wasmModule;
        });
    }

    public get getWorld():World {
        return this.world;
    }

    public get renderer():IRenderer|null {
        return this._renderer;
    }
    public set renderer(value:IRenderer|null) {
        this._renderer = value;
    }
    
    public init():Promise<void> {
        return initSync().then((wasmModule) => {
          this.wasm = wasmModule;
        });
    }

    public addWire(x1: number, y1: number, x2: number, y2: number, nodes: number, tension: number,radius: number, type: number): Wire {
        const w = new Wire();   
        this.world.add_wire_with_count(x1, y1, x2, y2, nodes, tension, radius, type);
        this.wires.push(this.wires.length);
        return w;
    }

    public deleteWire(index: number): void {
        if (index >= 0 && index < this.wires.length) {
            this.wires.splice(index, 1);
            // Note: WASM world wire deletion would need to be implemented
        }
    }

    public setAcceleration(x: number, y: number): void {
        this.world.set_acceleration(x, y);
    }

    public getAcceleration(): { x: number, y: number } {
        // Note: This would require WASM binding to return acceleration
        return { x: 0, y: 0 };
    }

    public getWireByIndex(index: number): Wire | null {
        if (index >= 0 && index < this.wires.length) {
            // Note: Would need to retrieve actual Wire instance from WASM
            return new Wire();
        }
        return null;
    }

}