// Rule-based "why was that bad" explanations. At club-beginner level almost
// every lost game comes down to a few patterns (hanging pieces, missed
// captures, forks, mates), and those can be detected exactly from the board
// plus the engine's best lines.

import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js'
import type { Color, Score, Tag } from './types'

export const VAL: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }
export const NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

export function playUci(chess: Chess, uci: string): Move {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' })
}

export function uciToSan(fen: string, uci: string): string {
  try {
    return playUci(new Chess(fen), uci).san
  } catch {
    return uci
  }
}

export function pvToSan(fen: string, pv: string[], max = 99): string[] {
  const c = new Chess(fen)
  const out: string[] = []
  for (const u of pv.slice(0, max)) {
    try {
      out.push(playUci(c, u).san)
    } catch {
      break
    }
  }
  return out
}

/** A line of SAN with move numbers, e.g. "14. Nf3 Bg4 15. h3". */
export function numbered(fen: string, sans: string[]): string {
  let [, turn, , , , full] = fen.split(' ')
  let n = +full
  let white = turn === 'w'
  const parts: string[] = []
  sans.forEach((s, i) => {
    if (white) parts.push(`${n}. ${s}`)
    else parts.push(i === 0 ? `${n}... ${s}` : s)
    if (!white) n++
    white = !white
  })
  return parts.join(' ')
}

const opp = (c: Color): Color => (c === 'w' ? 'b' : 'w')

/** Can this piece be won: attacked and either undefended or attacked by something cheaper? */
export function isHanging(chess: Chess, sq: Square): boolean {
  const p = chess.get(sq)
  if (!p) return false
  const attackers = chess.attackers(sq, opp(p.color))
  if (!attackers.length) return false
  const defenders = chess.attackers(sq, p.color)
  if (!defenders.length) return true
  const cheapest = Math.min(...attackers.map((s) => VAL[chess.get(s)!.type]))
  return cheapest < VAL[p.type]
}

/** Enemy pieces worth attacking that the piece on `sq` hits at once. */
function forkTargets(chess: Chess, sq: Square): PieceSymbol[] {
  const me = chess.get(sq)
  if (!me) return []
  const out: PieceSymbol[] = []
  for (const row of chess.board()) {
    for (const t of row) {
      if (!t || t.color === me.color) continue
      if (!chess.attackers(t.square, me.color).includes(sq)) continue
      if (t.type === 'k' || VAL[t.type] > VAL[me.type] || (t.type !== 'p' && !chess.attackers(t.square, t.color).length))
        out.push(t.type)
    }
  }
  return out
}

function both(ts: PieceSymbol[]) {
  const names = ts
    .sort((a, b) => VAL[b] - VAL[a])
    .slice(0, 2)
    .map((t) => NAME[t])
  return `${names[0]} and ${names[1]}`
}

function mateFor(s: Score | undefined, c: Color): number | null {
  if (!s || s.mate === undefined || s.mate === 0) return null
  const n = c === 'w' ? s.mate : -s.mate
  return n > 0 ? n : null
}

/**
 * Net material `c` gains along a line (first `plies` moves), plus the biggest
 * piece it loses or wins on the way.
 */
function materialSwing(fen: string, pv: string[], c: Color, plies: number) {
  const ch = new Chess(fen)
  let net = 0
  let lost: PieceSymbol | null = null
  let won: PieceSymbol | null = null
  for (const u of pv.slice(0, plies)) {
    let m: Move
    try {
      m = playUci(ch, u)
    } catch {
      break
    }
    if (m.captured) {
      const v = VAL[m.captured]
      if (m.color === c) {
        net += v
        if (!won || v > VAL[won]) won = m.captured
      } else {
        net -= v
        if (!lost || v > VAL[lost]) lost = m.captured
      }
    }
    if (m.promotion) net += (m.color === c ? 1 : -1) * (VAL[m.promotion] - 1)
  }
  return { net, lost, won }
}

export interface ExplainInput {
  fenBefore: string
  played: string // uci
  best: string[] // uci pv from fenBefore
  bestScore: Score
  reply: string[] // uci pv from the position after the played move
  afterScore: Score
  winBefore: number
  winAfter: number
}

