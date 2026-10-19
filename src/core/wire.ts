import type { WireMeta } from './types';
import type { WasmWorld } from 'cavi';
import type { World } from './world';
import { Node } from './node';

/** Where Wire.growTo places the nodes it inserts. */
export type NodeSpawn = 'interpolate' | 'stack';

/** See nodeCountForDistance. */
export interface NodeCountOptions {
  /** Nodes of a cable spanning no distance (default 4). */
  min?: number;
  /** Nodes added per world unit of distance (default 1/30). */
  perUnit?: number;
  /** Most nodes, however far (default 60). */
  max?: number;
}

/**
 * How many nodes a cable reaching `distance` world units should have — the
 * rule a cable pulled out of a jack grows by (see Jack.updateCableSession),
 * for any code sizing cables the same way: `min + floor(distance ×
 * perUnit)`, at most `max`. Pair it with Wire.growTo/shrinkTo.
 */
export function nodeCountForDistance(distance: number, options: NodeCountOptions = {}): number {
  const { min = 4, perUnit = 1 / 30, max = 60 } = options;
  const count = min + Math.floor(Math.max(0, distance) * perUnit);
  return Math.min(max, Math.max(min, count));
}

/**
 * Wire is the TypeScript wrapper for the WASM Wire class.
 * It contains methods to change properties like radius and tension,
 * and a meta dictionary that allows extending with render information.
 */
export class Wire {
  private meta: WireMeta = {};
  private world: WasmWorld | null = null;
  private wireIndex: number = -1;
  /**
   * The Node handles getNode() has handed out, by node index (a sparse
   * array: only nodes someone asked for). Kept in step with every node
   * insertion/removal made through this Wire, so a handle keeps pointing at
   * the same node — e.g. a Plug stays on its cable's terminal when nodes are
   * inserted before it — the way World keeps Wire handles valid.
   */
  private nodes: (Node | undefined)[] = [];

  /** The World that created this wire (see delete). */
  private owner: World | null = null;

  constructor(world?: WasmWorld, wireIndex?: number, owner?: World) {
    if (world !== undefined && wireIndex !== undefined) {
      this.world = world;
      this.wireIndex = wireIndex;
    }
    this.owner = owner ?? null;
  }

  /**
   * Deletes this wire from its world (World.deleteWire), without having to
   * know its current index. No-op once deleted.
   */
  public delete(): void {
    if (this.wireIndex >= 0) this.owner?.deleteWire(this);
  }

  /**
   * Add a node to the wire at the specified position
   */
  public addNode(x: number, y: number, fixed: boolean = false): void {
    if (this.world && this.wireIndex >= 0) {
      // Appended after every existing node: no handle moves.
      this.world.add_wire_node(this.wireIndex, x, y, fixed);
    }
  }

  /**
   * Add a node at a specific index in the wire
   */
  public addNodeAt(index: number, x: number, y: number, fixed: boolean = false): void {
    if (!this.world || this.wireIndex < 0) return;
    // Same bounds as the engine, which ignores an index past the end.
    if (index < 0 || index > this.getNodeCount()) return;
    this.world.add_wire_node_at(this.wireIndex, index, x, y, fixed);
    if (index < this.nodes.length) {
      this.nodes.splice(index, 0, undefined);
      this._reindexNodes(index + 1);
    }
  }

  /**
   * Remove a node at the specified index. Returns false (and changes
   * nothing) if that would leave fewer than 2 nodes or the index is out of
   * range. A handle to the removed node is invalidated.
   */
  public removeNode(index: number): boolean {
    if (!this.world || this.wireIndex < 0) return false;
    if (!this.world.remove_wire_node(this.wireIndex, index)) return false;
    const [removed] = this.nodes.splice(index, 1);
    removed?._setIndex(-1);
    this._reindexNodes(index);
    return true;
  }

  /**
   * Get the number of nodes in this wire
   */
  public getNodeCount(): number {
    if (this.world && this.wireIndex >= 0) {
      return this.world.get_wire_node_count(this.wireIndex);
    }
    return 0;
  }

  /**
   * Resize the wire to a new node count, redistributing intermediate nodes
   * evenly between the two terminal nodes (whose position/fixed state is
   * preserved). Any custom state on previously-existing intermediate nodes
   * is discarded — this rebuilds the node vector from scratch.
   */
  public setNodeCount(count: number): void {
    if (!this.world || this.wireIndex < 0) return;
    const current = this.getNodeCount();
    // Same no-op cases as the engine's set_node_count.
    if (count < 2 || count === current) return;
    this.world.set_wire_node_count(this.wireIndex, count);
    // The terminals survive (handles to them stay valid, the last one moving
    // to the new last index); every intermediate node is new.
    const first = this.nodes[0];
    const last = current > 1 ? this.nodes[current - 1] : undefined;
    for (let i = 1; i < current - 1; i++) this.nodes[i]?._setIndex(-1);
    this.nodes = [first];
    if (last) {
      this.nodes[count - 1] = last;
      last._setIndex(count - 1);
    }
  }

  /**
   * Grows the wire to `count` nodes by inserting the missing ones, one at a
   * time, right before its last node. Unlike setNodeCount, every node
   * already there keeps its live physics state — a cable growing while it
   * is pulled doesn't snap straight — and handles to them stay valid, the
   * last node's following it to the new last index. Where new nodes start:
   * - 'interpolate' (default): evenly on the straight line from the node
   *   before the last to the last — smooth at once;
   * - 'stack': on top of the node before the last, left for the
   *   constraint solver to spread out over the next steps.
   *
   * No-op if the wire already has `count` nodes or more, or fewer than 2.
   */
  public growTo(count: number, spawn: NodeSpawn = 'interpolate'): void {
    let current = this.getNodeCount();
    const missing = Math.round(count) - current;
    if (missing <= 0 || current < 2) return;
    const ax = this.getNodeX(current - 2);
    const ay = this.getNodeY(current - 2);
    const bx = this.getNodeX(current - 1);
    const by = this.getNodeY(current - 1);
    for (let i = 1; i <= missing; i++) {
      const t = spawn === 'stack' ? 0 : i / (missing + 1);
      this.addNodeAt(current - 1, ax + (bx - ax) * t, ay + (by - ay) * t, false);
      current++;
    }
  }

