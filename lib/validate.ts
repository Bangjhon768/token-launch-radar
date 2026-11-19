// lib/validate.ts — the board's invariants, checked in memory before main.ts writes anything,
// and the files it wrote, checked back against that memory after.
//
// Every check here is one the gate runs on board.json, restated against the board in memory so a
// broken board stops the program with a message instead of a rejected entry. The checks are the
// gate's own: row count, ranks, order, one shared value, watchlist coverage, rows outside the
// watchlist, and farm steps. validateSnapshotShape checks the snapshot's own shape a second time
// after parsing, and validateOutputs reads the written board.json, data.js and dossier.json back
// and answers whether they carry exactly the board and radar the program built; nothing here
// writes a file.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DOSSIER_MAX_BYTES, DOSSIER_SCHEMA } from '../vendor/makefun-board.ts';
import { isEarlyRankable, type BoardRow, type RadarData, type Snapshot } from './model.ts';

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

/**
 * The snapshot's own shape, checked a second time after parsing: parseSnapshot refuses a
 * document that is not JSON or lacks its top-level fields, and this refuses one whose
 * protocols are not shaped the model can score — an empty slug or name, a negative TVL,
 * a chain that is an empty string, a listed_at that is not a YYYY-MM-DD date,
 * a slug listed twice, or a watchlist naming a slug the snapshot does not carry. A negative
 * market cap is not refused: the snapshot carries one (autofinance records -1, a data quirk
 * for an unknown cap) and the model scores it as recorded.
 */
export function validateSnapshotShape(snapshot: Snapshot): string | null {
  if (snapshot.protocols.length === 0) return 'the snapshot carries no protocols';
  if (snapshot.watchlist.length === 0) return 'the snapshot carries an empty watchlist';
  if (snapshot.floor_usd <= 0) return `the snapshot's floor_usd is ${snapshot.floor_usd}, not positive`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.as_of)) {
    return `the snapshot's as_of is ${snapshot.as_of}, not a YYYY-MM-DD date`;
  }
  const seen = new Set<string>();
  for (let i = 0; i < snapshot.protocols.length; i++) {
    const p = snapshot.protocols[i]!;
    if (p.slug.length === 0) return `protocol ${i} has an empty slug`;
    if (seen.has(p.slug)) return `the snapshot lists ${p.slug} twice`;
    seen.add(p.slug);
    if (p.name.length === 0) return `${p.slug} has an empty name`;
    if (p.tvl_usd < 0) return `${p.slug} has a negative TVL of ${p.tvl_usd}`;
    if (p.change_7d !== null && !Number.isFinite(p.change_7d)) {
      return `${p.slug} has a non-finite change_7d`;
    }
    if (p.mcap_usd !== null && !Number.isFinite(p.mcap_usd)) {
      return `${p.slug} has a non-finite mcap_usd`;
    }
    if (p.listed_at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(p.listed_at)) {
      return `${p.slug} has listed_at ${p.listed_at}, not a YYYY-MM-DD date`;
    }
    for (const chain of p.chains) {
      if (chain.length === 0) return `${p.slug} names an empty chain`;
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    return `the watchlist names ${missing.length} slug${missing.length === 1 ? '' : 's'} the snapshot does not carry: ${missing.slice(0, 5).join(', ')}`;
  }
  return null;
}

/** The dossier's byte cap (contracts/dossier.ts DOSSIER_MAX_BYTES): a dossier holds 4 MiB. */
const DOSSIER_LIMIT = DOSSIER_MAX_BYTES;

/**
 * The files main.ts just wrote, read back and checked against the board and radar in memory:
 * board.json must parse and carry exactly the board's rows, data.js must be the window.RADAR
 * assignment carrying exactly the radar, and dossier.json must be under the byte cap, parse,
 * and carry the dossier schema with at least one image and its dashboard text. The first
 * problem found is the answer; null means the output on disk is the output in memory.
 */
export function validateOutputs(outDir: string, board: BoardRow[], radar: RadarData): string | null {
  let boardText: string;
  try {
    boardText = readFileSync(join(outDir, 'board.json'), 'utf8');
  } catch {
    return 'board.json cannot be read back from the output directory';
  }
  let parsedBoard: unknown;
  try {
    parsedBoard = JSON.parse(boardText);
  } catch {
    return 'board.json does not parse as JSON after writing';
  }
  if (typeof parsedBoard !== 'object' || parsedBoard === null || Array.isArray(parsedBoard)) {
    return 'board.json is not a JSON object after writing';
  }
  const rows = (parsedBoard as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return 'board.json has no rows array after writing';
  if (JSON.stringify(rows) !== JSON.stringify(board)) {
    return `board.json's ${rows.length} rows differ from the ${board.length} rows in memory`;
  }

  let dataText: string;
  try {
    dataText = readFileSync(join(outDir, 'data.js'), 'utf8');
  } catch {
    return 'data.js cannot be read back from the output directory';
  }
  const prefix = 'window.RADAR=';
  if (!dataText.startsWith(prefix) || !dataText.endsWith(';\n')) {
    return 'data.js is not a window.RADAR assignment after writing';
  }
  let parsedRadar: unknown;
  try {
    parsedRadar = JSON.parse(dataText.slice(prefix.length, -2));
  } catch {
    return 'data.js does not parse as JSON after writing';
  }
  if (JSON.stringify(parsedRadar) !== JSON.stringify(radar)) {
    return 'data.js carries different radar data than the radar in memory';
  }

  let dossierSize: number;
  try {
    dossierSize = statSync(join(outDir, 'dossier.json')).size;
  } catch {
    return 'dossier.json cannot be read back from the output directory';
  }
  if (dossierSize >= DOSSIER_LIMIT) {
    return `dossier.json is ${dossierSize} bytes, over the ${DOSSIER_LIMIT} a dossier holds`;
  }
  let dossier: unknown;
  try {
    dossier = JSON.parse(readFileSync(join(outDir, 'dossier.json'), 'utf8'));
  } catch {
    return 'dossier.json does not parse as JSON after writing';
  }
  if (typeof dossier !== 'object' || dossier === null || Array.isArray(dossier)) {
    return 'dossier.json is not a JSON object after writing';
  }
  const doc = dossier as Record<string, unknown>;
  if (doc.schema !== DOSSIER_SCHEMA) {
    return `dossier.json carries schema ${String(doc.schema)}, not ${DOSSIER_SCHEMA}`;
  }
  if (!Array.isArray(doc.images) || doc.images.length === 0) {
    return 'dossier.json carries no images';
  }
  if (typeof doc.text !== 'string' || doc.text.length === 0) {
    return 'dossier.json carries no dashboard text';
  }
  return null;
}
