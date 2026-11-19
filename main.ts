// main.ts — the token launch radar's driver: one sealed snapshot in, one ranked board and one
// dashboard out.
//
//   node main.ts --input ../token-radar-01-kit/input/snapshot.json
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
//
// The input is the sealed snapshot (758 DefiLlama protocols as of 2026-11-14); the output is a
// directory with board.json, data.js, dashboard/ and screenshots/, plus the dossier.json the
// scorer compares byte for byte. The model lives in lib/model.ts, the gate's checks in
// lib/validate.ts, the dossier writer in vendor/makefun-board.ts; this file only drives them:
// read the snapshot, score it, check the board, write the files, check the files back.
//
// Nothing here is random and nothing reads the clock, so two runs over the same snapshot write
// the same bytes. A broken snapshot or a broken board stops the program with a message on
// stderr and a non-zero exit, before anything is submitted.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, dataScript, parseSnapshot, type Snapshot } from './lib/model.ts';
import { validateBoard, validateOutputs, validateSnapshotShape } from './lib/validate.ts';

/** The sealed snapshot's path when no --input is given (the sandbox mounts it here). */
const DEFAULT_INPUT = '/input/snapshot.json';
/** The output directory when MAKEFUN_OUTPUT_DIR is unset (the sandbox writes here). */
const DEFAULT_OUTPUT = '/output';
/** The dashboard source the judge reads, in UTF-8 bytes (competition.yaml). */
const TEXT_MAX_BYTES = 65536;

/** The command line's input path: --input <path>, --input=<path>, or a positional path. */
function parseInput(argv: string[]): string {
  let input: string | undefined;
  let positional: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--input') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--input needs a path after it');
      input = value;
    } else if (arg.startsWith('--input=')) {
      input = arg.slice('--input='.length);
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node main.ts [--input <snapshot.json>] [snapshot.json]\n');
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}`);
    } else if (positional === undefined) {
      positional = arg;
    }
  }
  return input ?? positional ?? DEFAULT_INPUT;
}

/** Stop with a message on stderr and a non-zero exit: a broken run must not look like a success. */
function fail(message: string): never {
  process.stderr.write(`main.ts: ${message}\n`);
  process.exit(1);
}

/** The directory this file lives in: dashboard/ and screenshots/ sit beside it. */
function scriptDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Read the snapshot file's text, or stop with a message that names the path. */
function readInput(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    fail(`cannot read the snapshot at ${path}`);
  }
}

/** Copy one directory tree into the output, or stop with a message that names it. */
function copyTree(from: string, to: string): void {
  try {
    cpSync(from, to, { recursive: true });
  } catch {
    fail(`cannot copy ${from} to ${to}`);
  }
}

function main(): void {
  let inputPath: string;
  try {
    inputPath = parseInput(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT;
  const root = scriptDir();

  let snapshot: Snapshot;
  try {
    snapshot = parseSnapshot(readInput(inputPath));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const shapeIssue = validateSnapshotShape(snapshot);
  if (shapeIssue !== null) fail(`snapshot shape: ${shapeIssue}`);

  const { board, radar } = buildRadar(snapshot);
  const boardIssue = validateBoard(board, snapshot);
  if (boardIssue !== null) fail(`board: ${boardIssue}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`, 'utf8');
  writeFileSync(join(outDir, 'data.js'), dataScript(radar), 'utf8');
  copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
  copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
  let dossier: Uint8Array;
  try {
    dossier = buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const outputIssue = validateOutputs(outDir, board, radar);
  if (outputIssue !== null) fail(`output: ${outputIssue}`);

  process.stdout.write(
    `wrote ${board.length} rows (${radar.watchlist_size} watchlist, ${radar.early_size} early) to ${outDir} (dossier ${dossier.length} bytes)\n`,
  );
}

main();
