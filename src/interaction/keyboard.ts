import { Cavi } from '../core/cavi';
import { Jack, type CableSession } from '../component/jack';
import { Plug } from '../component/plug';
import type { IInteractionController } from '../core/types';

/**
 * Keyboard interaction, next to (not instead of) a pointer controller —
 * <cavi-interaction> attaches both by default. Driven, like
 * StandardInteractionController, only through Jack/Plug's public API.
 *
 * - Tab visits each jack and then the plugs plugged into it (Shift+Tab the
 *   other way). Plugs are out of the natural Tab order (tabindex -1, see
 *   Plug); this controller puts them after their jack. The jack of a
 *   focused plug fans its plugs out, so it is visible which one it is.
 * - Space or Enter on a jack starts a new cable; on a plug, picks it up.
 * - While carrying, Tab only stops on the jacks that can take what is
 *   carried (right type, room left, not the jack holding the cable's
 *   other end), and moves the free end there; Space
 *   or Enter plugs it in. On the jack it came from, Space/Enter puts it
 *   back (a new cable: removes it).
 * - Escape cancels: a new cable is removed, a plug goes back where it was.
 *   So does a pointer press anywhere, so a keyboard gesture never runs
 *   alongside a pointer one.
 *
 * Only elements of the world this controller is attached to (see
 * Cavi.for), as for the pointer controller: each world has its own.
 */
export class KeyboardInteractionController implements IInteractionController {
  private _attached: boolean = false;
  private _cavi: Cavi | null = null;
  /** What is being carried from the keyboard, if anything. */
  private _carry: Carry | null = null;
  /** A Shift+Tab left to the browser: see _handleFocusIn. */
  private _backTab: boolean = false;
  /** The jack kept spread out because the focus is on one of its plugs. */
  private _spreadJack: Jack | null = null;

  public attach(cavi: Cavi): void {
    if (this._attached) return;
    this._attached = true;
    this._cavi = cavi;
    document.addEventListener('keydown', this._handleKeyDown);
    document.addEventListener('focusin', this._handleFocusIn);
    document.addEventListener('focusout', this._handleFocusOut);
    document.addEventListener('pointerdown', this._handlePointerDown, true);
  }

  public detach(): void {
    if (!this._attached) return;
    this._attached = false;
    document.removeEventListener('keydown', this._handleKeyDown);
    document.removeEventListener('focusin', this._handleFocusIn);
    document.removeEventListener('focusout', this._handleFocusOut);
    document.removeEventListener('pointerdown', this._handlePointerDown, true);
    if (this._carry) this._abort(false);
    this._setSpreadJack(null);
    this._cavi = null;
  }

  /** The Jack or Plug of this world `e` happened on (the focused one, for key and focus events). */
  private _elementOf(e: Event): Jack | Plug | null {
    for (const node of e.composedPath()) {
      if (node instanceof Jack || node instanceof Plug) {
        return Cavi.for(node) === this._cavi ? node : null;
      }
    }
    return null;
  }

  private _handleKeyDown = (e: KeyboardEvent): void => {
    this._backTab = false;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (this._carry) {
      this._carryKey(e);
      return;
    }
    const el = this._elementOf(e);
    if (e.key === 'Tab') {
      if (!(el && this._idleTab(el, e)) && e.shiftKey) this._backTab = true;
      return;
    }
    if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
    // A pointer gesture is running in this world: it has the cable.
    if (Jack.isDragActive(this._cavi)) return;
    if (el instanceof Jack) this._startCable(el, e);
    else this._startPlugCarry(el, e);
  };

  /**
   * Tab with nothing carried, on a jack or plug of this world: inserts a
   * jack's plugs right after it. Returns whether it moved the focus itself.
   */
  private _idleTab(el: Jack | Plug, e: KeyboardEvent): boolean {
    if (el instanceof Jack) {
      const plugs = el.plugs;
      if (e.shiftKey || plugs.length === 0) return false;
      e.preventDefault();
      plugs[0].focus();
      return true;
    }
    const jack = el.jack;
    if (!jack) return false;
    const plugs = jack.plugs;
    const i = plugs.indexOf(el);
    if (e.shiftKey) {
      e.preventDefault();
      (i > 0 ? plugs[i - 1] : jack).focus();
      return true;
    }
    if (i >= 0 && i < plugs.length - 1) {
      e.preventDefault();
      plugs[i + 1].focus();
      return true;
    }
    // Past the jack's last plug: back on the jack, and the browser's own
    // Tab (not prevented) carries on from there to whatever follows it.
    jack.focus();
    return true;
  }

  private _startCable(jack: Jack, e: KeyboardEvent): void {
    const c = jack.getCenter();
    const session = jack.createCable(c.x, c.y);
    if (!session) return;
    e.preventDefault(); // Space would scroll the page
    this._carry = { kind: 'cable', session, origin: jack, at: jack, cavi: this._cavi };
    this._setSpreadJack(null);
    Jack.setDragActive(true, this._cavi);
  }

  private _startPlugCarry(plug: Plug, e: KeyboardEvent): void {
    e.preventDefault();
    const origin = plug.jack;
    this._setSpreadJack(null);
    plug.beginDrag();
    this._carry = { kind: 'plug', plug, origin, at: origin, cavi: this._cavi };
    Jack.setDragActive(true, this._cavi);
  }

