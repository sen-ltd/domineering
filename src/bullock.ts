// Nathan Bullock, "Updated Game Theoretic Values for Domineering Boards"
// (webdocs.cs.ualberta.ca/~games/domineering/updated.html), transcribed cell by cell.
// Row m = number of rows, column n = number of columns. V = vertical (Left) wins,
// H = horizontal (Right) wins, 1 = first player wins, 2 = second player wins.
// Two-letter cells ("1h", "12", "2h", "1v") list the values still possible; "." = unknown.
export const BULLOCK: readonly string[][] = [
  ['2', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  ['V', '1', '1', 'H', 'V', '1', '1', 'H', 'V', '1', '1', 'H', '2', '1', '1', 'H', 'H', '1', '1', 'H', 'H', 'H', '1', 'H', 'H', 'H', '1', 'H', 'H', 'H'],
  ['V', '1', '1', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  ['V', 'V', 'V', '1', 'V', '1', 'V', 'H', 'V', 'H', 'V', 'H', '2', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  ['V', 'H', 'V', 'H', '2', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  ['V', '1', 'V', '1', 'V', '1', 'V', 'H', 'V', '1', '1', 'H', 'V', 'H', '.', 'H', '.', '1h', '1h', 'H', '.', 'H', '1h', 'H', '1h', 'H', '1h', 'H', '1h', 'H'],
  ['V', '1', 'V', 'H', 'V', 'H', '1', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  ['V', 'V', 'V', 'V', 'V', 'V', 'V', '1', 'V', 'H', 'V', '.', 'V', '.', '.', '2h', '.', '1h', '.', 'H', '.', '.', '.', '1h', '.', '.', '.', '.', '.', '.'],
  ['V', 'H', 'V', 'H', 'V', 'H', 'V', 'H', '1', 'H', '1h', 'H', '1h', 'H', '1h', 'H', '1h', 'H', '1h', 'H', '1h', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  ['V', '1', 'V', 'V', 'V', '1', 'V', 'V', 'V', '1', '.', '.', 'V', '.', '.', '.', '.', '.', '.', '2h', '.', '1h', '.', '.', '.', '1h', '.', '.', '.', '.'],
  ['V', '1', 'V', 'H', 'V', '1', 'V', 'H', '1v', '.', '12', 'H', '.', '1h', '1h', 'H', '.', '1h', '1h', 'H', '.', 'H', '1h', 'H', '.', 'H', '1h', 'H', '.', 'H'],
];

/** Bullock's entry for an m×n board, or null if outside the chart. */
export function bullock(rows: number, cols: number): string | null {
  return BULLOCK[rows - 1]?.[cols - 1] ?? null;
}

const TRANSPOSE: Record<string, string> = { V: 'H', H: 'V', '1': '1', '2': '2', h: 'v', v: 'h', '.': '.' };

/** A chart value with the roles of V and H swapped (the value of the transposed board). */
export function transposeValue(v: string): string {
  return [...v].map((ch) => TRANSPOSE[ch]).join('');
}

/**
 * Bullock's value for m×n, read from the chart directly or, for m > 11 where the
 * chart has no row, from its n×m cell with V and H swapped.
 */
export function bullockAny(rows: number, cols: number): { value: string; from: 'chart' | 'transposed' } | null {
  const direct = bullock(rows, cols);
  if (direct !== null) return { value: direct, from: 'chart' };
  const t = bullock(cols, rows);
  return t === null ? null : { value: transposeValue(t), from: 'transposed' };
}
