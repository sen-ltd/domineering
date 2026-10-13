import './style.css';
import { Solver, V, H, type Player, type Move } from './solver';
import type { Request, Reply } from './worker';
import table from './table.json';

const MAX_CELLS = 36;
const BUDGET = 40_000_000;
const CELL = 64;
const NAMES = ['V (vertical)', 'H (horizontal)'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $<HTMLElement>('board') as unknown as SVGSVGElement;
const statusEl = $('status');
const rowsSel = $<HTMLSelectElement>('rowsSel');
const colsSel = $<HTMLSelectElement>('colsSel');
const youSel = $<HTMLSelectElement>('youSel');
const firstSel = $<HTMLSelectElement>('firstSel');
const hintsBox = $<HTMLInputElement>('hints');

interface Verdict {
  move: Move;
  wins: boolean | null;
  nodes: number;
}

const params = new URLSearchParams(location.search);
let rows = clampSide(Number(params.get('r') ?? 5));
let cols = clampSide(Number(params.get('c') ?? 5));
if (rows * cols > MAX_CELLS) [rows, cols] = [5, 5];
let you: Player = params.get('you') === 'h' ? H : V;
let first: Player = params.get('first') === 'h' ? H : V;
let played: Move[] = [];
let board = new Solver(rows, cols);
let verdicts: Verdict[] = [];
let analysisDone = false;
let analysisNodes = 0;
let requestId = 0;
let hover: Move | null = null;
let worker = makeWorker();

function clampSide(n: number): number {
  return Number.isFinite(n) ? Math.min(8, Math.max(2, Math.round(n))) : 5;
}

function makeWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<Reply>) => onReply(ev.data);
  return w;
}

function toMove(): Player {
  return ((first + played.length) % 2) as Player;
}

function occupiedCells(): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (board.occupied(r, c)) out.push(r * cols + c);
  return out;
}

function newGame(moves: Move[] = []): void {
  board = new Solver(rows, cols);
  played = [];
  for (const m of moves) {
    if (!board.moves(toMove()).some((x) => x.a === m.a && x.b === m.b)) break;
    board.play(m);
    played.push(m);
  }
  startAnalysis();
}

function startAnalysis(): void {
  // a still-running search for the old position is useless: restart the worker
  worker.terminate();
  worker = makeWorker();
  requestId++;
  verdicts = board.moves(toMove()).map((move) => ({ move, wins: null, nodes: 0 }));
  analysisDone = verdicts.length === 0;
  analysisNodes = 0;
  render();
  if (verdicts.length === 0) return;
  const req: Request = { id: requestId, rows, cols, occupied: occupiedCells(), toMove: toMove(), budget: BUDGET };
  worker.postMessage(req);
}

function onReply(msg: Reply): void {
  if (msg.id !== requestId) return;
  if (msg.type === 'move') {
    const v = verdicts.find((x) => x.move.a === msg.a && x.move.b === msg.b);
    if (v) {
      v.wins = msg.wins;
      v.nodes = msg.nodes;
    }
    analysisNodes += msg.nodes;
  } else {
    analysisDone = true;
    if (toMove() !== you) setTimeout(computerMove, 350);
  }
  render();
}

function computerMove(): void {
  if (toMove() === you || verdicts.length === 0) return;
  const winning = verdicts.filter((v) => v.wins === true);
  const unknown = verdicts.filter((v) => v.wins === null);
  let pick: Verdict;
  if (winning.length) pick = winning[Math.floor(Math.random() * winning.length)];
  else if (unknown.length) pick = unknown[Math.floor(Math.random() * unknown.length)];
  // lost anyway: play the move that took the most work to refute
  else pick = verdicts.reduce((a, b) => (b.nodes > a.nodes ? b : a));
  play(pick.move);
}

function play(m: Move): void {
  board.play(m);
  played.push(m);
  hover = null;
  syncUrl();
  startAnalysis();
}

function undo(): void {
  // take back to the last position where it is your turn
  if (played.length === 0) return;
  const moves = played.slice(0, -1);
  if (moves.length > 0 && ((first + moves.length) % 2) !== you) moves.pop();
  newGame(moves);
  syncUrl();
}

