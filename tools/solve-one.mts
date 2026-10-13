// Solve one empty board with the vertical player moving first and print one
// JSON line. Usage: node tools/solve-one.mts <rows> <cols> <nodeBudget> [nosafe] [nosym]
import { Solver, V, BudgetExceeded } from '../src/solver.ts';

const [rows, cols, budget] = process.argv.slice(2, 5).map(Number);
const flags = process.argv.slice(5);
const s = new Solver(rows, cols, {
  nodeBudget: budget,
  safeMoves: !flags.includes('nosafe'),
  symmetry: !flags.includes('nosym'),
});
const t0 = performance.now();
let wins: boolean | null = null;
try {
  wins = s.wins(V);
} catch (e) {
  if (!(e instanceof BudgetExceeded)) throw e;
}
console.log(
  JSON.stringify({
    rows,
    cols,
    flags,
    vFirstWins: wins,
    nodes: Math.min(s.nodes, budget),
    budgetExceeded: wins === null,
    seconds: +((performance.now() - t0) / 1000).toFixed(2),
  }),
);
