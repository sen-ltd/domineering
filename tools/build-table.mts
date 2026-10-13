// Fold the raw run logs into src/table.json, the file the page and the tests read.
// H moving first on m×n is V moving first on the transposed n×m board, so every
// cell of the outcome chart is two V-first runs: (m, n) and (n, m).
// Usage: node tools/build-table.mts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { outcomeOf } from '../src/solver.ts';
import { bullockAny } from '../src/bullock.ts';

interface Run {
  rows: number;
  cols: number;
  flags: string[];
  vFirstWins: boolean | null;
  nodes: number;
  budgetExceeded: boolean;
  seconds: number;
}
const read = (f: string): Run[] =>
  existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const base = new Map<string, Run>();
for (const r of read('runs/table.jsonl')) if (r.flags.length === 0) base.set(`${r.rows}x${r.cols}`, r);

const cells = [];
for (const r of base.values()) {
  const t = base.get(`${r.cols}x${r.rows}`);
  const v = r.vFirstWins;
  const h = t ? t.vFirstWins : null;
  const outcome = v === null || h === null ? null : outcomeOf(v, h);
  cells.push({
    rows: r.rows,
    cols: r.cols,
    vFirstWins: v,
    hFirstWins: h,
    outcome,
    nodesV: r.nodes,
    nodesH: t?.nodes ?? null,
    secondsV: r.seconds,
    budgetV: r.budgetExceeded,
    bullock: bullockAny(r.rows, r.cols)?.value ?? null,
    bullockFrom: bullockAny(r.rows, r.cols)?.from ?? null,
  });
}
cells.sort((a, b) => a.rows - b.rows || a.cols - b.cols);

const ablation = [];
for (const r of read('runs/ablation.jsonl')) {
  const full = base.get(`${r.rows}x${r.cols}`);
  ablation.push({ rows: r.rows, cols: r.cols, flags: r.flags, vFirstWins: r.vFirstWins, nodes: r.nodes, seconds: r.seconds });
  if (full && !ablation.some((a) => a.rows === r.rows && a.cols === r.cols && a.flags.length === 0))
    ablation.push({ rows: r.rows, cols: r.cols, flags: [], vFirstWins: full.vFirstWins, nodes: full.nodes, seconds: full.seconds });
}
ablation.sort((a, b) => a.rows * a.cols - b.rows * b.cols || a.rows - b.rows || a.flags.length - b.flags.length);

const budget = Number(readFileSync('runs/jobs-table.txt', 'utf8').split('\n')[0].split(' ')[2]);
writeFileSync('src/table.json', JSON.stringify({ nodeBudget: budget, cells, ablation }, null, 1) + '\n');
const solved = cells.filter((c) => c.outcome);
const exact = solved.filter((c) => c.bullock && c.bullock.length === 1);
const agree = exact.filter((c) => c.bullock === c.outcome);
console.log(`${cells.length} boards, ${solved.length} with both orders solved, budget ${budget}`);
console.log(`Bullock: ${agree.length}/${exact.length} exact cells agree (${exact.filter((c) => c.bullockFrom === 'transposed').length} via transposition)`);