export function explain(x: ExplainInput): { text: string; tag: Tag } {
  const before = new Chess(x.fenBefore)
  const c = before.turn()
  const bestSan = x.best.length ? uciToSan(x.fenBefore, x.best[0]) : ''
  const bestLine = numbered(x.fenBefore, pvToSan(x.fenBefore, x.best, 5))
  const better = bestSan ? ` Better was ${bestSan}.` : ''

  const after = new Chess(x.fenBefore)
  const m = playUci(after, x.played)
  const fenAfter = after.fen()
  const replyLine = numbered(fenAfter, pvToSan(fenAfter, x.reply, 5))

  const theyMate = mateFor(x.afterScore, opp(c))
  if (theyMate && !mateFor(x.bestScore, opp(c))) {
    return {
      tag: 'allowed-mate',
      text: `This lets your opponent checkmate you in ${theyMate}: ${replyLine}.${better}`,
    }
  }

  const iMate = mateFor(x.bestScore, c)
  if (iMate && !mateFor(x.afterScore, c)) {
    return { tag: 'missed-mate', text: `You had checkmate in ${iMate}! ${bestLine}.` }
  }

  // What does the opponent's best reply do?
  if (x.reply.length) {
    const r = new Chess(fenAfter)
    let rm: Move | null = null
    try {
      rm = playUci(r, x.reply[0])
    } catch {}
    if (rm?.captured) {
      const sq = rm.to
      const lost = NAME[rm.captured]
      const taker = NAME[rm.piece]
      if (isHanging(after, sq)) {
        if (sq === m.to && m.captured && VAL[m.captured] < VAL[m.piece]) {
          return {
            tag: 'bad-trade',
            text: `You took a ${NAME[m.captured]} with your ${NAME[m.piece]}, but ${rm.san} wins the ${NAME[m.piece]} back. That trade loses material.${better}`,
          }
        }
        if (sq === m.to) {
          const guarded = after.attackers(sq, c).length > 0
          return {
            tag: 'hung-piece',
            text: `Your ${lost} on ${sq} can be taken by the ${taker} (${rm.san})${guarded ? ', and the trade costs you material' : ' and nothing protects it'}.${better}`,
          }
        }
        const wasHanging = isHanging(before, sq)
        return {
          tag: 'hung-piece',
          text: wasHanging
            ? `Your ${lost} on ${sq} was under attack and you didn't deal with it. ${rm.san} takes it.${better}`
            : `This move left your ${lost} on ${sq} unprotected. ${rm.san} wins it.${better}`,
        }
      }
    }
    if (rm) {
      const ts = forkTargets(r, rm.to)
      if (ts.length >= 2) {
        return {
          tag: 'allowed-fork',
          text: `This walks into a fork: ${rm.san} attacks your ${both(ts)} at the same time.${better}`,
        }
      }
    }
  }

  // What did the best move do that the played move didn't?
  if (x.best.length) {
    const b = new Chess(x.fenBefore)
    const bm = playUci(b, x.best[0])
    if (bm.captured && (isHanging(before, bm.to) || VAL[bm.captured] > VAL[bm.piece])) {
      const free = !before.attackers(bm.to, opp(c)).length
      return {
        tag: 'missed-capture',
        text: `You could have won a ${NAME[bm.captured]}: ${bestSan} takes it${free ? ' for free' : ''}.`,
      }
    }
    const ts = forkTargets(b, bm.to)
    if (ts.length >= 2 && !isHanging(b, bm.to)) {
      return { tag: 'missed-fork', text: `${bestSan} would fork the ${both(ts)}. Look for moves that attack two things at once.` }
    }
  }

  // Short forced sequences: the opponent's best line wins material, or yours did.
  if (x.reply.length >= 2) {
    // Checked at two depths so a half-finished exchange doesn't count.
    const s = materialSwing(fenAfter, x.reply, c, 4)
    if (s.net <= -2 && s.lost && materialSwing(fenAfter, x.reply, c, 6).net <= -2) {
      return {
        tag: 'allowed-tactic',
        text: `This allows a tactic that wins your ${NAME[s.lost]}: ${replyLine}. Before moving, check your opponent's checks, captures and threats.${better}`,
      }
    }
  }
  if (x.best.length >= 2) {
    const s = materialSwing(x.fenBefore, x.best, c, 5)
    if (s.net >= 2 && s.won && materialSwing(x.fenBefore, x.best, c, 7).net >= 2) {
      return {
        tag: 'missed-tactic',
        text: `You had a tactic that wins a ${NAME[s.won]}: ${bestLine}.`,
      }
    }
  }

  const chances = `Your winning chances went from ${Math.round(x.winBefore)}% to ${Math.round(x.winAfter)}%.`
  const threat = replyLine ? ` Your opponent's best answer: ${replyLine}.` : ''
  return {
    tag: 'positional',
    text: `${chances}${better}${bestLine ? ` The engine's idea: ${bestLine}.` : ''}${threat}`,
  }
}

/** A piece sacrifice: the moved piece can be taken at a profit right after the move. */
export function isSacrifice(fenBefore: string, uci: string): boolean {
  const c = new Chess(fenBefore)
  const m = playUci(c, uci)
  if (VAL[m.piece] < 3 || m.piece === 'k') return false
  if (m.captured && VAL[m.captured] >= VAL[m.piece]) return false
  if (c.isCheck() && c.moves().length <= 2) return false
  return isHanging(c, m.to)
}
