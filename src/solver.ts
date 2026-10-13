// Domineering solver: exact win/loss for the player to move, on any m×n board
// with up to 52 cells (so that a position fits in one exactly-representable
// double for the transposition table).
//
// Player 0 = V (Left) places vertical dominoes, player 1 = H (Right) places
// horizontal ones; whoever cannot move loses (normal play).
//
// The board is kept twice, as bitmasks along both directions: lines[1] are the
// rows (bit = column), lines[0] are the columns (bit = row). A player's moves
// are adjacent free pairs in *its own* lines, so both players run the same
// code with the two arrays swapped.

export type Player = 0 | 1;
export const V: Player = 0;
export const H: Player = 1;

export interface Move {
  /** the two covered cells, as r * cols + c (a < b) */
  a: number;
  b: number;
}

export class BudgetExceeded extends Error {
  constructor() {
    super('node budget exceeded');
  }
}

/** Number of disjoint adjacent pairs that fit in the set bits of x (sum of floor(run/2)). */
export function pairs(x: number): number {
  let c = 0;
  while (x !== 0) {
    const b = x & -x;
    if (x & (b << 1)) {
      c++;
      x &= ~(b | (b << 1));
    } else x &= ~b;
  }
  return c;
}


export interface SolverOptions {
  /** stop with BudgetExceeded after this many nodes (default: unlimited) */
  nodeBudget?: number;
  /** use the safe-move bound at every node (default true) */
  safeMoves?: boolean;
  /** fold the four reflections into one TT entry (default true) */
  symmetry?: boolean;
  /** log2 of the number of TT buckets (default 22: 2^23 entries, about 140 MB) */
  ttBits?: number;
}

export class Solver {
  readonly rows: number;
  readonly cols: number;
  /** lines[p][i]: occupancy of player p's i-th line */
  readonly lines: [Int32Array, Int32Array];
  private readonly full: [number, number];
  // reflection weights per cell: identity, flip rows, mirror cols, both
  private readonly w: Float64Array[];
  private keys = [0, 0, 0, 0];
  // transposition table: two slots per bucket (depth-preferred + always-replace)
  private readonly ttKey: Float64Array;
  private readonly ttVal: Uint8Array;
  private readonly ttWork: Float64Array;
  private readonly ttMask: number;
  private history: [Float64Array, Float64Array];
  private moveBuf: Int32Array[] = [];
  private scoreBuf: Float64Array[] = [];
  nodes = 0;
  ttHits = 0;
  safeCuts = 0;
  private budget: number;
  private useSafe: boolean;
  private useSym: boolean;

