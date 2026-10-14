import { Cavi } from '../core/cavi';
import { CAVI_EVENT_NAMES } from '../core/events';
import { collectStats, type CaviStats } from './stats';
import { describeDetail, formatBytes, formatNumber, formatTime } from './format';

export type CaviDebugMode = 'floating' | 'panel';

/** Geometry/UI state remembered per <cavi-debug> (by id) across reloads. */
interface PersistedState {
  x: number;
  y: number;
  width: number;
  height: number;
  panelWidth: number;
  minimized: boolean;
  /** `data-section` names of the collapsed <details>. */
  collapsed: string[];
}

interface LogEntry {
  name: string;
  time: Date;
  text: string;
  /** How many consecutive occurrences were coalesced into this entry. */
  count: number;
  /** performance.now() of the latest occurrence. */
  last: number;
}

/**
 * Consecutive events closer than this are coalesced into one ×N entry when
 * they are identical, or — for the high-frequency layout events in
 * COALESCE_ANY_DETAIL — whenever they share a name (keeping the latest detail).
 */
const COALESCE_MS = 500;
const COALESCE_ANY_DETAIL = new Set(['cavi-resize', 'cavi-transform-change']);
const FPS_HISTORY = 60;
const MAX_WIRE_ROWS = 100;
const DEFAULT_HOTKEY = 'alt+shift+d';

const DEFAULT_STATE: PersistedState = {
  x: 16,
  y: 16,
  width: 320,
  height: 560,
  panelWidth: 340,
  minimized: false,
  collapsed: ['view', 'settings', 'wires'],
};

/**
 * <cavi-debug> is a developer overlay for one Cavi world: live statistics
 * (FPS, wires, nodes, jacks/plugs, physics parameters, view transform), a
 * per-wire table, a few runtime toggles, and a log of the events the world
 * emits (see CAVI_EVENT_NAMES / CaviEventDetailMap).
 *
 * Which world it inspects, in order:
 * - `for="<id>"`: the <cavi-world> (or any renderer container) with that id;
 * - otherwise the nearest enclosing <cavi-world>;
 * - otherwise whatever Cavi.whenReady resolves for it (Cavi.shared);
 * - or call `.attach(caviOrWorldElement)` yourself, e.g. for a manual setup.
 *
 * Attributes:
 * - `mode="floating" | "panel"`: a draggable, resizable window (default),
 *   or a panel docked to the right edge that slides in and out.
 * - `open`: shown. Reflects the `.open` property; show()/hide()/toggle().
 * - `hotkey`: keyboard shortcut that toggles it, default `alt+shift+d`;
 *   `hotkey="none"` disables it.
 * - `events`: extra, space-separated event names to log besides cavijs's own.
 * - `no-launcher`: no little button to reopen it while closed.
 * - `interval`: stats refresh period in ms (default 250).
 * - `max-events`: event log length (default 200).
 *
 * Rendered in the browser's top layer (popover API) where available, so a
 * pan/zoom transform or z-index on an ancestor — e.g. when nested inside a
 * zoomed <cavi-world> — never clips or covers it, and it stops pointer and
 * wheel events from reaching the page underneath.
 */
