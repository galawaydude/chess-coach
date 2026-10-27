# Chess Coach

A personal chess coach for your chess.com games. It runs entirely in your browser: load your games, and Stockfish analyses every move locally, rates your accuracy, explains your mistakes in plain words, and turns them into puzzles you replay until they stick.

## What it does

**Game review**
- Accuracy for both players (Lichess's published formula; chess.com's is closed, so numbers differ a bit)
- Every move rated: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder
- Eval graph (click to jump), eval bar, opening name from the Lichess opening book
- Coloured arrows you can toggle: the move played (coloured by rating), the best move, the 2nd best, and the best next move or threat
- A plain-English reason for each bad move: hung a piece, walked into a fork, allowed a tactic or mate, missed a capture/fork/mate, bad trade
- Jump straight to your next mistake, keyboard: `←` `→` `Home` `End` `F` (flip)

**Coach**
- Every mistake, miss and blunder you make becomes a puzzle from your own game
- Find the move yourself. Wrong? It tells you *why*, shows the refutation, and lets you retry, take a hint, or see the answer
- Then keep playing the position out against Stockfish. Every move you make is graded. Go back to any move and try something else, and it branches
- Spaced repetition: puzzles you solve come back in 1, 2, 4, 8… days; ones you miss come back tomorrow

**Patterns**
- Accuracy and rating trends, mistakes per game by phase (opening / middlegame / endgame), your most common mistake types with a tip, and your openings with win rate and accuracy

**Practice board**
- "Play on from here" from any position in a game

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Type your chess.com username on the Games page and hit **Load games**. Everything (games, analysis, puzzle progress) is stored in your browser's IndexedDB.

`npm run build` produces a static site in `dist/`. Serve it with `npm run preview`, or any static host. To get the multi-threaded engine the host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; without them it falls back to single-threaded, which still works.

## Android

Download the APK from [Releases](https://github.com/galawaydude/chess-coach/releases), or build it yourself (see [STORE.md](STORE.md)):

```bash
npm run android:apk       # debug APK
npm run android:release   # signed release APK + AAB (needs the upload key)
```

Every push is built by GitHub Actions (debug APK as a build artifact). Pushing a tag like `v1.0.1` builds signed release files and attaches the APK to the GitHub release, once the signing secrets are set.

## How it's built

- **Svelte 5 + TypeScript + Vite.** Small and fast, no virtual DOM.
- **Stockfish 19 lite (WASM)**: a 1.7 MB download instead of ~99 MB for the full network, and still far stronger than any human.
  - Game analysis runs on a **pool of single-threaded engines**, one per CPU core minus one. Positions in a game are independent, so this scales almost linearly, which beats one multi-threaded engine at fixed depth. A typical game takes a few seconds at depth 14.
  - **Position cache** in IndexedDB keyed by position (not move order), so openings you play over and over are only analysed once, and transpositions hit the cache too.
  - The coach board uses a separate interactive engine (multi-threaded when the page is cross-origin isolated) that cancels stale searches, so it never queues up behind batch analysis.
  - Idle workers are shut down after a minute to free memory.
- **chessground** (Lichess's board) and **chess.js** for the rules.
- **Dexie** (IndexedDB) for storage.
- The opening book is built from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (`data-src/*.tsv`) by `scripts/prepare.mjs`, which also copies the engine files into `public/engine/`. It runs automatically before `dev` and `build`.

```
src/
  lib/
    engine.ts      Stockfish worker pool, interactive engine, position cache
    analysis.ts    per-move classification, phases, puzzles
    accuracy.ts    win %, move and game accuracy
    explain.ts     rule-based "why was that bad" explanations
    chesscom.ts    chess.com public API sync
    srs.ts         spaced repetition
  components/      Board, EvalBar, EvalGraph, LineChart, Trainer
  pages/           Games, Review, Coach, Play, Stats
```

## License

GPL-3.0, because it bundles Stockfish.