  constructor(rows: number, cols: number, opts: SolverOptions = {}) {
    if (rows < 1 || cols < 1 || rows > 30 || cols > 30) throw new Error('board sides must be 1..30');
    if (rows * cols > 52) throw new Error('at most 52 cells');
    this.rows = rows;
    this.cols = cols;
    this.lines = [new Int32Array(cols), new Int32Array(rows)];
    this.full = [(1 << rows) - 1, (1 << cols) - 1];
    this.w = [];
    for (let t = 0; t < 4; t++) {
      const arr = new Float64Array(rows * cols);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const rr = t & 1 ? rows - 1 - r : r;
          const cc = t & 2 ? cols - 1 - c : c;
          arr[r * cols + c] = 2 ** (rr * cols + cc);
        }
      this.w.push(arr);
    }
    const size = 1 << (opts.ttBits ?? 22);
    this.ttKey = new Float64Array(size * 2).fill(-1);
    this.ttVal = new Uint8Array(size * 2);
    this.ttWork = new Float64Array(size * 2);
    this.ttMask = size - 1;
    this.history = [new Float64Array(rows * cols), new Float64Array(rows * cols)];
    this.budget = opts.nodeBudget ?? Infinity;
    this.useSafe = opts.safeMoves ?? true;
    this.useSym = opts.symmetry ?? true;
  }

  /** Change the node budget (counted against the running node total). */
  setBudget(limit: number): void {
    this.budget = limit;
  }

  /**
   * Copy of the board, to put back after a BudgetExceeded unwinds a search
   * half-way (the throw skips the undo steps; table entries stay valid).
   */
  saveBoard(): { lines: [Int32Array, Int32Array]; keys: number[] } {
    return { lines: [this.lines[0].slice(), this.lines[1].slice()], keys: this.keys.slice() };
  }

  restoreBoard(b: { lines: [Int32Array, Int32Array]; keys: number[] }): void {
    this.lines[0].set(b.lines[0]);
    this.lines[1].set(b.lines[1]);
    this.keys = b.keys.slice();
  }

  /** Is cell (r, c) covered? */
  occupied(r: number, c: number): boolean {
    return ((this.lines[1][r] >> c) & 1) === 1;
  }

  /** Mark a single cell as blocked (for non-rectangular shapes / setup). */
  block(r: number, c: number): void {
    if (this.occupied(r, c)) return;
    this.setCell(r * this.cols + c, true);
  }

  private setCell(cell: number, on: boolean): void {
    const r = (cell / this.cols) | 0;
    const c = cell - r * this.cols;
    const sign = on ? 1 : -1;
    this.lines[1][r] ^= 1 << c;
    this.lines[0][c] ^= 1 << r;
    for (let t = 0; t < 4; t++) this.keys[t] += sign * this.w[t][cell];
  }

  play(m: Move): void {
    this.setCell(m.a, true);
    this.setCell(m.b, true);
  }

  undo(m: Move): void {
    this.setCell(m.a, false);
    this.setCell(m.b, false);
  }

  /** Legal moves for player p, in board order. */
  moves(p: Player): Move[] {
    const own = this.lines[p];
    const full = this.full[p];
    const out: Move[] = [];
    for (let i = 0; i < own.length; i++) {
      const free = ~own[i] & full;
      let avail = free & (free >> 1);
      while (avail !== 0) {
        const j = 31 - Math.clz32(avail & -avail);
        avail &= avail - 1;
        out.push(this.cellsOf(p, i, j));
      }
    }
    out.sort((x, y) => x.a - y.a || x.b - y.b);
    return out;
  }

  private cellsOf(p: Player, i: number, j: number): Move {
    const n = this.cols;
    return p === V ? { a: j * n + i, b: (j + 1) * n + i } : { a: i * n + j, b: i * n + j + 1 };
  }

  /** Upper bound on how many more moves p can make (ignoring the opponent). */
  maxMoves(p: Player): number {
    const own = this.lines[p];
    const full = this.full[p];
    let s = 0;
    for (let i = 0; i < own.length; i++) s += pairs(~own[i] & full);
    return s;
  }

  /**
   * Moves p is guaranteed to get whatever the opponent does: disjoint pairs of
   * free cells that the opponent can never cover, because both neighbours
   * across the line are occupied or off the board.
   */
  safeMoves(p: Player): number {
    const own = this.lines[p];
    const full = this.full[p];
    const k = own.length;
    let s = 0;
    for (let i = 0; i < k; i++) {
      const prevFree = i > 0 ? ~own[i - 1] & full : 0;
      const nextFree = i + 1 < k ? ~own[i + 1] & full : 0;
      s += pairs(~own[i] & full & ~prevFree & ~nextFree);
    }
    return s;
  }

  private canonKey(p: Player): number {
    const k = this.keys;
    let m = k[0];
    if (this.useSym) {
      if (k[1] < m) m = k[1];
      if (k[2] < m) m = k[2];
      if (k[3] < m) m = k[3];
    }
    return m * 2 + p;
  }

  private slot(key: number): number {
    const lo = key % 4294967296;
    const hi = (key - lo) / 4294967296;
    const h = Math.imul((lo | 0) ^ Math.imul(hi | 0, 0x9e3779b1), 0x85ebca77);
    return ((h ^ (h >>> 15)) & this.ttMask) << 1;
  }

  /** Does the player to move (p) win with perfect play from here? */
  wins(p: Player, depth = 0): boolean {
    if (++this.nodes > this.budget) throw new BudgetExceeded();
    const o = (1 - p) as Player;

    if (this.useSafe) {
      // p moves first: p wins if its guaranteed moves outlast everything o could
      // ever do; p loses if o can answer every move p could ever make.
      const maxP = this.maxMoves(p);
      if (maxP === 0) return false;
      const safeO = this.safeMoves(o);
      if (safeO >= maxP) {
        this.safeCuts++;
        return false;
      }
      const maxO = this.maxMoves(o);
      const safeP = this.safeMoves(p);
      if (safeP > maxO) {
        this.safeCuts++;
        return true;
      }
    }

    const key = this.canonKey(p);
    const s = this.slot(key);
    if (this.ttKey[s] === key) {
      this.ttHits++;
      return this.ttVal[s] === 1;
    }
    if (this.ttKey[s + 1] === key) {
      this.ttHits++;
      return this.ttVal[s + 1] === 1;
    }

    // generate and order moves (history heuristic)
    while (this.moveBuf.length <= depth) {
      this.moveBuf.push(new Int32Array(this.rows * this.cols * 2));
      this.scoreBuf.push(new Float64Array(this.rows * this.cols * 2));
    }
    const buf = this.moveBuf[depth];
    const sc = this.scoreBuf[depth];
    const hist = this.history[p];
    const own = this.lines[p];
    const full = this.full[p];
    let cnt = 0;
    for (let i = 0; i < own.length; i++) {
      const free = ~own[i] & full;
      let avail = free & (free >> 1);
      while (avail !== 0) {
        const j = 31 - Math.clz32(avail & -avail);
        avail &= avail - 1;
        const code = (i << 5) | j;
        const a = p === V ? j * this.cols + i : i * this.cols + j;
        const score = hist[a];
        // insertion sort, descending score
        let q = cnt++;
        while (q > 0 && sc[q - 1] < score) {
          buf[q] = buf[q - 1];
          sc[q] = sc[q - 1];
          q--;
        }
        buf[q] = code;
        sc[q] = score;
      }
    }
    if (cnt === 0) return false;

    const before = this.nodes;
    let result = false;
    const other = this.lines[o];
    for (let q = 0; q < cnt; q++) {
      const code = buf[q];
      const i = code >> 5;
      const j = code & 31;
      const bits = 3 << j;
      const a = p === V ? j * this.cols + i : i * this.cols + j;
      const b = p === V ? a + this.cols : a + 1;
      own[i] |= bits;
      other[j] |= 1 << i;
      other[j + 1] |= 1 << i;
      for (let t = 0; t < 4; t++) this.keys[t] += this.w[t][a] + this.w[t][b];
      const sub = this.wins(o, depth + 1);
      own[i] &= ~bits;
      other[j] &= ~(1 << i);
      other[j + 1] &= ~(1 << i);
      for (let t = 0; t < 4; t++) this.keys[t] -= this.w[t][a] + this.w[t][b];
      if (!sub) {
        result = true;
        hist[a] += 1 + (this.rows * this.cols - depth) ** 2;
        break;
      }
    }

    // store: slot 0 keeps the larger subtree, slot 1 is always-replace
    const work = this.nodes - before;
    if (work >= this.ttWork[s]) {
      this.ttKey[s + 1] = this.ttKey[s];
      this.ttVal[s + 1] = this.ttVal[s];
      this.ttWork[s + 1] = this.ttWork[s];
      this.ttKey[s] = key;
      this.ttVal[s] = result ? 1 : 0;
      this.ttWork[s] = work;
    } else {
      this.ttKey[s + 1] = key;
      this.ttVal[s + 1] = result ? 1 : 0;
      this.ttWork[s + 1] = work;
    }
    return result;
  }

  /** Win/loss of every legal move for p: true = that move wins for p. */
  analyze(p: Player): { move: Move; wins: boolean }[] {
    const o = (1 - p) as Player;
    return this.moves(p).map((move) => {
      this.play(move);
      const w = !this.wins(o);
      this.undo(move);
      return { move, wins: w };
    });
  }
}

/** Outcome class of a position: who wins with V to move and with H to move. */
export type Outcome = 'V' | 'H' | '1' | '2';

export function outcomeOf(vFirstWins: boolean, hFirstWins: boolean): Outcome {
  if (vFirstWins && hFirstWins) return '1';
  if (!vFirstWins && !hFirstWins) return '2';
  return vFirstWins ? 'V' : 'H';
}

/** Does the vertical player win moving first on an empty m×n board? */
export function verticalFirstWins(rows: number, cols: number, opts: SolverOptions = {}): { wins: boolean; nodes: number } {
  const s = new Solver(rows, cols, opts);
  const wins = s.wins(V);
  return { wins, nodes: s.nodes };
}
