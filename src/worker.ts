// Web Worker: judge every legal move of the side to move, posting each verdict
// as soon as it is known. One Solver per request, so the transposition table
// built while refuting one move is reused for the next.
import { Solver, BudgetExceeded, type Player } from './solver';

export interface Request {
  id: number;
  rows: number;
  cols: number;
  occupied: number[];
  toMove: Player;
  budget: number;
}

export type Reply =
  | { id: number; type: 'move'; a: number; b: number; wins: boolean | null; nodes: number }
  | { id: number; type: 'done'; nodes: number };

self.onmessage = (ev: MessageEvent<Request>) => {
  const { id, rows, cols, occupied, toMove, budget } = ev.data;
  // 2^21 entries (about 35 MB) is plenty for boards of at most 36 cells
  const s = new Solver(rows, cols, { ttBits: 20 });
  for (const cell of occupied) s.block(Math.floor(cell / cols), cell % cols);
  const opp = (1 - toMove) as Player;
  const moves = s.moves(toMove);
  const perMove = Math.max(200_000, Math.floor(budget / Math.max(1, moves.length)));
  let total = 0;
  for (const m of moves) {
    s.play(m);
    const saved = s.saveBoard();
    const before = s.nodes;
    let wins: boolean | null = null;
    // the budget is per move, so one stubborn move cannot starve the others
    s.setBudget(s.nodes + perMove);
    try {
      wins = !s.wins(opp);
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      s.restoreBoard(saved);
    }
    s.undo(m);
    total += s.nodes - before;
    (self as unknown as Worker).postMessage({ id, type: 'move', a: m.a, b: m.b, wins, nodes: s.nodes - before } satisfies Reply);
  }
  (self as unknown as Worker).postMessage({ id, type: 'done', nodes: total } satisfies Reply);
};
