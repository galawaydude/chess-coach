import { Chess } from 'chess.js'
import { analyseCached } from './engine'
import { gameAccuracy, moveAccuracy, winFor, winPct } from './accuracy'
import { explain, isSacrifice, numbered, phaseOf, pvToSan, uciToSan } from './explain'
import { detectOpening } from './openings'
import { db } from './db'
import type { Cls, Color, Game, GameAnalysis, MoveAnalysis, PosEval, Puzzle, Score } from './types'

/** Bump when classification or explanations change; older analyses get redone (mostly from cache). */
export const ANALYSIS_VERSION = 5

export const isCurrent = (g: Game) => g.analysis?.version === ANALYSIS_VERSION

export const CLS_INFO: Record<Cls, { label: string; glyph: string; color: string }> = {
  brilliant: { label: 'Brilliant', glyph: '!!', color: '#1baca6' },
  great: { label: 'Great', glyph: '!', color: '#3d7fbf' },
  best: { label: 'Best', glyph: '★', color: '#5c9a2e' },
  excellent: { label: 'Excellent', glyph: '👍', color: '#7aa73f' },
  good: { label: 'Good', glyph: '✓', color: '#8a9a6a' },
  book: { label: 'Book', glyph: '📖', color: '#a88865' },
  forced: { label: 'Forced', glyph: '→', color: '#8a8a8a' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', color: '#d9a400' },
  mistake: { label: 'Mistake', glyph: '?', color: '#e07b1f' },
  miss: { label: 'Miss', glyph: '✗', color: '#d65f5f' },
  blunder: { label: 'Blunder', glyph: '??', color: '#c62828' },
}

export const BAD: Cls[] = ['inaccuracy', 'mistake', 'miss', 'blunder']
export { phaseOf }
export const PUZZLE_CLS: Cls[] = ['mistake', 'miss', 'blunder']

/** Classify a move from the mover's win % before (best play) and after. */
export function classify(drop: number): Cls {
  if (drop < 2) return 'excellent'
  if (drop < 5) return 'good'
  if (drop < 10) return 'inaccuracy'
  if (drop < 20) return 'mistake'
  return 'blunder'
}

function terminalEval(chess: Chess): PosEval | null {
  if (chess.isCheckmate()) {
    const cp = chess.turn() === 'w' ? -10000 : 10000
    return { fen: chess.fen(), depth: 0, lines: [{ score: { cp }, pv: [] }] }
  }
  if (chess.isGameOver()) return { fen: chess.fen(), depth: 0, lines: [{ score: { cp: 0 }, pv: [] }] }
  return null
}

export function parseGame(pgn: string) {
  const chess = new Chess()
  chess.loadPgn(pgn)
  const moves = chess.history({ verbose: true })
  const startFen = moves[0]?.before ?? chess.fen()
  return { moves, startFen }
}

export async function analyseGame(game: Game, depth: number, onProgress?: (done: number, total: number) => void) {
  const { moves, startFen } = parseGame(game.pgn)
  const fens = [startFen, ...moves.map((m) => m.after)]
  let done = 0
  const evals = await Promise.all(
    fens.map(async (fen) => {
      const t = terminalEval(new Chess(fen))
      const e = t ?? (await analyseCached(fen, depth, 2))
      onProgress?.(++done, fens.length)
      return e
    }),
  )
  const opening = await detectOpening(fens.slice(1))
  const score = (i: number): Score => evals[i].lines[0]?.score ?? { cp: 0 }

  const out: MoveAnalysis[] = moves.map((m, i) => {
    const c = m.color as Color
    const evB = evals[i]
    const best = evB.lines[0]
    const bestUci = best?.pv[0] ?? m.lan
    const winBefore = winFor(score(i), c)
    const winAfter = winFor(score(i + 1), c)
    const isBest = m.lan === bestUci
    const drop = isBest ? 0 : Math.max(0, winBefore - winAfter)
    const legal = new Chess(m.before).moves().length

    let cls: Cls
    if (legal === 1) cls = 'forced'
    else if (opening && i <= opening.lastBookPly && drop < 5) cls = 'book'
    else if (isBest || drop < 0.5) {
      cls = 'best'
      const second = evB.lines[1]
      if (second && winBefore > 25 && winBefore < 95) {
        if (drop < 2 && winAfter >= 50 && isSacrifice(m.before, m.lan)) cls = 'brilliant'
        else if (winBefore - winFor(second.score, c) >= 15 && !(i > 0 && moves[i - 1].captured && moves[i - 1].to === m.to))
          // (taking back a piece that was just captured is obvious, not "great")
          cls = 'great'
      }
    } else cls = classify(drop)

    const a: MoveAnalysis = {
      ply: i,
      san: m.san,
      uci: m.lan,
      color: c,
      fenBefore: m.before,
      fenAfter: m.after,
      evalAfter: score(i + 1),
      bestUci,
      secondUci: evB.lines[1]?.pv[0],
      bestSan: uciToSan(m.before, bestUci),
      bestLine: pvToSan(m.before, best?.pv ?? [], 6),
      winBefore,
      winAfter,
      accuracy: isBest ? 100 : moveAccuracy(winBefore, winAfter),
      cls,
      phase: phaseOf(m.before),
    }
    if (BAD.includes(cls)) {
      const ex = explain({
        fenBefore: m.before,
        played: m.lan,
        best: best?.pv ?? [],
        bestScore: score(i),
        reply: evals[i + 1].lines[0]?.pv ?? [],
        afterScore: score(i + 1),
        winBefore,
        winAfter,
      })
      a.explanation = ex.text
      a.tag = ex.tag
    }
    return a
  })

  // A "miss": the opponent just made a mistake and you didn't punish it, or you
  // had a forced mate and let it go. Only when you didn't end up worse off.
  out.forEach((a, i) => {
    if (a.cls !== 'mistake' && a.cls !== 'blunder') return
    const prev = out[i - 1]
    const punished = prev && (prev.cls === 'mistake' || prev.cls === 'blunder')
    const hadMate = a.tag === 'missed-mate'
    if ((punished || hadMate) && a.winAfter >= 45) a.cls = 'miss'
  })

  const analysis: GameAnalysis = {
    version: ANALYSIS_VERSION,
    depth,
    startEval: score(0),
    moves: out,
    accuracy: gameAccuracy(
      fens.map((_, i) => winPct(score(i))),
      startFen.split(' ')[1] as Color,
    ),
    opening,
  }
  await db.games.update(game.id, { analysis, analyzedAt: Date.now() })
  await makePuzzles(game, analysis)
  return analysis
}

async function makePuzzles(game: Game, a: GameAnalysis) {
  const ps: Puzzle[] = a.moves
    .filter((m) => m.color === game.userColor && PUZZLE_CLS.includes(m.cls))
    .map((m) => ({
      id: `${game.id}:${m.ply}`,
      gameId: game.id,
      user: game.user,
      ply: m.ply,
      fen: m.fenBefore,
      color: m.color,
      playedSan: m.san,
      bestUci: m.bestUci,
      bestSan: m.bestSan,
      cls: m.cls,
      phase: m.phase,
      tag: m.tag,
      explanation: m.explanation,
      createdAt: Date.now(),
      box: 0,
      due: Date.now(),
      attempts: 0,
      solves: 0,
    }))
  const old = await db.puzzles.bulkGet(ps.map((p) => p.id))
  // Keep spaced-repetition progress on puzzles that already exist; refresh their text.
  await db.puzzles.bulkPut(
    ps.map((p, i) => {
      const o = old[i]
      return o ? { ...p, box: o.box, due: o.due, attempts: o.attempts, solves: o.solves, createdAt: o.createdAt } : p
    }),
  )
}

export { numbered }
