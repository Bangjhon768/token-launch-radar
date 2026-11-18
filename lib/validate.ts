// lib/validate.ts — the board's invariants, checked in memory before main.ts writes anything.
//
// Every check here is one the gate runs on board.json, restated against the board in memory so a
// broken board stops the program with a message instead of a rejected entry. The checks are the
// gate's own: row count, ranks, order, one shared value, watchlist coverage, rows outside the
// watchlist, and farm steps. Nothing here reads a file and nothing here writes one; it only
// answers whether a board is one the gate will take.

import { isEarlyRankable, type BoardRow, type Snapshot } from './model.ts';

/** The gate's row bounds for board.json (competition.yaml). */
const MIN_ROWS = 100;
const MAX_ROWS = 4000;
/** The most an implied value may be (competition.yaml). */
const MAX_IMPLIED = 1e14;
/** The fewest board rows that must come from outside the watchlist (competition.yaml). */
const MIN_OUTSIDE_WATCHLIST = 60;
/** A farm plan's step count and step length, in characters (competition.yaml). */
const MIN_STEPS = 3;
const MAX_STEPS = 12;
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;

/** The board's first problem, or null when it passes every check. */
export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < MIN_ROWS || board.length > MAX_ROWS) {
    return `the board has ${board.length} rows, outside the ${MIN_ROWS}..${MAX_ROWS} the gate takes`;
  }
  const expected = expectedRows(snapshot);
  if (board.length !== expected) {
    return `the board has ${board.length} rows, but the snapshot's watchlist and early radar come to ${expected}`;
  }
  const watch = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (seen.has(row.slug)) return `the board ranks ${row.slug} twice`;
    seen.add(row.slug);
    const value = row.implied_value_usd;
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_IMPLIED) {
      return `${row.slug} has implied value ${value}`;
    }
    if (i > 0 && value > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} (${row.slug}) outranks row ${i} on implied value`;
    }
    const steps = farmStepIssue(row);
    if (steps !== null) return steps;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  let outside = 0;
  for (const row of board) if (!watch.has(row.slug)) outside++;
  if (outside < MIN_OUTSIDE_WATCHLIST) {
    return `only ${outside} board rows come from outside the watchlist, under the ${MIN_OUTSIDE_WATCHLIST} the gate takes`;
  }
  return null;
}

/** One row's farm plan problem, or null when the plan is inside the gate's bounds. */
function farmStepIssue(row: BoardRow): string | null {
  const steps = row.farm_steps;
  if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
    return `${row.slug} has ${steps.length} farm steps`;
  }
  for (const step of steps) {
    if (step.length < MIN_STEP_CHARS || step.length > MAX_STEP_CHARS) {
      return `${row.slug} has a farm step of ${step.length} characters`;
    }
  }
  return null;
}

/**
 * How many rows the board must hold: every watchlist slug the snapshot carries, plus every
 * other early-rankable pre-token protocol — the same set buildBoard chooses, counted here
 * independently so a board that drops or adds a row is caught before it is written.
 */
function expectedRows(snapshot: Snapshot): number {
  const inSnapshot = new Set(snapshot.protocols.map((p) => p.slug));
  const watch = new Set(snapshot.watchlist);
  let n = 0;
  for (const slug of watch) if (inSnapshot.has(slug)) n++;
  for (const p of snapshot.protocols) {
    if (!watch.has(p.slug) && isEarlyRankable(p)) n++;
  }
  return n;
}