export class CaviDebugElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['open', 'mode', 'events', 'interval'];
  }

  private _root: ShadowRoot;
  private _cavi: Cavi | null = null;
  /** The element whose events are being logged, and the names listened for. */
  private _eventTarget: EventTarget | null = null;
  private _listenedNames: string[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _fpsHistory: number[] = [];
  private _entries: LogEntry[] = [];
  private _counts = new Map<string, number>();
  /** Event names hidden from the log (toggled by clicking their chip). */
  private _muted = new Set<string>();
  private _paused = false;
  private _logFrame: number | null = null;
  private _state: PersistedState = { ...DEFAULT_STATE };
  /** Undoes a pending wait for a world to become ready (see _resolveTarget). */
  private _cancelWait: (() => void) | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private readonly _usePopover = typeof HTMLElement.prototype.showPopover === 'function';

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = TEMPLATE;
    this._bindUi();
  }

  connectedCallback(): void {
    this._state = this._loadState();
    const hotkey = this.getAttribute('hotkey') ?? DEFAULT_HOTKEY;
    this._$('hint').innerHTML =
      hotkey === 'none'
        ? ''
        : `Toggle with ${hotkey
            .split('+')
            .map((k) => `<kbd>${esc(k)}</kbd>`)
            .join('+')}`;
    this._applyMode();
    this._applyGeometry();
    this._applyOpen();
    window.addEventListener('keydown', this._onKeyDown);
    if (!this._cavi) this._resolveTarget();
    else this._listen(this._cavi.getContainer());
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    this._cancelWait?.();
    this._cancelWait = null;
    this._stopTimer();
    this._listen(null);
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.isConnected) return;
    if (name === 'open') this._applyOpen();
    if (name === 'mode') {
      this._applyMode();
      this._applyGeometry();
      this._applyOpen();
    }
    if (name === 'events') this._listen(this._eventTarget);
    if (name === 'interval' && this._timer !== null) this._startTimer();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /**
   * Inspects `target` from now on: a Cavi instance, or an element — a
   * <cavi-world> (bound once it is ready) or a manual setup's renderer
   * container, whose events get logged.
   */
  public attach(target: Cavi | HTMLElement): void {
    this._cancelWait?.();
    this._cancelWait = null;
    if (target instanceof Cavi) {
      this._bind(target);
      return;
    }
    this._listen(target);
    this._waitForWorld(target);
  }

  /** Stops inspecting the current world. */
  public detach(): void {
    this._cancelWait?.();
    this._cancelWait = null;
    this._cavi = null;
    this._listen(null);
    this._stopTimer();
    this._setText('world', 'no world');
  }

  /** The Cavi instance being inspected, if bound. */
  public get cavi(): Cavi | null {
    return this._cavi;
  }

  public get open(): boolean {
    return this.hasAttribute('open');
  }

  public set open(value: boolean) {
    this.toggleAttribute('open', value);
  }

  public get mode(): CaviDebugMode {
    return this.getAttribute('mode') === 'panel' ? 'panel' : 'floating';
  }

  public set mode(value: CaviDebugMode) {
    this.setAttribute('mode', value);
  }

  public show(): void {
    this.open = true;
  }

  public hide(): void {
    this.open = false;
  }

  public toggle(): void {
    this.open = !this.open;
  }

  /**
   * Adds an entry to the event log by hand — e.g. for an app's own events,
   * or ones dispatched somewhere other than the world container.
   */
  public log(name: string, detail?: unknown): void {
    this._record(name, detail);
  }

  /** Empties the event log and its per-event counters. */
  public clearLog(): void {
    this._entries = [];
    this._counts.clear();
    this._scheduleLogRender();
  }

  // ---------------------------------------------------------------------
  // World binding
  // ---------------------------------------------------------------------

  private _resolveTarget(): void {
    const forId = this.getAttribute('for');
    if (forId) {
      const el = document.getElementById(forId);
      if (el) {
        this.attach(el);
        return;
      }
      // Not parsed yet (or added later): bind to it once it reports ready.
      const onReady = (e: Event) => {
        const target = e.target as Element | null;
        if (target?.id !== forId) return;
        this._cancelWait?.();
        this._cancelWait = null;
        this._listen(target);
        this._bind((e as CustomEvent<{ cavi: Cavi }>).detail.cavi);
      };
      document.addEventListener('caviready', onReady);
      this._cancelWait = () => document.removeEventListener('caviready', onReady);
      return;
    }

    const world = this.closest('cavi-world') as HTMLElement | null;
    if (world) {
      this.attach(world);
      return;
    }
    let cancelled = false;
    this._cancelWait = () => (cancelled = true);
    Cavi.whenReady(this, (cavi) => {
      if (!cancelled && this.isConnected) this._bind(cavi);
    });
  }

  /** Binds to `el`'s Cavi now if it has one, else on its next `caviready`. */
  private _waitForWorld(el: HTMLElement): void {
    const ready = (el as { getCavi?: () => Cavi | null }).getCavi?.() ?? Cavi.for(el);
    if (ready && ready.getContainer() === el) {
      this._bind(ready);
      return;
    }
    const onReady = (e: Event) => {
      if (e.target !== el) return;
      this._cancelWait?.();
      this._cancelWait = null;
      this._bind((e as CustomEvent<{ cavi: Cavi }>).detail.cavi);
    };
    el.addEventListener('caviready', onReady);
    this._cancelWait = () => el.removeEventListener('caviready', onReady);
  }

  private _bind(cavi: Cavi): void {
    this._cavi = cavi;
    this._fpsHistory = [];
    const container = cavi.getContainer();
    if (container && container !== this._eventTarget) this._listen(container);
    const label = container?.id
      ? `#${container.id}`
      : (container?.tagName.toLowerCase() ?? 'world');
    this._setText('world', label);
    this._syncSettings();
    if (this.open) this._startTimer();
    this._refresh();
  }

  /** (Re)subscribes the event log to `target`, or unsubscribes with null. */
  private _listen(target: EventTarget | null): void {
    for (const name of this._listenedNames) {
      this._eventTarget?.removeEventListener(name, this._onWorldEvent);
    }
    this._eventTarget = target;
    this._listenedNames = [];
    if (!target) return;
    const extra = (this.getAttribute('events') ?? '').split(/\s+/).filter(Boolean);
    this._listenedNames = [...new Set([...CAVI_EVENT_NAMES, ...extra])];
    for (const name of this._listenedNames) {
      target.addEventListener(name, this._onWorldEvent);
    }
  }

  private _onWorldEvent = (e: Event): void => {
    this._record(e.type, (e as CustomEvent).detail);
  };

  // ---------------------------------------------------------------------
  // Event log
  // ---------------------------------------------------------------------

  private _record(name: string, detail: unknown): void {
    this._counts.set(name, (this._counts.get(name) ?? 0) + 1);
    if (!this._paused) {
      const now = performance.now();
      const text = describeDetail(detail);
      const latest = this._entries[0];
      const coalesce =
        latest &&
        latest.name === name &&
        now - latest.last < COALESCE_MS &&
        (latest.text === text || COALESCE_ANY_DETAIL.has(name));
      if (coalesce) {
        latest.count++;
        latest.last = now;
        latest.text = text;
        latest.time = new Date();
      } else {
        this._entries.unshift({ name, time: new Date(), text, count: 1, last: now });
        const max = parseInt(this.getAttribute('max-events') ?? '200') || 200;
        if (this._entries.length > max) this._entries.length = max;
      }
    }
    this._scheduleLogRender();
  }

  private _scheduleLogRender(): void {
    if (this._logFrame !== null) return;
    this._logFrame = requestAnimationFrame(() => {
      this._logFrame = null;
      this._renderLog();
    });
  }

  private _renderLog(): void {
    const total = [...this._counts.values()].reduce((a, b) => a + b, 0);
    this._setText('eventTotal', String(total));

    const chips = this._$('chips');
    chips.innerHTML = [...this._counts.entries()]
      .map(
        ([name, count]) =>
          `<button type="button" class="chip ${category(name)}${this._muted.has(name) ? ' muted' : ''}" data-event="${esc(name)}" title="Show/hide ${esc(name)}">${esc(shortName(name))} <b>${count}</b></button>`
      )
      .join('');

    const visible = this._entries.filter((entry) => !this._muted.has(entry.name));
    const log = this._$('log');
    log.innerHTML = visible.length
      ? visible
          .map(
            (entry) =>
              `<li class="${category(entry.name)}"><time>${formatTime(entry.time)}</time><span class="name">${esc(entry.name)}${entry.count > 1 ? ` <i>×${entry.count}</i>` : ''}</span><span class="detail" title="${esc(entry.text)}">${esc(entry.text)}</span></li>`
          )
          .join('')
      : `<li class="empty">${this._paused ? 'Paused.' : 'No events yet.'}</li>`;
  }

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------

  private _startTimer(): void {
    this._stopTimer();
    const interval = Math.max(50, parseInt(this.getAttribute('interval') ?? '250') || 250);
    this._timer = setInterval(() => this._refresh(), interval);
  }

  private _stopTimer(): void {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  private _refresh(): void {
    const cavi = this._cavi;
    if (!cavi || !this.open) return;
    let stats: CaviStats;
    try {
      stats = collectStats(cavi);
    } catch (err) {
      // A world torn down under us (e.g. its WASM memory gone) — don't
      // spam the console every tick.
      this._stopTimer();
      console.warn('<cavi-debug>: could not read world stats, stopped refreshing.', err);
      return;
    }

    if (stats.fps !== null) {
      this._fpsHistory.push(stats.fps);
      if (this._fpsHistory.length > FPS_HISTORY) this._fpsHistory.shift();
    }
    this._setText('fps', stats.fps === null ? '—' : String(stats.fps));
    this._$('fpsTile').classList.toggle('warn', stats.fps !== null && stats.fps < 50);
    this._setText('wires', String(stats.wires));
    this._setText('freeEnds', `${stats.freeEnds} free ends · ${stats.orphanWires} orphan`);
    this._setText('nodes', String(stats.nodes));
    this._setText(
      'nodeRange',
      stats.wires ? `${stats.minNodes}–${stats.maxNodes} per wire` : 'no wires'
    );
    this._setText('plugs', `${stats.pluggedPlugs}/${stats.plugs}`);
    this._setText('jacks', `${stats.jacks} jacks · ${stats.fullJacks} full`);

    this._setText('gravity', `${formatNumber(stats.gravity.x)}, ${formatNumber(stats.gravity.y)}`);
    this._setText('friction', formatNumber(stats.friction, 3));
    this._setText('mouseRadius', formatNumber(stats.mouseRadius, 1));
    this._setText('pointerRadius', formatNumber(stats.pointerRadius, 1));
    this._setText('responseCoef', formatNumber(stats.responseCoef, 2));
    this._setText('stepRate', `${formatNumber(stats.stepRate, 1)} /s`);
    this._setText('buffer', formatBytes(stats.bufferBytes));

    this._setText(
      'pointer',
      stats.pointer ? `${Math.round(stats.pointer.x)}, ${Math.round(stats.pointer.y)}` : '—'
    );
    this._setText('zoom', `${formatNumber(stats.transform.scale, 3)}×`);
    this._setText(
      'pan',
      `${Math.round(stats.transform.translateX)}, ${Math.round(stats.transform.translateY)}`
    );
    this._setText(
      'container',
      stats.container ? `${stats.container.width} × ${stats.container.height}` : '—'
    );

    this._setText('wireCount', String(stats.wires));
    if ((this._$('wiresSection') as HTMLDetailsElement).open) this._renderWires(stats);
    this._syncSettings();
    this._drawSparkline();
  }

  private _renderWires(stats: CaviStats): void {
    const rows = stats.wireList
      .slice(0, MAX_WIRE_ROWS)
      .map(
        (w) =>
          `<tr><td>${w.index}</td><td><span class="swatch" style="background:${esc(w.color ?? 'transparent')}"></span></td><td>${w.nodes}</td><td>${formatNumber(w.radius, 1)}</td><td>${Math.round(w.length)}</td><td class="ends" title="start ${w.startFixed ? 'fixed' : 'free'}, end ${w.endFixed ? 'fixed' : 'free'}">${w.startFixed ? '●' : '○'}${w.endFixed ? '●' : '○'}</td></tr>`
      );
    if (stats.wireList.length > MAX_WIRE_ROWS) {
      rows.push(
        `<tr><td colspan="6" class="more">+${stats.wireList.length - MAX_WIRE_ROWS} more</td></tr>`
      );
    }
    this._$('wireRows').innerHTML = rows.length
      ? rows.join('')
      : '<tr><td colspan="6" class="more">No wires.</td></tr>';
  }

  private _drawSparkline(): void {
    const canvas = this._$('spark') as HTMLCanvasElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // not laid out (closed, minimized, section hidden)
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const data = this._fpsHistory;
    if (data.length < 2) return;
    const max = Math.max(60, ...data);
    const step = w / (FPS_HISTORY - 1);
    const x0 = w - (data.length - 1) * step;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = x0 + i * step;
      const y = h - 1 - (v / max) * (h - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle =
      getComputedStyle(this).getPropertyValue('--cavi-debug-accent').trim() || '#4fc3f7';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** Mirrors the world's current settings into the Settings controls. */
  private _syncSettings(): void {
    const cavi = this._cavi;
    if (!cavi) return;
    const active = this._root.activeElement;
    const set = (id: string, apply: (el: HTMLInputElement & HTMLSelectElement) => void) => {
      const el = this._$(id) as HTMLInputElement & HTMLSelectElement;
      if (el !== active) apply(el);
    };
    set('debugNodes', (el) => (el.checked = cavi.getDebugDrawNodes()));
    const renderer = cavi.getRenderer();
    set('wireShadows', (el) => {
      el.disabled = !renderer?.setWireShadows;
      el.checked = cavi.getWireShadows();
    });
    set('orphanCleanup', (el) => (el.checked = cavi.getOrphanCleanup()));
    set('cableDrop', (el) => (el.value = cavi.getCableDropBehavior()));
    set('spreadMode', (el) => (el.value = cavi.getPlugSpreadMode()));
  }

  // ---------------------------------------------------------------------
  // Window chrome: open/close, mode, drag, resize, persistence
  // ---------------------------------------------------------------------

  private _applyOpen(): void {
    const open = this.open;
    this._showLayer(this._$('window'), open);
    this._showLayer(this._$('launcher'), !open && !this.hasAttribute('no-launcher'));
    if (open && this._cavi) {
      this._startTimer();
      this._refresh();
    } else {
      this._stopTimer();
    }
  }

  private _showLayer(el: HTMLElement, visible: boolean): void {
    if (this._usePopover && this.isConnected) {
      const shown = el.matches(':popover-open');
      if (visible && !shown) el.showPopover();
      if (!visible && shown) el.hidePopover();
    } else {
      el.hidden = !visible;
    }
  }

  private _applyMode(): void {
    const panel = this.mode === 'panel';
    const win = this._$('window');
    win.classList.toggle('panel', panel);
    win.classList.toggle('floating', !panel);
    this._$('launcher').classList.toggle('edge', panel);
    const dock = this._$('dockBtn');
    dock.title = panel ? 'Undock (floating window)' : 'Dock to the right edge';
    dock.textContent = panel ? '⧉' : '⇥';
  }

  private _applyGeometry(): void {
    const win = this._$('window');
    const s = this._state;
    win.classList.toggle('minimized', s.minimized && this.mode === 'floating');
    if (this.mode === 'panel') {
      win.style.cssText = `width:${s.panelWidth}px`;
      return;
    }
    const maxX = Math.max(0, window.innerWidth - 80);
    const maxY = Math.max(0, window.innerHeight - 40);
    s.x = Math.min(Math.max(0, s.x), maxX);
    s.y = Math.min(Math.max(0, s.y), maxY);
    win.style.cssText = `left:${s.x}px;top:${s.y}px;width:${s.width}px;${s.minimized ? '' : `height:${s.height}px;`}`;
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    const hotkey = (this.getAttribute('hotkey') ?? DEFAULT_HOTKEY).toLowerCase();
    if (hotkey === 'none' || !matchesHotkey(e, hotkey)) return;
    const origin = e.composedPath()[0];
    if (origin instanceof HTMLElement && isEditable(origin)) return;
    e.preventDefault();
    this.toggle();
  };

  private _bindUi(): void {
    const win = this._$('window');
    const launcher = this._$('launcher');

    // Keep the page underneath (e.g. a d3-zoom on an ancestor, or an
    // interaction controller listening on document) from reacting to
    // gestures made on this overlay.
    for (const el of [win, launcher]) {
      for (const type of [
        'pointerdown',
        'mousedown',
        'touchstart',
        'wheel',
        'click',
        'dblclick',
        'contextmenu',
      ]) {
        el.addEventListener(type, (e) => e.stopPropagation());
      }
    }

    launcher.addEventListener('click', () => this.show());
    this._$('closeBtn').addEventListener('click', () => this.hide());
    this._$('dockBtn').addEventListener('click', () => {
      this.mode = this.mode === 'panel' ? 'floating' : 'panel';
    });
    this._$('minBtn').addEventListener('click', () => this._toggleMinimized());

    const header = this._$('header');
    header.addEventListener('dblclick', (e) => {
      if (!(e.target as Element).closest('button')) this._toggleMinimized();
    });
    header.addEventListener('pointerdown', (e) => this._startDrag(e));
    this._$('grip').addEventListener('pointerdown', (e) => this._startPanelResize(e));

    for (const details of this._root.querySelectorAll<HTMLDetailsElement>(
      'details[data-section]'
    )) {
      details.addEventListener('toggle', () => {
        const name = details.dataset.section!;
        const collapsed = new Set(this._state.collapsed);
        if (details.open) collapsed.delete(name);
        else collapsed.add(name);
        this._state.collapsed = [...collapsed];
        this._saveState();
        if (details.open) this._refresh();
      });
    }

    this._$('pauseBtn').addEventListener('click', () => {
      this._paused = !this._paused;
      this._$('pauseBtn').textContent = this._paused ? 'Resume' : 'Pause';
      this._scheduleLogRender();
    });
    this._$('clearBtn').addEventListener('click', () => this.clearLog());
    this._$('chips').addEventListener('click', (e) => {
      const name = (e.target as Element).closest<HTMLElement>('[data-event]')?.dataset.event;
      if (!name) return;
      if (this._muted.has(name)) this._muted.delete(name);
      else this._muted.add(name);
      this._scheduleLogRender();
    });

    this._$('debugNodes').addEventListener('change', (e) => {
      this._cavi?.setDebugDrawNodes((e.target as HTMLInputElement).checked);
    });
    this._$('wireShadows').addEventListener('change', (e) => {
      this._cavi?.setWireShadows((e.target as HTMLInputElement).checked);
    });
    this._$('orphanCleanup').addEventListener('change', (e) => {
      this._cavi?.setOrphanCleanup((e.target as HTMLInputElement).checked);
    });
    this._$('cableDrop').addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value as 'cancel' | 'dangle' | 'detach';
      this._cavi?.setCableDropBehavior(value);
    });
    this._$('spreadMode').addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value as 'towardOther' | 'radial';
      this._cavi?.setPlugSpreadMode(value);
    });

    // Remember the floating window's size after a native CSS resize.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this.mode !== 'floating' || this._state.minimized || !this.open) return;
        const { width, height } = win.getBoundingClientRect();
        if (!width || !height) return;
        this._state.width = Math.round(width);
        this._state.height = Math.round(height);
        this._saveState();
      });
      this._resizeObserver.observe(win);
    }
  }

  private _toggleMinimized(): void {
    if (this.mode !== 'floating') return;
    this._state.minimized = !this._state.minimized;
    this._applyGeometry();
    this._saveState();
  }

  private _startDrag(e: PointerEvent): void {
    if (this.mode !== 'floating' || e.button !== 0) return;
    if ((e.target as Element).closest('button')) return;
    const header = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const { x, y } = this._state;
    header.setPointerCapture(e.pointerId);
    header.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      this._state.x = x + ev.clientX - startX;
      this._state.y = y + ev.clientY - startY;
      this._applyGeometry();
    };
    const end = () => {
      header.classList.remove('dragging');
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      this._saveState();
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    e.preventDefault();
  }

  private _startPanelResize(e: PointerEvent): void {
    if (this.mode !== 'panel' || e.button !== 0) return;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const width = window.innerWidth - ev.clientX;
      this._state.panelWidth = Math.round(Math.min(Math.max(240, width), window.innerWidth * 0.9));
      this._applyGeometry();
    };
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      this._saveState();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    e.preventDefault();
  }

  private get _storageKey(): string {
    return `cavi-debug:${this.id || 'default'}`;
  }

  private _loadState(): PersistedState {
    let state: PersistedState = { ...DEFAULT_STATE };
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (raw) state = { ...state, ...JSON.parse(raw) };
    } catch {
      // Storage unavailable (private mode, blocked site data): defaults.
    }
    for (const details of this._root.querySelectorAll<HTMLDetailsElement>(
      'details[data-section]'
    )) {
      details.open = !state.collapsed.includes(details.dataset.section!);
    }
    return state;
  }

  private _saveState(): void {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this._state));
    } catch {
      // Not persisted — purely a convenience.
    }
  }

  private _$(id: string): HTMLElement {
    return this._root.getElementById(id)!;
  }

  private _setText(id: string, text: string): void {
    const el = this._$(id);
    if (el.textContent !== text) el.textContent = text;
  }
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

