import type { Cavi } from '../core/cavi';
import { Jack } from './jack';
import { applyCables, captureCables, type CablesSnapshot } from './cables';

/**
 * One state of a CaviHistory: the page's own state (see
 * CaviHistoryOptions.app), undefined without one, and the cables.
 */
export interface HistoryEntry<A = undefined> {
  app: A;
  cables: CablesSnapshot;
}

export interface CaviHistoryOptions<A> {
  /**
   * The page's own state, recorded next to the cables in every entry —
   * whatever cavijs doesn't own and the cables depend on: jacks the user
   * adds and removes, the modules they sit in, where those are. `capture`
   * returns it as JSON-safe data (it is stored as JSON: a later change to
   * the object returned doesn't reach the history); `restore` puts it back,
   * jacks with the ids they had. On undo, redo and load, `restore` runs —
   * and is awaited — before the cables are put back, so they find their
   * jacks on the page.
   */
  app?: {
    capture: () => A;
    restore: (state: A) => void | Promise<void>;
  };
  /** Most undo steps kept (default 100); the oldest go first. */
  limit?: number;
}

const DEFAULT_LIMIT = 100;

/**
 * `entry` as the JSON a history stores and compares, its cables sorted by
 * id: their order in the page means nothing (a cable put back by
 * applyCables comes last), so it never makes two states differ.
 */
function toJSON<A>(entry: HistoryEntry<A>): string {
  const wires = [...entry.cables.wires].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ app: entry.app, cables: { ...entry.cables, wires } });
}

/**
 * Undo/redo for one world: a list of states (HistoryEntry), each the cables
 * as captureCables reads them plus, optionally, the page's own state.
 *
 * A state is recorded at the end of every user gesture on the cables (the
 * `cavi-change` event) and whenever the page calls commit() after a change
 * of its own — never twice the same: a gesture that changed nothing (a plug
 * put back where it was) records nothing. Undo and redo put a state back
 * with the page's `restore` first, then applyCables, which touches only
 * the cables that differ.
 *
 * Dispatches `change` (a plain Event) whenever what canUndo/canRedo report
 * may have changed. Create it once the world is ready (`caviready`): the
 * state at that moment is the first entry.
 */
export class CaviHistory<A = undefined> extends EventTarget {
  private readonly _cavi: Cavi;
  private readonly _app: CaviHistoryOptions<A>['app'] | null;
  private readonly _limit: number;
  /** Every entry as JSON: compared as is, and parsed into a fresh copy whenever handed out. */
  private _entries: string[];
  /** The entry the page is in. */
  private _index = 0;
  private _batchDepth = 0;
  /** Set while an entry is being put back: what it changes isn't a new step. */
  private _applying = false;
  /** Undo/redo/load calls, run one after the other. */
  private _queue: Promise<unknown> = Promise.resolve();
  private _container: HTMLElement | null;
  private _destroyed = false;

  constructor(cavi: Cavi, options: CaviHistoryOptions<A> = {}) {
    super();
    this._cavi = cavi;
    this._app = options.app ?? null;
    this._limit = Math.max(1, Math.round(options.limit ?? DEFAULT_LIMIT));
    this._entries = [this._read()];
    this._container = cavi.getContainer();
    this._container?.addEventListener('cavi-change', this._onChange);
  }

  /** Whether undo() has a state to go back to. */
  public get canUndo(): boolean {
    return this._index > 0;
  }

  /** Whether redo() has a state to go forward to. */
  public get canRedo(): boolean {
    return this._index < this._entries.length - 1;
  }

  /** The state on the page right now — e.g. to save it, and load() it later. */
  public capture(): HistoryEntry<A> {
    return JSON.parse(this._read());
  }

  /**
   * Records the state on the page as a new step, if it differs from the
   * last one — for a change the page made itself (a module added or
   * removed, jacks moved). Discards the steps undo() had walked back
   * from. Returns whether a step was recorded: never inside batch() or
   * while undo/redo/load put a state back.
   */
  public commit(): boolean {
    if (this._destroyed || this._batchDepth > 0 || this._applying) return false;
    const entry = this._read();
    if (entry === this._entries[this._index]) return false;
    this._entries.length = this._index + 1;
    this._entries.push(entry);
    if (this._entries.length > this._limit + 1) this._entries.shift();
    this._index = this._entries.length - 1;
    this._notify();
    return true;
  }