  /**
   * Shrinks the wire to `count` nodes (2 at least) by removing the ones
   * right before its last node — the counterpart of growTo: the remaining
   * nodes keep their physics state, and the last node's handle follows it.
   * The cable then pulls itself in over the next steps. No-op if the wire
   * has `count` nodes or fewer.
   */
  public shrinkTo(count: number): void {
    const target = Math.max(2, Math.round(count));
    let current = this.getNodeCount();
    while (current > target && this.removeNode(current - 2)) current--;
  }

  /**
   * A node's current x, read straight from WASM — unlike getNode(), no
   * wrapper is allocated, for code that reads positions every frame.
   * 0 for an index out of range.
   */
  public getNodeX(index: number): number {
    return this.world && this.wireIndex >= 0
      ? this.world.get_wire_node_x(this.wireIndex, index)
      : 0;
  }

  /** A node's current y — see getNodeX. */
  public getNodeY(index: number): number {
    return this.world && this.wireIndex >= 0
      ? this.world.get_wire_node_y(this.wireIndex, index)
      : 0;
  }

  /**
   * Get a node at a specific index. The returned Node is a live view: it
   * reads and writes the WASM node through this Wire (so it follows this
   * wire's index if an earlier wire is deleted) rather than holding a copy.
   * Always the same handle for the same node, and it follows its node when
   * nodes are inserted or removed before it through this Wire (addNodeAt,
   * removeNode, setNodeCount) — so it is the node, not the index, that a
   * Plug is bound to.
   */
  public getNode(index: number): Node | null {
    if (!this.world || this.wireIndex < 0) return null;
    if (index < 0 || index >= this.world.get_wire_node_count(this.wireIndex)) return null;
    let node = this.nodes[index];
    if (!node) {
      node = new Node(
        this.world.get_wire_node_x(this.wireIndex, index),
        this.world.get_wire_node_y(this.wireIndex, index),
        false,
        undefined,
        this.world,
        this,
        index
      );
      this.nodes[index] = node;
    }
    return node;
  }

  /** Tells every handle from `from` on its (shifted) index. */
  private _reindexNodes(from: number): void {
    for (let i = from; i < this.nodes.length; i++) this.nodes[i]?._setIndex(i);
  }

  /**
   * Set custom metadata for the wire (e.g., render information)
   */
  public setMetaData(key: string, value: any): void {
    this.meta[key] = value;
  }

  /**
   * Get custom metadata from the wire
   */
  public getMetaData(key: string): any {
    return this.meta[key];
  }

  /**
   * Get all metadata
   */
  public getAllMetaData(): WireMeta {
    return { ...this.meta };
  }

  /**
   * Convenience method to set the render color
   */
  public setColor(color: string): void {
    this.meta.color = color;
  }

  /**
   * Get the render color
   */
  public getColor(): string | undefined {
    return this.meta.color;
  }

  /**
   * Change the radius (thickness) of the wire. Does not change the distance
   * between its nodes — see setLinkDistance.
   */
  public setRadius(radius: number): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.set_wire_radius(this.wireIndex, radius);
    }
  }

  /**
   * Rest distance between neighbouring nodes (the `tension` given at
   * creation): shorter makes a tauter cable for the same node count.
   */
  public setLinkDistance(distance: number): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.set_wire_link_distance(this.wireIndex, distance);
    }
  }

  public getLinkDistance(): number {
    if (this.world && this.wireIndex >= 0) {
      return this.world.get_wire_link_distance(this.wireIndex);
    }
    return 0;
  }

  /** How the wire is drawn: 0 = straight segments, 1 = bezier curve. */
  public setRenderType(renderType: number): void {
    if (this.world && this.wireIndex >= 0) {
      this.world.set_wire_render_type(this.wireIndex, renderType);
    }
  }

  public getRenderType(): number {
    return this.world && this.wireIndex >= 0 ? this.world.get_wire_render_type(this.wireIndex) : 1;
  }

  /** Whether the engine put this wire to sleep (see World.setSleepEnabled). */
  public isSleeping(): boolean {
    return this.world && this.wireIndex >= 0 ? this.world.is_wire_sleeping(this.wireIndex) : false;
  }

  /**
   * Get the current radius of the wire
   */
  public getRadius(): number {
    if (this.world && this.wireIndex >= 0) {
      return this.world.get_wire_radius(this.wireIndex);
    }
    return 0;
  }

  /**
   * Get the wire index in the world. -1 once the wire has been deleted.
   */
  public getIndex(): number {
    return this.wireIndex;
  }

  /**
   * Internal: called by World.deleteWire() to keep this handle pointing at
   * the right WASM wire after an earlier deletion shifts every later index
   * down by one (or to -1 once this wire itself is deleted, turning every
   * method into a no-op instead of silently hitting whichever wire now
   * occupies the old index). Updating the index in place — rather than
   * handing out a fresh wrapper — keeps every reference already held
   * elsewhere (CaviWireElement, a CableSession, each Plug's Node) valid.
   */
  public _setIndex(index: number): void {
    this.wireIndex = index;
  }
}
