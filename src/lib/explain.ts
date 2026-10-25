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

// ---- clickable move references ----
// Explanations embed moves as ⟦ctx:uci,uci,...⟧: the last move of that sequence,
// played from the position before your move (b) or after it (a). The UI turns
// them into chips that show the move on a mini board.

export type RefCtx = 'a' | 'b'
export const REF_RE = /⟦([ab]):([a-h1-8qrbn,]+)⟧/g

export function ref(ctx: RefCtx, ucis: string[]): string {
  return ucis.length && ucis[ucis.length - 1] ? `⟦${ctx}:${ucis.join(',')}⟧` : ''
}

/** A numbered line ("14. Nf3 Bg4 15. h3") where every move is a reference. */
export function refLine(ctx: RefCtx, fen: string, pv: string[], max = 99): string {
  const n = pvToSan(fen, pv, max).length
  let [, turn, , , , full] = fen.split(' ')
  let num = +full
  let white = turn === 'w'
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const r = ref(ctx, pv.slice(0, i + 1))
    if (white) parts.push(`${num}. ${r}`)
    else parts.push(i === 0 ? `${num}... ${r}` : r)
    if (!white) num++
    white = !white
  }
  return parts.join(' ')
}

/** Same as refLine, from a line stored as SAN. */
export function sanLineRefs(fen: string, sans: string[]): string {
  const c = new Chess(fen)
  const ucis: string[] = []
  for (const s of sans) {
    try {
      ucis.push(c.move(s).lan)
    } catch {
      break
    }
  }
  return refLine('b', fen, ucis)
}

/** Resolve the position a reference starts from. */
export function refStart(ctx: RefCtx, fenBefore: string, played?: string): string | null {
  if (ctx === 'b') return fenBefore
  if (!played) return null
  try {
    const c = new Chess(fenBefore)
    playUci(c, played)
    return c.fen()
  } catch {
    return null
  }
}

