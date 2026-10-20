// Copies the Stockfish engine into public/ and builds the opening book index.
// Runs automatically before `dev` and `build`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

// Lite engines only: ~1.7 MB each vs ~99 MB for the full net. Strong enough to
// find every mistake a human makes, and they load in a fraction of a second.
const engineDir = join(pub, 'engine');
mkdirSync(engineDir, { recursive: true });
for (const f of [
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
  'stockfish-19-lite.js',
  'stockfish-19-lite.wasm',
]) {
  copyFileSync(join(root, 'node_modules/stockfish/bin', f), join(engineDir, f));
}

// Opening book: position (EPD) -> [eco, name]. Keyed by position rather than
// move order so transpositions are recognised too.
const out = join(pub, 'openings.json');
if (!existsSync(out)) {
  const book = {};
  for (const letter of 'abcde') {
    const rows = readFileSync(join(root, 'data-src', `${letter}.tsv`), 'utf8').trim().split('\n').slice(1);
    for (const row of rows) {
      const [eco, name, pgn] = row.split('\t');
      const chess = new Chess();
      for (const tok of pgn.split(/\s+/)) {
        if (/^\d+\./.test(tok)) continue;
        chess.move(tok);
      }
      book[chess.fen().split(' ').slice(0, 4).join(' ')] = [eco, name];
    }
  }
  writeFileSync(out, JSON.stringify(book));
  console.log(`openings.json: ${Object.keys(book).length} positions`);
}