function syncUrl(): void {
  const q = new URLSearchParams({ r: String(rows), c: String(cols), you: you ? 'h' : 'v', first: first ? 'h' : 'v' });
  if (played.length) q.set('moves', played.map((m) => `${m.a}-${m.b}`).join(','));
  if (!hintsBox.checked) q.set('hints', '0');
  history.replaceState(null, '', `?${q}`);
}

// ---------- rendering ----------

const NS = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>, parent: Element = svg): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

function cellXY(cell: number): [number, number] {
  return [(cell % cols) * CELL, Math.floor(cell / cols) * CELL];
}

function dominoRect(m: Move, cls: string, inset = 5): SVGElement {
  const [x1, y1] = cellXY(m.a);
  const [x2, y2] = cellXY(m.b);
  return el('rect', {
    x: Math.min(x1, x2) + inset,
    y: Math.min(y1, y2) + inset,
    width: Math.abs(x2 - x1) + CELL - 2 * inset,
    height: Math.abs(y2 - y1) + CELL - 2 * inset,
    rx: 10,
    class: cls,
  });
}

function playerOf(m: Move): Player {
  // boards are at least 2 wide, so a gap of one row can only be a vertical domino
  return m.b - m.a === cols ? V : H;
}

function render(): void {
  svg.setAttribute('viewBox', `-8 -8 ${cols * CELL + 16} ${rows * CELL + 16}`);
  svg.replaceChildren();
  el('rect', { x: -6, y: -6, width: cols * CELL + 12, height: rows * CELL + 12, rx: 12, class: 'frame' });
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cell = el('rect', { x: c * CELL + 2, y: r * CELL + 2, width: CELL - 4, height: CELL - 4, rx: 6, class: 'cell' });
      cell.dataset.cell = String(r * cols + c);
    }
  played.forEach((m, i) => {
    const p = playerOf(m);
    dominoRect(m, `domino ${p === V ? 'v' : 'h'}${i === played.length - 1 ? ' last' : ''}`);
  });

  const mover = toMove();
  const yourTurn = mover === you;
  if (yourTurn && hover) dominoRect(hover, `ghost ${you === V ? 'v' : 'h'}`);
  if (yourTurn && hintsBox.checked) {
    for (const v of verdicts) {
      const [x1, y1] = cellXY(v.move.a);
      const [x2, y2] = cellXY(v.move.b);
      const cx = (x1 + x2) / 2 + CELL / 2;
      const cy = (y1 + y2) / 2 + CELL / 2;
      el('circle', { cx, cy, r: 9, class: `mark ${v.wins === null ? 'unk' : v.wins ? 'win' : 'lose'}` });
    }
  }
  renderStatus();
  renderPosition();
}

function renderStatus(): void {
  const mover = toMove();
  statusEl.className = '';
  if (verdicts.length === 0) {
    const winner = (1 - mover) as Player;
    statusEl.textContent =
      winner === you ? `${NAMES[mover]} cannot move — you win.` : `You cannot place a ${you === V ? 'vertical' : 'horizontal'} domino — you lose.`;
    statusEl.className = winner === you ? 'good' : 'bad';
    return;
  }
  if (mover !== you) {
    statusEl.textContent = analysisDone ? 'Computer is moving…' : 'Computer is thinking…';
    return;
  }
  const won = verdicts.filter((v) => v.wins === true).length;
  const known = verdicts.filter((v) => v.wins !== null).length;
  if (!analysisDone) statusEl.textContent = `Your move. Judging your ${verdicts.length} moves… ${known} done.`;
  else if (won > 0) {
    statusEl.textContent = `Your move. You are winning: ${won} of your ${verdicts.length} moves keep the win.`;
    statusEl.className = 'good';
  } else if (known === verdicts.length) {
    statusEl.textContent = `Your move. Against perfect play every one of your ${verdicts.length} moves loses.`;
    statusEl.className = 'bad';
  } else statusEl.textContent = `Your move. No winning move found within the search budget.`;
}

