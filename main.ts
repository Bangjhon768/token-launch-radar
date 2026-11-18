// main.ts — the token launch radar's entrypoint (Node 22, standard library only).
//
// Reads one sealed DefiLlama snapshot, ranks its pre-token protocols by implied token value
// (lib/model.ts, radar-2), checks the board against the gate's invariants (lib/validate.ts),
// and writes the entry's output: board.json, data.js and dossier.json, with dashboard/ and
// screenshots/ copied alongside so the dossier is built from exactly what ships.
//
//   node main.ts --input <snapshot.json>
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts --input <snapshot.json>
//
// The input defaults to /input/snapshot.json and the output to /output, the sandbox's paths;
// locally both are given on the command line. The run is deterministic: the same snapshot
// always writes the same bytes, so the sandbox's two runs agree.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, dataScript, parseSnapshot, MODEL } from './lib/model.ts';
import { validateBoard } from './lib/validate.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The dossier's text cap in UTF-8 bytes (competition.yaml). */
const TEXT_MAX_BYTES = 65536;

/** The input's path from --input, or the sandbox's sealed snapshot when it is not given. */
function inputPath(argv: string[]): string {
  let positional: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--input') {
      if (i + 1 >= argv.length) throw new Error('--input needs a path');
      return argv[i + 1]!;
    }
    if (arg.startsWith('--input=')) return arg.slice('--input='.length);
    if (arg.startsWith('--input')) return arg.slice('--input'.length);
    if (!arg.startsWith('-') && positional === null) positional = arg;
  }
  return positional ?? '/input/snapshot.json';
}

/** The output directory from the environment, or the sandbox's /output. */
function outputDir(): string {
  return resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

function main(): void {
  const input = resolve(inputPath(process.argv.slice(2)));
  const out = outputDir();
  const root = dirname(fileURLToPath(import.meta.url));
  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot, MODEL);
  const issue = validateBoard(board, snapshot);
  if (issue !== null) {
    console.error(`main.ts: board invalid: ${issue}`);
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`, 'utf8');
  writeFileSync(join(out, 'data.js'), dataScript(radar), 'utf8');
  cpSync(join(root, 'dashboard'), join(out, 'dashboard'), { recursive: true });
  cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });
  const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
  writeFileSync(join(out, 'dossier.json'), dossier);
  console.log(`main.ts: ${board.length} rows, ${radar.live_size} live, dossier ${dossier.length} bytes -> ${out}`);
}

try {
  main();
} catch (err) {
  console.error(`main.ts: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