/** Color group of an event name in the log. */
function category(name: string): string {
  if (name.includes('wire')) return 'c-wire';
  if (name.includes('plug')) return 'c-plug';
  if (name.includes('cable')) return 'c-cable';
  if (CAVI_EVENT_NAMES.includes(name)) return 'c-world';
  return 'c-app';
}

function shortName(name: string): string {
  return name.startsWith('cavi-') ? name.slice(5) : name;
}

/** `hotkey` is `+`-joined modifiers and one key, e.g. `alt+shift+d` or `f2`. */
function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  if (e.altKey !== mods.has('alt')) return false;
  if (e.shiftKey !== mods.has('shift')) return false;
  if (e.ctrlKey !== mods.has('ctrl')) return false;
  if (e.metaKey !== (mods.has('meta') || mods.has('cmd'))) return false;
  // Match the physical key too: with Alt held, macOS reports e.g. "∂" as e.key for D.
  const code = (e.code ?? '').toLowerCase();
  return (
    e.key.toLowerCase() === key || code === `key${key}` || code === `digit${key}` || code === key
  );
}

function isEditable(el: HTMLElement): boolean {
  return (
    el.isContentEditable ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

const popoverAttr =
  typeof HTMLElement.prototype.showPopover === 'function' ? 'popover="manual"' : 'hidden';

const TEMPLATE = `
<style>
  :host {
    --cavi-debug-bg: #15171c;
    --cavi-debug-surface: #1d2027;
    --cavi-debug-border: #2d323c;
    --cavi-debug-text: #d8dbe2;
    --cavi-debug-muted: #8b929e;
    --cavi-debug-accent: #4fc3f7;
    --cavi-debug-warn: #ffb74d;
    --cavi-debug-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    --cavi-debug-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    display: contents;
  }
  [hidden] { display: none !important; }

  .window, .launcher {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 0;
    z-index: 2147483000;
    color: var(--cavi-debug-text);
    background: var(--cavi-debug-bg);
    border: 1px solid var(--cavi-debug-border);
    font: 12px/1.4 var(--cavi-debug-font);
    box-sizing: border-box;
  }

  /* ---- window ---- */
  .window {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }
  .window[popover]:not(:popover-open) { display: none; }
  .window.floating {
    border-radius: 10px;
    min-width: 260px;
    min-height: 120px;
    max-width: calc(100vw - 8px);
    max-height: calc(100vh - 8px);
    resize: both;
  }
  .window.floating.minimized { min-height: 0; resize: none; }
  .window.floating.minimized .body { display: none; }
  .window.panel {
    top: 0;
    right: 0;
    height: 100vh;
    max-height: 100vh;
    border-width: 0 0 0 1px;
    border-radius: 0;
    animation: slide-in 0.18s ease-out;
  }
  @keyframes slide-in { from { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .window.panel { animation: none; } }

  .grip {
    position: absolute; top: 0; bottom: 0; left: -3px; width: 6px;
    cursor: ew-resize; display: none; z-index: 1;
  }
  .window.panel .grip { display: block; }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    background: var(--cavi-debug-surface);
    border-bottom: 1px solid var(--cavi-debug-border);
    user-select: none;
    touch-action: none;
  }
  .window.floating header { cursor: grab; }
  .window.floating header.dragging { cursor: grabbing; }
  .window.floating.minimized header { border-bottom: 0; }
  .title { font-weight: 600; letter-spacing: 0.02em; }
  .world {
    color: var(--cavi-debug-muted);
    font-family: var(--cavi-debug-mono);
    font-size: 11px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--cavi-debug-accent);
    box-shadow: 0 0 6px var(--cavi-debug-accent);
    flex: none;
  }
  header button {
    all: unset;
    width: 24px; height: 24px;
    display: grid; place-items: center;
    border-radius: 6px;
    color: var(--cavi-debug-muted);
    cursor: pointer;
    font-size: 14px;
  }
  header button:hover { background: var(--cavi-debug-border); color: var(--cavi-debug-text); }
  header button:focus-visible { outline: 2px solid var(--cavi-debug-accent); }
  .window.panel #minBtn { display: none; }

  .body { flex: 1; overflow: auto; padding: 10px; overscroll-behavior: contain; }

  /* ---- KPI tiles ---- */
  .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
  .tile {
    background: var(--cavi-debug-surface);
    border: 1px solid var(--cavi-debug-border);
    border-radius: 8px;
    padding: 7px 9px;
    min-width: 0;
  }
  .tile .label { color: var(--cavi-debug-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .tile .value { font: 600 20px/1.2 var(--cavi-debug-mono); font-variant-numeric: tabular-nums; }
  .tile .sub { color: var(--cavi-debug-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.warn .value { color: var(--cavi-debug-warn); }
  #spark { display: block; width: 100%; height: 18px; margin-top: 2px; }

  /* ---- sections ---- */
  details { border-top: 1px solid var(--cavi-debug-border); }
  summary {
    list-style: none;
    cursor: pointer;
    padding: 8px 2px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--cavi-debug-text);
  }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▸'; color: var(--cavi-debug-muted); transition: transform 0.12s; }
  details[open] > summary::before { transform: rotate(90deg); }
  summary .count {
    margin-left: auto;
    font: 11px var(--cavi-debug-mono);
    color: var(--cavi-debug-muted);
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0 0 10px; padding: 0 2px; }
  dt { color: var(--cavi-debug-muted); }
  dd { margin: 0; text-align: right; font-family: var(--cavi-debug-mono); font-variant-numeric: tabular-nums; }

  .settings { display: grid; gap: 6px; margin-bottom: 10px; padding: 0 2px; }
  .settings label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--cavi-debug-muted); }
  .settings select {
    background: var(--cavi-debug-surface);
    color: var(--cavi-debug-text);
    border: 1px solid var(--cavi-debug-border);
    border-radius: 5px;
    padding: 2px 4px;
    font: inherit;
  }
  .settings input[type='checkbox'] { accent-color: var(--cavi-debug-accent); }

  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-family: var(--cavi-debug-mono); font-size: 11px; }
  th { color: var(--cavi-debug-muted); font-weight: normal; text-align: right; padding: 2px 4px; border-bottom: 1px solid var(--cavi-debug-border); }
  td { text-align: right; padding: 2px 4px; font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align: left; }
  tbody tr:nth-child(odd) { background: rgba(255, 255, 255, 0.02); }
  td.more { text-align: center; color: var(--cavi-debug-muted); font-family: var(--cavi-debug-font); }
  .swatch { display: inline-block; width: 18px; height: 6px; border-radius: 3px; vertical-align: middle; border: 1px solid rgba(255,255,255,0.15); }
  .ends { letter-spacing: 1px; color: var(--cavi-debug-accent); }

  /* ---- event log ---- */
  .toolbar { display: flex; gap: 6px; margin-bottom: 6px; }
  .toolbar button {
    font: inherit;
    color: var(--cavi-debug-text);
    background: var(--cavi-debug-surface);
    border: 1px solid var(--cavi-debug-border);
    border-radius: 5px;
    padding: 2px 10px;
    cursor: pointer;
  }
  .toolbar button:hover { border-color: var(--cavi-debug-muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .chip {
    font: 11px var(--cavi-debug-mono);
    color: var(--cavi-debug-text);
    background: var(--cavi-debug-surface);
    border: 1px solid var(--cavi-debug-border);
    border-left: 3px solid var(--tone);
    border-radius: 4px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .chip b { color: var(--cavi-debug-muted); font-weight: normal; }
  .chip.muted { opacity: 0.4; text-decoration: line-through; }
  .log {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    font: 11px/1.45 var(--cavi-debug-mono);
    max-height: 260px;
    overflow: auto;
    background: var(--cavi-debug-surface);
    border: 1px solid var(--cavi-debug-border);
    border-radius: 6px;
  }
  .window.panel .log { max-height: none; }
  .log li {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    padding: 3px 8px;
    border-left: 3px solid var(--tone);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .log li.empty { display: block; color: var(--cavi-debug-muted); border-left-color: transparent; text-align: center; padding: 10px; font-family: var(--cavi-debug-font); }
  .log time { color: var(--cavi-debug-muted); }
  .log .name { color: var(--tone); }
  .log .name i { color: var(--cavi-debug-muted); font-style: normal; }
  .log .detail { grid-column: 1 / -1; color: var(--cavi-debug-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .log .detail:empty { display: none; }
  .c-world { --tone: #9aa3b2; }
  .c-wire { --tone: #81c784; }
  .c-plug { --tone: #4fc3f7; }
  .c-cable { --tone: #ffb74d; }
  .c-app { --tone: #ce93d8; }

  .hint { color: var(--cavi-debug-muted); font-size: 11px; padding: 4px 2px 0; }
  kbd { font: 10px var(--cavi-debug-mono); border: 1px solid var(--cavi-debug-border); border-radius: 3px; padding: 0 3px; }

  /* ---- launcher ---- */
  .launcher {
    right: 16px;
    bottom: 16px;
    border-radius: 999px;
    padding: 6px 12px 6px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-weight: 600;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  }
  .launcher[popover]:not(:popover-open) { display: none; }
  .launcher:hover { border-color: var(--cavi-debug-accent); }
  .launcher:focus-visible { outline: 2px solid var(--cavi-debug-accent); }
  .launcher.edge {
    right: 0;
    bottom: auto;
    top: 50%;
    translate: 0 -50%;
    border-radius: 8px 0 0 8px;
    border-right: 0;
    padding: 10px 6px;
    writing-mode: vertical-rl;
  }
</style>

<button type="button" class="launcher" id="launcher" part="launcher" ${popoverAttr} title="Open cavi debug">
  <span class="dot"></span>cavi debug
</button>

<section class="window floating" id="window" part="window" ${popoverAttr} aria-label="cavi debug">
  <div class="grip" id="grip" title="Resize"></div>
  <header id="header" part="header">
    <span class="dot"></span>
    <span class="title">cavi debug</span>
    <span class="world" id="world">waiting for world…</span>
    <button type="button" id="minBtn" title="Minimize" aria-label="Minimize">–</button>
    <button type="button" id="dockBtn" title="Dock to the right edge" aria-label="Toggle docking">⇥</button>
    <button type="button" id="closeBtn" title="Close" aria-label="Close">×</button>
  </header>

  <div class="body">
    <div class="kpis">
      <div class="tile" id="fpsTile">
        <div class="label">FPS</div>
        <div class="value" id="fps">—</div>
        <canvas id="spark" aria-hidden="true"></canvas>
      </div>
      <div class="tile">
        <div class="label">Wires</div>
        <div class="value" id="wires">—</div>
        <div class="sub" id="freeEnds"></div>
      </div>
      <div class="tile">
        <div class="label">Nodes</div>
        <div class="value" id="nodes">—</div>
        <div class="sub" id="nodeRange"></div>
      </div>
      <div class="tile">
        <div class="label">Plugged</div>
        <div class="value" id="plugs">—</div>
        <div class="sub" id="jacks"></div>
      </div>
    </div>

    <details data-section="physics" open>
      <summary>Physics</summary>
      <dl>
        <dt>Gravity</dt><dd id="gravity">—</dd>
        <dt>Friction</dt><dd id="friction">—</dd>
        <dt>Mouse radius</dt><dd id="mouseRadius">—</dd>
        <dt>Pointer radius</dt><dd id="pointerRadius">—</dd>
        <dt>Response coef.</dt><dd id="responseCoef">—</dd>
        <dt>Step rate</dt><dd id="stepRate">—</dd>
        <dt>Render buffer</dt><dd id="buffer">—</dd>
      </dl>
    </details>

    <details data-section="view">
      <summary>View</summary>
      <dl>
        <dt>Pointer (world)</dt><dd id="pointer">—</dd>
        <dt>Zoom</dt><dd id="zoom">—</dd>
        <dt>Pan</dt><dd id="pan">—</dd>
        <dt>Container</dt><dd id="container">—</dd>
      </dl>
    </details>

    <details data-section="settings">
      <summary>Settings</summary>
      <div class="settings">
        <label>Draw nodes &amp; radii <input type="checkbox" id="debugNodes"></label>
        <label>Wire shadows <input type="checkbox" id="wireShadows"></label>
        <label title="Delete cables with no fixed end once they leave the view">Orphan cleanup <input type="checkbox" id="orphanCleanup"></label>
        <label>Cable drop
          <select id="cableDrop">
            <option value="detach">detach</option>
            <option value="dangle">dangle</option>
            <option value="cancel">cancel</option>
          </select>
        </label>
        <label>Plug spread
          <select id="spreadMode">
            <option value="towardOther">towardOther</option>
            <option value="radial">radial</option>
          </select>
        </label>
      </div>
    </details>

    <details data-section="wires" id="wiresSection">
      <summary>Wires <span class="count" id="wireCount">0</span></summary>
      <table>
        <thead><tr><th>#</th><th></th><th>nodes</th><th>radius</th><th>length</th><th>ends</th></tr></thead>
        <tbody id="wireRows"></tbody>
      </table>
    </details>

    <details data-section="events" open>
      <summary>Events <span class="count" id="eventTotal">0</span></summary>
      <div class="toolbar">
        <button type="button" id="pauseBtn">Pause</button>
        <button type="button" id="clearBtn">Clear</button>
      </div>
      <div class="chips" id="chips"></div>
      <ul class="log" id="log"><li class="empty">No events yet.</li></ul>
    </details>
    <div class="hint" id="hint"></div>
  </div>
</section>
`;

customElements.define('cavi-debug', CaviDebugElement);

declare global {
  interface HTMLElementTagNameMap {
    'cavi-debug': CaviDebugElement;
  }
}