function renderPosition(): void {
  const mover = toMove();
  const opp = (1 - mover) as Player;
  const won = verdicts.filter((v) => v.wins === true).length;
  const lost = verdicts.filter((v) => v.wins === false).length;
  const unk = verdicts.length - won - lost;
  const value =
    verdicts.length === 0 ? 'loses (no move)' : won > 0 ? 'wins' : unk === 0 ? 'loses' : analysisDone ? 'unknown (budget)' : '…';
  $('position').innerHTML = `
    <dl>
      <dt>board</dt><dd>${rows} × ${cols}${chartLabel(rows, cols)}</dd>
      <dt>to move</dt><dd>${NAMES[mover]}${mover === you ? ' — you' : ''}</dd>
      <dt>side to move</dt><dd>${value}</dd>
      <dt>its moves</dt><dd><span class="win-t">${won} win</span> · <span class="lose-t">${lost} lose</span>${unk ? ` · ${unk} open` : ''}</dd>
      <dt>nodes</dt><dd>${analysisNodes.toLocaleString('en-US')}</dd>
    </dl>
    <table class="bound">
      <tr><th></th><th>moves left (max)</th><th>safe moves</th></tr>
      <tr><td>V</td><td>${board.maxMoves(V)}</td><td>${board.safeMoves(V)}</td></tr>
      <tr><td>H</td><td>${board.maxMoves(H)}</td><td>${board.safeMoves(H)}</td></tr>
    </table>
    <p class="fine">${boundLine(mover, opp)}</p>`;
}

function boundLine(p: Player, o: Player): string {
  const sp = board.safeMoves(p);
  const mo = board.maxMoves(o);
  const so = board.safeMoves(o);
  const mp = board.maxMoves(p);
  if (mp === 0) return `${NAMES[p]} has no move left.`;
  if (so >= mp) return `Decided without search: ${NAMES[o]} has ${so} safe moves, enough to answer all ${mp} that ${NAMES[p]} could still make.`;
  if (sp > mo) return `Decided without search: ${NAMES[p]} has ${sp} safe moves, more than the ${mo} ${NAMES[o]} could still make.`;
  return `The safe-move bound does not decide this position (${NAMES[p]} needs safe &gt; ${mo}, ${NAMES[o]} needs safe ≥ ${mp}).`;
}

function chartLabel(r: number, c: number): string {
  const cell = table.cells.find((x) => x.rows === r && x.cols === c);
  if (!cell?.outcome) return '';
  const word = { V: 'V wins', H: 'H wins', '1': 'first player wins', '2': 'second player wins' }[cell.outcome];
  return ` <span class="fine">(empty board: ${word})</span>`;
}

