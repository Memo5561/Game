// Pointer handling for dragging tray pieces onto the board (docs/ARCHITECTURE.md §4.12).
//
// - The first pointerdown inside a tray slot starts a drag (mouse, touch or pen); other pointers
//   are ignored until it ends. The pointer is captured; pointerup drops; pointercancel,
//   lostpointercapture without an up, and window blur cancel (piece flies back).
// - Pointer moves are coalesced: the latest position is processed once per rendered frame (via
//   the renderer's frame hook), and `preview()` runs only when the snapped cell changes.
// - The piece floats above the finger by a lift that is fixed at pickup and chosen so that the
//   bottom board row is always reachable.
// - Snapping: round the fractional top-left cell; if that is invalid, take the nearest valid cell
//   within 0.6 cells. In the tutorial the hinted target snaps within 1.0 cell.
// - onDrop() is synchronous: the placed cells render in the same frame the floating piece vanishes.
// - Booster target mode (renderer.targetMode set): pointer down/move shows the 3x3 target under
//   the finger, pointerup on the board calls onTapCell(r, c).

const SNAP_RADIUS = 0.6;
const HINT_SNAP_RADIUS = 1.0;
const EMPTY = Object.freeze([]);

/**
 * Lift (finger → piece centre distance) per §4.12:
 * clamp(2*cell + pieceH/2, 0.5*cell, (canvasBottom - 8) - (boardY + boardPx) + pieceH/2).
 * The upper bound wins, so the piece can always reach the bottom row.
 * @param {import('../render/layout.js').Layout} layout
 * @param {number} canvasHeight CSS px
 * @param {number} pieceH piece height at board cell size (CSS px)
 * @returns {number}
 */
export function computeLift(layout, canvasHeight, pieceH) {
  const cell = layout.cell;
  const max = (canvasHeight - 8) - (layout.boardY + layout.boardPx) + pieceH / 2;
  return Math.min(Math.max(2 * cell + pieceH / 2, 0.5 * cell), max);
}

/**
 * Pointer position that puts the top-left of tray piece (w × h cells) onto cell (r, c) –
 * the inverse of the drag mapping (tests / debug API).
 * @returns {{x: number, y: number}}
 */
export function pointerForCell(layout, canvasHeight, shape, r, c) {
  const pieceW = shape.w * layout.cell;
  const pieceH = shape.h * layout.cell;
  const lift = computeLift(layout, canvasHeight, pieceH);
  return {
    x: layout.boardX + c * layout.cell + pieceW / 2,
    y: layout.boardY + r * layout.cell + pieceH / 2 + lift,
  };
}