/** Explanation with references turned back into plain SAN. */
export function plainText(text: string, fenBefore: string, played?: string): string {
  return text.replace(REF_RE, (_, ctx: RefCtx, list: string) => {
    const start = refStart(ctx, fenBefore, played)
    const ucis = list.split(',')
    return (start && pvToSan(start, ucis).at(-1)) || ucis.at(-1)!
  })
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

const FILES = 'abcdefgh'
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const ORTH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
const HOME: Record<Color, Partial<Record<PieceSymbol, string[]>>> = {
  w: { n: ['b1', 'g1'], b: ['c1', 'f1'] },
  b: { n: ['b8', 'g8'], b: ['c8', 'f8'] },
}

export function phaseOf(fen: string): 'opening' | 'middlegame' | 'endgame' {
  const [board, , , , , full] = fen.split(' ')
  const pieces = board.replace(/[^nbrqNBRQ]/g, '').length
  if (pieces <= 6) return 'endgame'
  if (+full <= 10 && pieces >= 12) return 'opening'
  return 'middlegame'
}

const sqAt = (f: number, r: number) => (FILES[f] + (r + 1)) as Square
const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8

/** Pin or skewer along a line from the slider on `from`. */
function lineAttack(chess: Chess, from: Square) {
  const p = chess.get(from)
  if (!p || !'bqr'.includes(p.type)) return null
  const dirs = [...(p.type !== 'r' ? DIAG : []), ...(p.type !== 'b' ? ORTH : [])]
  const f0 = FILES.indexOf(from[0])
  const r0 = +from[1] - 1
  for (const [df, dr] of dirs) {
    let f = f0 + df
    let r = r0 + dr
    let front: { type: PieceSymbol; sq: Square } | null = null
    while (onBoard(f, r)) {
      const sq = sqAt(f, r)
      const q = chess.get(sq)
      if (q) {
        if (q.color === p.color) break
        if (!front) front = { type: q.type, sq }
        else {
          const back = { type: q.type, sq }
          if (isHanging(chess, from)) break
          if (front.type !== 'p' && (back.type === 'k' || (VAL[back.type] > VAL[front.type] && VAL[back.type] > VAL[p.type])))
            return { kind: 'pin' as const, front, back }
          if ((front.type === 'k' || front.type === 'q') && VAL[front.type] > VAL[back.type] && VAL[back.type] >= VAL[p.type])
            return { kind: 'skewer' as const, front, back }
          break
        }
      }
      f += df
      r += dr
    }
  }
  return null
}

function isPassed(chess: Chess, sq: Square): boolean {
  const p = chess.get(sq)
  if (!p || p.type !== 'p') return false
  const f0 = FILES.indexOf(sq[0])
  const r0 = +sq[1] - 1
  const dir = p.color === 'w' ? 1 : -1
  for (let f = f0 - 1; f <= f0 + 1; f++) {
    for (let r = r0 + dir; r >= 0 && r < 8; r += dir) {
      if (!onBoard(f, r)) continue
      const q = chess.get(sqAt(f, r))
      if (q && q.type === 'p' && q.color !== p.color) return false
    }
  }
  return true
}

function hangingSquares(chess: Chess, c: Color): Square[] {
  const out: Square[] = []
  for (const row of chess.board()) for (const t of row) if (t && t.color === c && t.type !== 'k' && isHanging(chess, t.square)) out.push(t.square)
  return out
}

const undeveloped = (chess: Chess, c: Color) =>
  (['n', 'b'] as PieceSymbol[]).flatMap((t) => HOME[c][t]!.filter((s) => chess.get(s as Square)?.type === t && chess.get(s as Square)?.color === c))

function list(xs: string[]) {
  if (xs.length <= 1) return xs[0] ?? ''
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
}

/** Plain-words description of what a move does for the side making it. */
export function describeMove(fen: string, uci: string, pov: 'mover' | 'opponent' = 'mover'): string {
  // From the opponent's side: their pieces are "their", yours are "your".
  const own = pov === 'mover' ? 'your' : 'their'
  const foe = pov === 'mover' ? 'the' : 'your'
  const before = new Chess(fen)
  const c = before.turn()
  const after = new Chess(fen)
  let m: Move
  try {
    m = playUci(after, uci)
  } catch {
    return ''
  }
  const out: string[] = []
  const phase = phaseOf(fen)
  if (m.isKingsideCastle() || m.isQueensideCastle()) out.push(`castles ${own} king to safety`)
  else if (HOME[c][m.piece]?.includes(m.from)) out.push(`develops ${own} ${NAME[m.piece]}`)
  if (m.captured) out.push(`takes ${foe} ${NAME[m.captured]} on ${m.to}`)
  if (after.isCheck()) out.push('gives check')
  if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && phase !== 'endgame') out.push('claims the centre')
  if (m.piece === 'p' && isPassed(after, m.to)) out.push(`pushes ${own} passed pawn`)
  if (m.piece === 'k' && phase === 'endgame') out.push(`brings ${own} king into the game`)
  if (m.piece === 'r') {
    const file = m.to[0]
    let pawns = 0
    for (let r = 1; r <= 8; r++) if (after.get((file + r) as Square)?.type === 'p') pawns++
    if (!pawns && m.from[0] !== file) out.push(`puts ${own} rook on the open ${file}-file`)
  }
  // New attacks on things worth attacking.
  const hits: string[] = []
  for (const row of after.board()) {
    for (const t of row) {
      if (!t || t.color === c || t.type === 'k') continue
      if (!after.attackers(t.square, c).includes(m.to) || before.attackers(t.square, c).length) continue
      if (VAL[t.type] > VAL[m.piece] || isHanging(after, t.square)) hits.push(`${foe} ${NAME[t.type]} on ${t.square}`)
    }
  }
  if (hits.length) out.push(`attacks ${list(hits.slice(0, 2))}`)
  // Pieces it rescues.
  const saved = hangingSquares(before, c).filter((sq) => sq !== m.from && !isHanging(after, sq))
  if (saved.length) out.push(`protects ${own} ${NAME[before.get(saved[0])!.type]} on ${saved[0]}`)
  if (hangingSquares(before, c).includes(m.from) && !isHanging(after, m.to)) out.push(`moves ${own} ${NAME[m.piece]} out of danger`)
  return list(out)
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
  const bestSan = x.best.length ? ref('b', [x.best[0]]) : ''
  const bestLine = refLine('b', x.fenBefore, x.best, 5)
  const better = bestSan ? ` Better was ${bestSan}.` : ''
  const phase = phaseOf(x.fenBefore)
  const fullmove = +x.fenBefore.split(' ')[5]

  const after = new Chess(x.fenBefore)
  const m = playUci(after, x.played)
  const fenAfter = after.fen()
  const replyLine = refLine('a', fenAfter, x.reply, 5)
  const rmS = ref('a', x.reply.slice(0, 1))
  const mS = ref('b', [x.played])

  let bm: Move | null = null
  const b = new Chess(x.fenBefore)
  if (x.best.length) {
    try {
      bm = playUci(b, x.best[0])
    } catch {}
  }
  let rm: Move | null = null
  const r = new Chess(fenAfter)
  if (x.reply.length) {
    try {
      rm = playUci(r, x.reply[0])
    } catch {}
  }

  // ---- mates ----

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

  // ---- material lost or missed right away ----

  if (rm?.captured) {
    const sq = rm.to
    const lost = NAME[rm.captured]
    const taker = NAME[rm.piece]
    // Recapturing after an even trade (bishop for knight, etc.) isn't losing anything.
    const evenTrade = sq === m.to && !!m.captured && VAL[m.captured] >= VAL[m.piece]
    if (isHanging(after, sq) && !evenTrade) {
      if (sq === m.to && m.captured && VAL[m.captured] < VAL[m.piece]) {
        return {
          tag: 'bad-trade',
          text: `You took a ${NAME[m.captured]} with your ${NAME[m.piece]}, but ${rmS} wins the ${NAME[m.piece]} back. That trade loses material.${better}`,
        }
      }
      if (sq === m.to) {
        const guarded = after.attackers(sq, c).length > 0
        return {
          tag: 'hung-piece',
          text: `Your ${lost} on ${sq} can be taken by the ${taker} (${rmS})${guarded ? ', and the trade costs you material' : ' and nothing protects it'}.${better}`,
        }
      }
      const wasHanging = isHanging(before, sq)
      return {
        tag: 'hung-piece',
        text: wasHanging
          ? `Your ${lost} on ${sq} was under attack and you didn't deal with it. ${rmS} takes it.${better}`
          : `This move left your ${lost} on ${sq} unprotected. ${rmS} wins it.${better}`,
      }
    }
  }
  if (rm) {
    const ts = forkTargets(r, rm.to)
    if (ts.length >= 2) {
      return {
        tag: 'allowed-fork',
        text: `This walks into a fork: ${rmS} attacks your ${both(ts)} at the same time.${better}`,
      }
    }
  }

  if (bm) {
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

  // ---- short forced sequences ----

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

  // ---- threats ----

  // A piece of yours was in danger, the best move dealt with it, yours didn't.
  if (bm) {
    const danger = hangingSquares(before, c).filter((sq) => sq === m.from ? isHanging(after, m.to) : isHanging(after, sq))
    for (const sq of danger) {
      const savedByBest = bm.from === sq ? !isHanging(b, bm.to) : !isHanging(b, sq)
      if (!savedByBest) continue
      const piece = NAME[before.get(sq)!.type]
      return {
        tag: 'ignored-threat',
        text: `Your ${piece} on ${sq} is under attack and your move doesn't save it. ${bestSan} ${bm.from === sq ? 'moves it to safety' : 'protects it'}.`,
      }
    }
  }

  // The reply attacks something and you'll have to lose time (or material) dealing with it.
  if (rm) {
    const newly = hangingSquares(r, c).filter((sq) => !isHanging(after, sq))
    if (newly.length) {
      const piece = NAME[r.get(newly[0])!.type]
      return {
        tag: 'ignored-threat',
        text: `After your move, ${rmS} attacks your ${piece} on ${newly[0]}${newly.length > 1 ? ` and your ${NAME[r.get(newly[1])!.type]} on ${newly[1]}` : ''}, and you have to react instead of making progress.${better}`,
      }
    }
    const la = lineAttack(r, rm.to)
    if (la) {
      return {
        tag: 'allowed-pin',
        text:
          la.kind === 'pin'
            ? `This allows ${rmS}, pinning your ${NAME[la.front.type]} on ${la.front.sq} to your ${NAME[la.back.type]}${la.back.type === 'k' ? ' so it can’t move' : ''}.${better}`
            : `This allows ${rmS}, a skewer: your ${NAME[la.front.type]} has to move and the ${NAME[la.back.type]} behind it on ${la.back.sq} falls.${better}`,
      }
    }
  }
  if (bm) {
    const la = lineAttack(b, bm.to)
    if (la) {
      return {
        tag: 'missed-pin',
        text:
          la.kind === 'pin'
            ? `${bestSan} pins the ${NAME[la.front.type]} on ${la.front.sq} to the ${NAME[la.back.type]}. Pinned pieces are easy targets: attack them again.`
            : `${bestSan} is a skewer: the ${NAME[la.front.type]} has to move and you win the ${NAME[la.back.type]} on ${la.back.sq}.`,
      }
    }
  }

  // ---- king safety ----

  const kingSq = before.findPiece({ type: 'k', color: c })[0]
  if (bm && (bm.isKingsideCastle() || bm.isQueensideCastle()) && m.piece !== 'k') {
    return { tag: 'king-safety', text: `Castle! ${bestSan} gets your king out of the centre and connects your rooks. An uncastled king is a target.` }
  }
  if (m.piece === 'k' && !m.isKingsideCastle() && !m.isQueensideCastle() && phase !== 'endgame') {
    const rights = x.fenBefore.split(' ')[2]
    const hadRights = c === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights)
    return {
      tag: 'king-safety',
      text: hadRights
        ? `Moving your king gives up the right to castle and leaves it stuck in the middle.${better}`
        : `Walking your king around with this many pieces still on the board is dangerous.${better}`,
    }
  }
  if (m.piece === 'p' && kingSq && phase !== 'endgame' && Math.abs(FILES.indexOf(m.from[0]) - FILES.indexOf(kingSq[0])) <= 1 && (c === 'w' ? kingSq[1] === '1' : kingSq[1] === '8') && 'abcgh'.includes(kingSq[0]) && 'abcfgh'.includes(m.from[0])) {
    return { tag: 'king-safety', text: `Pushing the pawns in front of your castled king opens lines for the enemy pieces to attack it.${better}` }
  }

  // ---- opening principles ----

  if (phase === 'opening' && bm) {
    const bestDevelops = !!HOME[c][bm.piece]?.includes(bm.from) || bm.isKingsideCastle() || bm.isQueensideCastle()
    const home = undeveloped(before, c)
    if (m.piece === 'q' && fullmove <= 8 && bm.piece !== 'q') {
      return {
        tag: 'opening-principle',
        text: `Bringing your queen out this early lets your opponent chase it around while developing their pieces. ${bestSan} ${describeMove(x.fenBefore, x.best[0]) || 'is calmer'}.`,
      }
    }
    if ((m.piece === 'n' || m.piece === 'b') && !HOME[c][m.piece]!.includes(m.from) && home.length >= 2 && bestDevelops) {
      return {
        tag: 'opening-principle',
        text: `You moved the same piece twice while ${home.length} of your minor pieces are still at home. ${bestSan} ${describeMove(x.fenBefore, x.best[0])}. Try to bring out a new piece every move.`,
      }
    }
    if (m.piece === 'p' && 'abgh'.includes(m.from[0]) && bestDevelops) {
      return {
        tag: 'opening-principle',
        text: `Edge pawn moves like ${mS} don't help in the opening. ${bestSan} ${describeMove(x.fenBefore, x.best[0])}.`,
      }
    }
    if (bestDevelops && !HOME[c][m.piece]?.includes(m.from)) {
      return {
        tag: 'opening-principle',
        text: `${bestSan} ${describeMove(x.fenBefore, x.best[0])}. In the opening, develop your knights and bishops, control the centre, and castle before starting anything else.`,
      }
    }
  }

  // ---- endgame technique ----

  if (phase === 'endgame') {
    if (rm?.piece === 'p' && isPassed(r, rm.to)) {
      return {
        tag: 'endgame-technique',
        text: `Watch the passed pawn: after your move, ${rmS} pushes it closer to becoming a queen. ${bestSan ? `${bestSan} deals with it better.` : ''}`.trim(),
      }
    }
    if (bm?.piece === 'p' && isPassed(b, bm.to)) {
      return { tag: 'endgame-technique', text: `Passed pawns must be pushed! ${bestSan} brings it closer to queening.` }
    }
    if (bm?.piece === 'k' && m.piece !== 'k') {
      return {
        tag: 'endgame-technique',
        text: `In the endgame the king is a fighting piece. ${bestSan} brings it into the game.`,
      }
    }
  }

  // ---- fallback: say what the better move does ----

  const chances = `Your winning chances went from ${Math.round(x.winBefore)}% to ${Math.round(x.winAfter)}%.`
  const does = bm ? describeMove(x.fenBefore, x.best[0]) : ''
  const replyDoes = rm && x.reply.length ? describeMove(fenAfter, x.reply[0], 'opponent') : ''
  const parts = [
    does ? `${bestSan} was stronger: it ${does}.` : bestSan ? `${bestSan} was stronger.` : '',
    replyDoes ? `After your move, your opponent plays ${rmS}, which ${replyDoes}.` : '',
    chances,
    bestLine ? `The engine's idea: ${bestLine}.` : '',
  ]
  return { tag: 'positional', text: parts.filter(Boolean).join(' ') }
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