  private _carryKey(e: KeyboardEvent): void {
    const carry = this._carry!;
    if (e.key === 'Escape') {
      e.preventDefault();
      this._abort(true);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this._step(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const el = this._elementOf(e);
    if (el === carry.origin || (carry.kind === 'plug' && el === carry.plug)) {
      // Where it came from: a new cable was never needed, a plug goes back.
      this._abort(false);
      return;
    }
    if (el instanceof Jack && this._isCandidate(el)) this._finish(el);
  }

  /** The jacks of this world that can take what is carried, in document order. */
  private _candidates(): Jack[] {
    const list: Jack[] = [];
    for (const jack of Jack.registry) {
      if (Cavi.for(jack) === this._cavi && this._isCandidate(jack)) list.push(jack);
    }
    return list.sort((a, b) => (isBefore(a, b) ? -1 : 1));
  }

  private _isCandidate(jack: Jack): boolean {
    const carry = this._carry;
    if (!carry) return false;
    // Where it came from is always offered, to put it back.
    if (jack === carry.origin) return true;
    // Never both ends of one cable in the same jack (see Jack.findSnapTarget).
    if (carry.kind === 'plug' && jack === carry.plug.getOtherEnd()?.jack) return false;
    const type = carry.kind === 'plug' ? carry.plug.type : carry.session.jack.type;
    return jack.canAccept(type) && jack.canAcceptMore();
  }

  /** Tab while carrying: focus the next (dir 1) or previous (dir -1) candidate jack. */
  private _step(dir: 1 | -1): void {
    const list = this._candidates();
    if (list.length === 0) return;
    const ref = this._carry!.at;
    const next =
      dir > 0
        ? (list.find((j) => !ref || isBefore(ref, j)) ?? list[0])
        : ([...list].reverse().find((j) => !ref || isBefore(j, ref)) ?? list[list.length - 1]);
    next.focus(); // _handleFocusIn moves the free end there
  }

  private _handleFocusIn = (e: FocusEvent): void => {
    const backTab = this._backTab;
    this._backTab = false;
    const el = this._elementOf(e);
    const carry = this._carry;
    if (carry) {
      // Only a jack that can take it: focus landing anywhere else (put
      // there by a script, say) leaves the free end where it is.
      if (el instanceof Jack && this._isCandidate(el)) this._moveTo(el);
      return;
    }
    // Shift+Tab onto a jack with plugs: its last plug, as Tab would have
    // gone jack, plugs, next jack.
    if (backTab && el instanceof Jack && el.plugs.length > 0) {
      el.plugs[el.plugs.length - 1].focus();
      return;
    }
    this._setSpreadJack(el instanceof Plug ? el.jack : null);
  };

  private _handleFocusOut = (e: FocusEvent): void => {
    // Focus leaving for nothing (the page, another window): no focusin follows.
    if (!e.relatedTarget) this._setSpreadJack(null);
  };

  private _handlePointerDown = (): void => {
    // The pointer takes over: the keyboard gesture is cancelled first.
    if (this._carry) this._abort(false);
  };

  /** Moves the free end of what is carried onto `jack`. */
  private _moveTo(jack: Jack): void {
    const carry = this._carry!;
    carry.at = jack;
    const c = jack.getCenter();
    if (carry.kind === 'cable') Jack.updateCableSession(carry.session, c.x, c.y);
    else carry.plug.updateDragPosition(c.x, c.y);
  }

  /** Plugs what is carried into `jack`. */
  private _finish(jack: Jack): void {
    const carry = this._carry!;
    this._carry = null;
    if (carry.kind === 'cable') {
      const c = jack.getCenter();
      Jack.updateCableSession(carry.session, c.x, c.y);
      Jack.finishCableSession(carry.session);
    } else {
      carry.plug.endDragAt(jack);
    }
    Jack.setDragActive(false, carry.cavi);
  }

  /**
   * Cancels what is carried: a new cable is removed, a plug goes back into
   * the jack it came from. `refocus`: give the focus back to where the
   * gesture started (Escape), rather than leave it (pointer, detach).
   */
  private _abort(refocus: boolean): void {
    const carry = this._carry!;
    this._carry = null;
    if (carry.kind === 'cable') {
      Jack.discardCableSession(carry.session);
      if (refocus && carry.origin.isConnected) carry.origin.focus();
    } else {
      carry.plug.endDragAt(carry.origin);
      if (refocus && carry.plug.isConnected) carry.plug.focus();
    }
    Jack.setDragActive(false, carry.cavi);
  }

  private _setSpreadJack(jack: Jack | null): void {
    if (this._spreadJack === jack) return;
    this._spreadJack?.holdSpread(false);
    this._spreadJack = jack;
    jack?.holdSpread(true);
  }
}

/** What is carried from the keyboard: a new cable, or a plug picked up from its jack. */
type Carry =
  | { kind: 'cable'; session: CableSession; origin: Jack; at: Jack | null; cavi: Cavi | null }
  | { kind: 'plug'; plug: Plug; origin: Jack | null; at: Jack | null; cavi: Cavi | null };

/** Whether `a` comes before `b` in the document. */
function isBefore(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
