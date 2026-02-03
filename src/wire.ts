import type { WireMeta } from "./types";

export class Wire {
    private meta: WireMeta = {};
    private nodes: any[] = [];
    private radius: number = 1;

    public addNode(node: any): void {
        this.nodes.push(node);
    }

    public removeNode(index: number): void {
        if (index >= 0 && index < this.nodes.length) {
            this.nodes.splice(index, 1);
        }
    }

    public setMetaData(key: string, value: any): void {
        this.meta[key] = value;
    }

    public getMetaData(key: string): any {
        return this.meta[key];
    }

    public setColor(color: string): void {
        this.meta.color = color;
    }

    public getColor(): string | undefined {
        return this.meta.color;
    }

    public setRadius(radius: number): void {
        this.radius = radius;
    }

    public getRadius(): number {
        return this.radius;
    }
}