  /**
   * Runs `fn` and records what it changed as a single step: removing a
   * module, say, together with the cables it lets go. Steps that would
   * otherwise be recorded meanwhile (commit(), gestures ending) are folded
   * into it. For an `fn` returning a promise, the step is recorded once it
   * settles, and batch() returns a promise too.
   */
  public batch(fn: () => void): void;
  public batch(fn: () => Promise<void>): Promise<void>;
  public batch(fn: () => void | Promise<void>): void | Promise<void> {
    this._batchDepth++;
    let result: void | Promise<void>;
    try {
      result = fn();
    } catch (error) {
      this._batchDepth--;
      throw error;
    }
    if (!(result instanceof Promise)) {
      this._endBatch();
      return;
    }
    return result.finally(() => this._endBatch());
  }

  private _endBatch(): void {
    this._batchDepth--;
    if (this._batchDepth === 0) this.commit();
  }

  /**
   * Goes back one step. A change on the page not recorded yet is recorded
   * first, so it is what gets undone. Resolves to false — doing nothing —
   * with no step to go back to, or while a gesture is in progress in the
   * world (Jack.isDragActive): the controller owns that one, Escape cancels
   * it.
   */
  public undo(): Promise<boolean> {
    return this._enqueue(() => {
      if (!this._ready()) return null;
      this.commit();
      return this.canUndo ? this._index - 1 : null;
    });
  }

  /** Goes forward one step undo() went back from. Same rules as undo. */
  public redo(): Promise<boolean> {
    return this._enqueue(() => {
      if (!this._ready()) return null;
      // A change since the last undo starts a new branch: nothing to redo.
      this.commit();
      return this.canRedo ? this._index + 1 : null;
    });
  }

  /**
   * Puts back a state — one from capture(), saved earlier — and records it
   * as a new step, undoable like any other. Same rules as undo.
   */
  public load(entry: HistoryEntry<A>): Promise<boolean> {
    const json = toJSON(entry);
    return this._enqueue(() => {
      if (!this._ready()) return null;
      this.commit();
      this._entries.length = this._index + 1;
      this._entries.push(json);
      if (this._entries.length > this._limit + 1) {
        this._entries.shift();
        this._index--;
      }
      return this._entries.length - 1;
    });
  }

  /** Forgets every step: the state on the page becomes the only one. */
  public clear(): void {
    if (this._destroyed) return;
    this._entries = [this._read()];
    this._index = 0;
    this._notify();
  }

  /** Stops recording: the history no longer listens to its world. Idempotent. */
  public destroy(): void {
    this._destroyed = true;
    this._container?.removeEventListener('cavi-change', this._onChange);
    this._container = null;
  }

  /**
   * A gesture ended. Recorded a microtask later: the controller marks its
   * drag over right after the gesture's last call, and while another one is
   * still in progress (multi-touch), its own end records the state both
   * leave.
   */
  private _onChange = (): void => {
    queueMicrotask(() => {
      if (!Jack.isDragActive(this._cavi)) this.commit();
    });
  };

  private _ready(): boolean {
    return !this._destroyed && !Jack.isDragActive(this._cavi);
  }

  /**
   * Runs `pick` after every earlier undo/redo/load: it returns the index of
   * the entry to put back, or null for none. The index moves once that
   * entry is on the page.
   */
  private _enqueue(pick: () => number | null): Promise<boolean> {
    const run = this._queue.then(async () => {
      const target = pick();
      if (target === null) return false;
      await this._apply(this._entries[target]!);
      // The entry becomes what putting it back left on the page: the page's
      // own state read back in its own order, an end whose jack didn't come
      // back as free. Otherwise the next commit (any gesture, or the one
      // undo/redo start with) would take the difference for a new step.
      this._entries[target] = this._read();
      this._index = target;
      this._notify();
      return true;
    });
    this._queue = run.catch(() => undefined);
    return run;
  }

  private async _apply(json: string): Promise<void> {
    const entry: HistoryEntry<A> = JSON.parse(json);
    this._applying = true;
    try {
      if (this._app) await this._app.restore(entry.app);
      applyCables(this._cavi, entry.cables);
    } finally {
      this._applying = false;
    }
  }

  /** The state on the page, as JSON. */
  private _read(): string {
    return toJSON({
      app: this._app ? this._app.capture() : (undefined as A),
      cables: captureCables(this._cavi),
    });
  }

  private _notify(): void {
    this.dispatchEvent(new Event('change'));
  }
}