function renderChart(): void {
  const maxR = 10;
  const maxC = 16;
  let html = '<table class="chart"><tr><th>m\\n</th>';
  for (let c = 1; c <= maxC; c++) html += `<th>${c}</th>`;
  html += '</tr>';
  for (let r = 1; r <= maxR; r++) {
    html += `<tr><th>${r}</th>`;
    for (let c = 1; c <= maxC; c++) {
      const cell = table.cells.find((x) => x.rows === r && x.cols === c);
      if (!cell) {
        html += '<td class="out"></td>';
        continue;
      }
      const o = cell.outcome ?? '';
      const cls = o ? `o${o}` : 'open';
      const title = o
        ? `${r}×${c}: ${o} — Bullock: ${cell.bullock ?? 'n/a'}`
        : `${r}×${c}: not solved within ${table.nodeBudget.toLocaleString('en-US')} nodes — Bullock: ${cell.bullock ?? 'n/a'}`;
      const pick = r * c <= MAX_CELLS && r >= 2 && c >= 2 ? ` data-r="${r}" data-c="${c}"` : '';
      html += `<td class="${cls}${pick ? ' pick' : ''}${r === rows && c === cols ? ' here' : ''}" title="${title}"${pick}>${o || '·'}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  const solved = table.cells.filter((c) => c.outcome);
  const exact = solved.filter((c) => c.bullock && c.bullock.length === 1);
  const agree = exact.filter((c) => c.bullock === c.outcome);
  const open = table.cells.filter((c) => !c.outcome);
  html += `<p class="fine">${solved.length} of the ${table.cells.length} boards up to 52 cells solved here for both first players;
    ${agree.length} of ${exact.length} match Bullock's chart exactly${open.length ? `; ${open.length} boards ran out of the ${(table.nodeBudget / 1e6).toFixed(0)}M-node budget (·)` : ''}.
    Click a board (≤ ${MAX_CELLS} cells) to play it.</p>`;
  $('chart').innerHTML = html;
}

// ---------- input ----------

function moveAt(ev: MouseEvent): Move | null {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  const c = Math.floor(p.x / CELL);
  const r = Math.floor(p.y / CELL);
  if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
  const legal = board.moves(you);
  const fx = p.x / CELL - c;
  const fy = p.y / CELL - r;
  // prefer the domino extending toward the half of the cell under the pointer
  const cands: Move[] =
    you === V
      ? fy < 0.5
        ? [{ a: (r - 1) * cols + c, b: r * cols + c }, { a: r * cols + c, b: (r + 1) * cols + c }]
        : [{ a: r * cols + c, b: (r + 1) * cols + c }, { a: (r - 1) * cols + c, b: r * cols + c }]
      : fx < 0.5
        ? [{ a: r * cols + c - 1, b: r * cols + c }, { a: r * cols + c, b: r * cols + c + 1 }]
        : [{ a: r * cols + c, b: r * cols + c + 1 }, { a: r * cols + c - 1, b: r * cols + c }];
  for (const m of cands) if (legal.some((x) => x.a === m.a && x.b === m.b)) return m;
  return null;
}

svg.addEventListener('mousemove', (ev) => {
  if (toMove() !== you) return;
  const m = moveAt(ev);
  if (m?.a !== hover?.a || m?.b !== hover?.b) {
    hover = m;
    render();
  }
});
svg.addEventListener('mouseleave', () => {
  hover = null;
  render();
});
svg.addEventListener('click', (ev) => {
  if (toMove() !== you) return;
  const m = moveAt(ev);
  if (m) play(m);
});

function fillSelect(sel: HTMLSelectElement, value: number): void {
  sel.innerHTML = '';
  for (let k = 2; k <= 8; k++) sel.add(new Option(String(k), String(k), false, k === value));
}

function applySize(r: number, c: number): void {
  if (r * c > MAX_CELLS) {
    statusEl.textContent = `${r} × ${c} has ${r * c} cells; the in-page solver is limited to ${MAX_CELLS}.`;
    fillSelect(rowsSel, rows);
    fillSelect(colsSel, cols);
    return;
  }
  rows = r;
  cols = c;
  fillSelect(rowsSel, rows);
  fillSelect(colsSel, cols);
  renderChart();
  newGame();
  syncUrl();
}

rowsSel.addEventListener('change', () => applySize(Number(rowsSel.value), cols));
colsSel.addEventListener('change', () => applySize(rows, Number(colsSel.value)));
youSel.addEventListener('change', () => {
  you = youSel.value === 'h' ? H : V;
  newGame();
  syncUrl();
});
firstSel.addEventListener('change', () => {
  first = firstSel.value === 'h' ? H : V;
  newGame();
  syncUrl();
});
hintsBox.addEventListener('change', () => {
  render();
  syncUrl();
});
$('newgame').addEventListener('click', () => {
  newGame();
  syncUrl();
});
$('undo').addEventListener('click', undo);
$('chart').addEventListener('click', (ev) => {
  const td = (ev.target as HTMLElement).closest('td.pick') as HTMLElement | null;
  if (td) applySize(Number(td.dataset.r), Number(td.dataset.c));
});

fillSelect(rowsSel, rows);
fillSelect(colsSel, cols);
youSel.value = you === H ? 'h' : 'v';
firstSel.value = first === H ? 'h' : 'v';
hintsBox.checked = params.get('hints') !== '0';
renderChart();
const initial = (params.get('moves') ?? '')
  .split(',')
  .filter(Boolean)
  .map((s) => s.split('-').map(Number))
  .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b))
  .map(([a, b]) => ({ a, b }));
newGame(initial);