export class DragController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../render/renderer.js').Renderer} renderer
   * @param {Object} opts
   * @param {() => boolean} opts.canInteract
   * @param {(i: number) => ({shape: Object, color: number} | null)} opts.getPiece
   * @param {(i: number, r: number, c: number) => boolean} opts.canPlace
   * @param {(i: number, r: number, c: number) => {valid: boolean, rows: number[], cols: number[]}} opts.preview
   * @param {() => ({trayIndex: number, r: number, c: number} | null)} [opts.hint]
   * @param {(i: number) => void} [opts.onPickup]
   * @param {(p: {r: number, c: number, valid: boolean} | null) => void} [opts.onHover]
   * @param {(i: number, r: number, c: number) => boolean} opts.onDrop
   * @param {(i: number, reason: 'invalid'|'return'|'cancel') => void} [opts.onCancel]
   *   extra 2nd arg: 'invalid' = released over the board without a valid spot, 'return' =
   *   released elsewhere, 'cancel' = cancel()/pointercancel/blur
   * @param {(r: number, c: number) => void} [opts.onTapCell]
   */
  constructor(canvas, renderer, opts) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.opts = opts || {};
    this._pid = null;      // pointer id of the active drag
    this._tpid = null;     // pointer id in target mode
    this._i = -1;
    this._shape = null;
    this._lift = 0;
    this._pw = 0;
    this._ph = 0;
    this._px = 0;
    this._py = 0;
    this._dirty = false;
    this._snapR = 0;
    this._snapC = 0;
    this._hasSnap = false;
    this._hovering = false;
    this._overBoard = false;
    this._hint = null;
    this._ox = 0;          // canvas client offset (cached at pointerdown)
    this._oy = 0;
    this._snap = { r: 0, c: 0 };
    this._state = { trayIndex: -1, x: 0, y: 0, snap: null, rows: EMPTY, cols: EMPTY };
    this._hoverInfo = { r: 0, c: 0, valid: true };

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onCancelEvt = this._onCancelEvt.bind(this);
    this._onLost = this._onLost.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._process = this._process.bind(this);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onCancelEvt);
    canvas.addEventListener('lostpointercapture', this._onLost);
    window.addEventListener('blur', this._onBlur);
    renderer.setFrameHook(this._process);
  }

  /** @returns {boolean} a piece is being dragged */
  get active() {
    return this._pid !== null;
  }

  /** Index of the dragged tray slot (-1 if none). Extra. */
  get trayIndex() {
    return this._pid !== null ? this._i : -1;
  }

  /** Aborts the drag: the piece flies back, onCancel(i, 'cancel') fires. */
  cancel() {
    if (this._pid === null) {
      this._endTarget();
      return;
    }
    const i = this._i;
    const { x, y } = this._state;
    this._end();
    this.renderer.setDrag(null);
    this.renderer.animateReturn(i, x, y);
    this._clearHover();
    if (this.opts.onCancel) this.opts.onCancel(i, 'cancel');
  }

  destroy() {
    this.cancel();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onCancelEvt);
    c.removeEventListener('lostpointercapture', this._onLost);
    window.removeEventListener('blur', this._onBlur);
    this.renderer.setFrameHook(null);
  }

  // -------------------------------------------------------------------------------------------

  _local(e) {
    this._px = e.clientX - this._ox;
    this._py = e.clientY - this._oy;
  }

  _measure() {
    const rect = this.canvas.getBoundingClientRect();
    this._ox = rect.left;
    this._oy = rect.top;
  }

  _onDown(e) {
    if (this._pid !== null || this._tpid !== null) return; // one pointer at a time
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._measure();
    this._local(e);
    const R = this.renderer;
    if (R.targetMode) {
      e.preventDefault();
      this._tpid = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this._updateTarget();
      return;
    }
    if (this.opts.canInteract && !this.opts.canInteract()) return;
    const i = R.trayIndexAt(this._px, this._py);
    if (i < 0) return;
    const piece = this.opts.getPiece ? this.opts.getPiece(i) : null;
    if (!piece || !piece.shape) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const L = R.layout;
    this._pid = e.pointerId;
    this._i = i;
    this._shape = piece.shape;
    this._pw = piece.shape.w * L.cell;
    this._ph = piece.shape.h * L.cell;
    this._lift = computeLift(L, L.height, this._ph);
    this._hint = this.opts.hint ? this.opts.hint() : null;
    this._hasSnap = false;
    this._hovering = false;
    this._state.trayIndex = i;
    this._state.snap = null;
    this._state.rows = EMPTY;
    this._state.cols = EMPTY;
    this._dirty = true;
    this._process();
    if (this.opts.onPickup) this.opts.onPickup(i);
  }

  _onMove(e) {
    if (this._tpid !== null) {
      if (e.pointerId !== this._tpid) return;
      this._local(e);
      this._updateTarget();
      return;
    }
    if (this._pid === null) {
      // desktop hover preview of the hammer target
      if (this.renderer.targetMode && e.pointerType === 'mouse') {
        this._measure();
        this._local(e);
        this._updateTarget();
      }
      return;
    }
    if (e.pointerId !== this._pid) return;
    this._local(e);
    this._dirty = true;
    this.renderer.invalidate();
  }

  _onUp(e) {
    if (this._tpid !== null && e.pointerId === this._tpid) {
      this._local(e);
      const f = this.renderer.cellAt(this._px, this._py);
      const r = Math.floor(f.r);
      const c = Math.floor(f.c);
      this._endTarget();
      if (r >= 0 && c >= 0 && r < 8 && c < 8 && this.opts.onTapCell) this.opts.onTapCell(r, c);
      return;
    }
    if (this._pid === null || e.pointerId !== this._pid) return;
    this._local(e);
    this._dirty = true;
    this._process();
    const i = this._i;
    const { x, y } = this._state;
    const snapped = this._hasSnap;
    const r = this._snapR;
    const c = this._snapC;
    const overBoard = this._overBoard;
    this._end();
    let placed = false;
    if (snapped && this.opts.onDrop) placed = !!this.opts.onDrop(i, r, c);
    this.renderer.setDrag(null);
    this._clearHover();
    if (!placed) {
      this.renderer.animateReturn(i, x, y);
      if (this.opts.onCancel) this.opts.onCancel(i, overBoard ? 'invalid' : 'return');
    }
  }

  _onCancelEvt(e) {
    if (this._tpid !== null && e.pointerId === this._tpid) {
      this._endTarget();
      return;
    }
    if (this._pid !== null && e.pointerId === this._pid) this.cancel();
  }

  _onLost(e) {
    // capture lost without a pointerup (e.g. the element was hidden) → cancel
    if (this._pid !== null && e.pointerId === this._pid) this.cancel();
    else if (this._tpid !== null && e.pointerId === this._tpid) this._endTarget();
  }

  _onBlur() {
    if (this._pid !== null) this.cancel();
    else this._endTarget();
  }

  _end() {
    const pid = this._pid;
    this._pid = null;
    this._dirty = false;
    if (pid !== null) {
      try {
        if (this.canvas.hasPointerCapture(pid)) this.canvas.releasePointerCapture(pid);
      } catch { /* ignore */ }
    }
  }

  _endTarget() {
    const pid = this._tpid;
    this._tpid = null;
    if (pid !== null) {
      try {
        if (this.canvas.hasPointerCapture(pid)) this.canvas.releasePointerCapture(pid);
      } catch { /* ignore */ }
    }
    this.renderer.setTargetCell(null);
  }

  _updateTarget() {
    const f = this.renderer.cellAt(this._px, this._py);
    const r = Math.floor(f.r);
    const c = Math.floor(f.c);
    if (r >= 0 && c >= 0 && r < 8 && c < 8) this.renderer.setTargetCell(r, c);
    else this.renderer.setTargetCell(null);
  }

  _clearHover() {
    if (this._hovering) {
      this._hovering = false;
      if (this.opts.onHover) this.opts.onHover(null);
    }
  }

  /** Processes the latest pointer position (once per frame, from the renderer's frame hook). */
  _process() {
    if (!this._dirty || this._pid === null) return;
    this._dirty = false;
    const L = this.renderer.layout;
    const cell = L.cell;
    const i = this._i;
    const x = this._px - this._pw / 2;
    const y = this._py - this._lift - this._ph / 2;
    const fr = (y - L.boardY) / cell;
    const fc = (x - L.boardX) / cell;
    this._overBoard = fr > -this._shape.h * 0.5 && fc > -this._shape.w * 0.5 && fr < 8 - this._shape.h * 0.5 && fc < 8 - this._shape.w * 0.5;

    // snapping
    let ok = false;
    let r = Math.round(fr);
    let c = Math.round(fc);
    const h = this._hint;
    const canPlace = this.opts.canPlace;
    if (h && h.trayIndex === i && Math.hypot(fr - h.r, fc - h.c) <= HINT_SNAP_RADIUS && canPlace(i, h.r, h.c)) {
      r = h.r;
      c = h.c;
      ok = true;
    } else if (canPlace(i, r, c)) {
      ok = true;
    } else {
      let best = SNAP_RADIUS + 1e-9;
      const r0 = Math.floor(fr);
      const c0 = Math.floor(fc);
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = 0; dc <= 1; dc++) {
          const rr = r0 + dr;
          const cc = c0 + dc;
          const d = Math.hypot(fr - rr, fc - cc);
          if (d <= best && canPlace(i, rr, cc)) {
            best = d;
            r = rr;
            c = cc;
            ok = true;
          }
        }
      }
    }

    const st = this._state;
    const changed = ok !== this._hasSnap || (ok && (r !== this._snapR || c !== this._snapC));
    if (changed) {
      this._hasSnap = ok;
      if (ok) {
        this._snapR = r;
        this._snapC = c;
        const pv = this.opts.preview ? this.opts.preview(i, r, c) : null;
        this._snap.r = r;
        this._snap.c = c;
        st.snap = this._snap;
        st.rows = (pv && pv.rows) || EMPTY;
        st.cols = (pv && pv.cols) || EMPTY;
        this._hovering = true;
        if (this.opts.onHover) {
          this._hoverInfo.r = r;
          this._hoverInfo.c = c;
          this._hoverInfo.valid = pv ? !!pv.valid : true;
          this.opts.onHover(this._hoverInfo);
        }
      } else {
        st.snap = null;
        st.rows = EMPTY;
        st.cols = EMPTY;
        this._clearHover();
      }
    }
    st.x = x;
    st.y = y;
    this.renderer.setDrag(st);
  }
}
