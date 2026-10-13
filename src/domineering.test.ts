import { describe, it, expect } from 'vitest';
import { Solver, V, H, pairs, outcomeOf, type Player } from './solver';
import { BULLOCK, bullock, transposeValue } from './bullock';
import table from './table.json';

// Plain minimax, no table, no bounds, no ordering: the reference the solver is checked against.
function bruteWins(s: Solver, p: Player): boolean {
  for (const m of s.moves(p)) {
    s.play(m);
    const opp = bruteWins(s, (1 - p) as Player);
    s.undo(m);
    if (!opp) return true;
  }
  return false;
}

// Small deterministic PRNG so the random positions are the same on every run.
function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

function randomPosition(rows: number, cols: number, plies: number, rand: () => number): Solver {
  const s = new Solver(rows, cols, { ttBits: 10 });
  let p: Player = V;
  for (let k = 0; k < plies; k++) {
    const ms = s.moves(p);
    if (ms.length === 0) break;
    s.play(ms[Math.floor(rand() * ms.length)]);
    p = (1 - p) as Player;
  }
  return s;
}

function copyOf(s: Solver, opts: ConstructorParameters<typeof Solver>[2]): Solver {
  const t = new Solver(s.rows, s.cols, { ttBits: 12, ...opts });
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) if (s.occupied(r, c)) t.block(r, c);
  return t;
}

describe('pairs', () => {
  it('counts floor(run/2) over every run of set bits', () => {
    expect(pairs(0)).toBe(0);
    expect(pairs(0b1)).toBe(0);
    expect(pairs(0b11)).toBe(1);
    expect(pairs(0b111)).toBe(1);
    expect(pairs(0b1111)).toBe(2);
    expect(pairs(0b1101101)).toBe(2);
    expect(pairs((1 << 30) - 1)).toBe(15);
  });
});

describe('hand-checked games from the CGT literature', () => {
  it('1×1 is a second-player win, 1×n a win for H, n×1 for V', () => {
    expect(outcomeOf(new Solver(1, 1).wins(V), new Solver(1, 1).wins(H))).toBe('2');
    expect(outcomeOf(new Solver(1, 5).wins(V), new Solver(1, 5).wins(H))).toBe('H');
    expect(outcomeOf(new Solver(5, 1).wins(V), new Solver(5, 1).wins(H))).toBe('V');
  });
  it('2×2 = ±1 and 2×3 = {2 | −1/2} are both first-player wins', () => {
    expect(outcomeOf(new Solver(2, 2).wins(V), new Solver(2, 2).wins(H))).toBe('1');
    expect(outcomeOf(new Solver(2, 3).wins(V), new Solver(2, 3).wins(H))).toBe('1');
  });
  it('the 2×3 position after H plays a corner is {−1 | 0} = −1/2: V to move loses, H to move wins', () => {
    const s = new Solver(2, 3);
    s.play({ a: 0, b: 1 });
    expect(s.wins(V)).toBe(false);
    expect(s.wins(H)).toBe(true);
  });
});

describe('solver against plain minimax', () => {
  it('agrees on 600 random positions of boards up to 4×5', () => {
    const rand = rng(7);
    const shapes = [[3, 3], [3, 4], [4, 3], [4, 4], [2, 6], [4, 5], [5, 4]];
    for (let k = 0; k < 600; k++) {
      const [r, c] = shapes[k % shapes.length];
      const s = randomPosition(r, c, Math.floor(rand() * 5), rand);
      for (const p of [V, H] as Player[]) expect(copyOf(s, {}).wins(p)).toBe(bruteWins(s, p));
    }
  });
  it('the safe-move bound and the symmetry folding never change an answer', () => {
    const rand = rng(11);
    for (let k = 0; k < 150; k++) {
      const s = randomPosition(5, 5, Math.floor(rand() * 8), rand);
      for (const p of [V, H] as Player[]) {
        const ref = copyOf(s, { safeMoves: false, symmetry: false }).wins(p);
        expect(copyOf(s, { safeMoves: true, symmetry: false }).wins(p)).toBe(ref);
        expect(copyOf(s, { safeMoves: false, symmetry: true }).wins(p)).toBe(ref);
        expect(copyOf(s, {}).wins(p)).toBe(ref);
      }
    }
  });
  it('when the bound fires it is right: safe(o) ≥ max(p) means p loses, safe(p) > max(o) means p wins', () => {
    const rand = rng(23);
    let fired = 0;
    for (let k = 0; k < 400; k++) {
      const s = randomPosition(4, 5, 2 + Math.floor(rand() * 6), rand);
      for (const p of [V, H] as Player[]) {
        const o = (1 - p) as Player;
        if (s.safeMoves(o) >= s.maxMoves(p)) {
          fired++;
          expect(bruteWins(s, p)).toBe(false);
        } else if (s.safeMoves(p) > s.maxMoves(o)) {
          fired++;
          expect(bruteWins(s, p)).toBe(true);
        }
      }
    }
    expect(fired).toBeGreaterThan(50);
  });
  it('analyze() marks a winning move exactly when the position is won', () => {
    const rand = rng(5);
    for (let k = 0; k < 60; k++) {
      const s = randomPosition(4, 4, Math.floor(rand() * 4), rand);
      for (const p of [V, H] as Player[]) {
        const verdicts = copyOf(s, {}).analyze(p);
        expect(verdicts.some((v) => v.wins)).toBe(copyOf(s, {}).wins(p));
        for (const v of verdicts) {
          s.play(v.move);
          expect(v.wins).toBe(!bruteWins(s, (1 - p) as Player));
          s.undo(v.move);
        }
      }
    }
  });
});

describe('transposition', () => {
  it('H moving first on m×n is V moving first on n×m (every board up to 24 cells)', () => {
    for (let m = 1; m <= 12; m++)
      for (let n = 1; m * n <= 24 && n <= 12; n++) expect(new Solver(m, n).wins(H)).toBe(new Solver(n, m).wins(V));
  });
  it("Bullock's chart is consistent with it wherever both m×n and n×m appear", () => {
    let checked = 0;
    for (let m = 1; m <= BULLOCK.length; m++)
      for (let n = 1; n <= BULLOCK.length; n++) {
        const a = bullock(m, n)!;
        const b = bullock(n, m)!;
        expect(transposeValue(a)).toBe(b);
        checked++;
      }
    expect(checked).toBe(121);
  });
});

describe("reproducing Bullock's chart", () => {
  it('every board with at most 30 cells, solved from scratch here, matches', () => {
    for (let m = 1; m <= 11; m++)
      for (let n = 1; n <= 30 && m * n <= 30; n++) {
        const got = outcomeOf(new Solver(m, n).wins(V), new Solver(n, m).wins(V));
        expect(`${m}x${n}:${got}`).toBe(`${m}x${n}:${bullock(m, n)}`);
      }
  });
  it('every board solved by the batch run (src/table.json) matches or narrows the chart', () => {
    let exact = 0;
    for (const c of table.cells) {
      if (!c.outcome || !c.bullock || c.bullock === '.') continue;
      if (c.bullock.length === 1) {
        expect(`${c.rows}x${c.cols}:${c.outcome}`).toBe(`${c.rows}x${c.cols}:${c.bullock}`);
        exact++;
      } else expect(c.bullock.toUpperCase()).toContain(c.outcome);
    }
    expect(exact).toBe(140);
  });
});
