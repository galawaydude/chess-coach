// Turning an analysed game into coaching: move-by-move narration, a report by
// game phase, and prompts you can paste into Claude for a longer lesson.

import { Chess } from 'chess.js'
import { CLS_INFO } from './analysis'
import { describeMove, plainText, ref, sanLineRefs, numbered } from './explain'
import type { Cls, Game, MoveAnalysis, Phase, Puzzle, Tag } from './types'

export const TAGS: Record<Tag, { label: string; tip: string }> = {
  'hung-piece': { label: 'Left a piece hanging', tip: 'Before every move ask: after this, what can my opponent capture?' },
  'missed-capture': { label: 'Missed a free piece', tip: 'Every turn, look at what your opponent just left undefended.' },
  'allowed-mate': { label: 'Walked into checkmate', tip: 'Check your king’s safety: which checks can they give next move?' },
  'missed-mate': { label: 'Missed a checkmate', tip: 'Look at every check you have, every move. Checks first, then captures.' },
  'allowed-fork': { label: 'Walked into a fork', tip: 'Watch out for knights and queens that can attack two of your pieces.' },
  'missed-fork': { label: 'Missed a fork', tip: 'Look for squares where one piece attacks two enemy pieces.' },
  'allowed-tactic': { label: 'Allowed a tactic', tip: 'Before you move, list every check, capture and threat your opponent will have.' },
  'missed-tactic': { label: 'Missed a tactic', tip: 'Every move, scan for checks, captures and threats you can make. In that order.' },
  'ignored-threat': { label: 'Ignored a threat', tip: 'After every opponent move, ask: what is that move attacking?' },
  'allowed-pin': { label: 'Got pinned or skewered', tip: 'Avoid lining up your king or queen with other pieces on lines the enemy bishops, rooks and queen can reach.' },
  'missed-pin': { label: 'Missed a pin or skewer', tip: 'Look for enemy pieces lined up with their king or queen. Your bishops and rooks love that.' },
  'king-safety': { label: 'King safety', tip: 'Castle early, and don’t push the pawns in front of your castled king.' },
  'opening-principle': { label: 'Opening principles', tip: 'In the first 10 moves: knights and bishops out, control the centre, castle. Don’t move the queen or the same piece twice.' },
  'endgame-technique': { label: 'Endgame technique', tip: 'In endgames: activate your king, push passed pawns, and stop your opponent’s.' },
  'bad-trade': { label: 'Bad trade', tip: 'Count: what you take vs what you lose. A queen is worth 9 pawns.' },
  positional: { label: 'Weaker plan / slow move', tip: 'Develop pieces, castle early, and control the centre.' },
}

export const PHASE_TIPS: Record<Phase, string> = {
  opening:
    'Get your knights and bishops out, put a pawn in the centre, and castle by move 10. Don’t bring the queen out early or move the same piece twice.',
  middlegame:
    'Before every move, check: what are my opponent’s checks, captures and threats? Then look for loose (undefended) pieces on both sides.',
  endgame:
    'Bring your king into the game, push passed pawns, and when you’re ahead, trade pieces, not pawns.',
}

export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame']
export const BAD_CLS: Cls[] = ['mistake', 'miss', 'blunder']
const QUIET: Cls[] = ['best', 'excellent', 'good', 'book', 'forced']

export const moveLabel = (m: MoveAnalysis) => `${m.fenBefore.split(' ')[5]}${m.color === 'w' ? '.' : '...'} ${m.san}`

const article = (cls: Cls) => (['inaccuracy', 'excellent'].includes(cls) ? 'an' : 'a')

/** Is this a moment worth stopping at in a walkthrough? */
export function isKeyMoment(m: MoveAnalysis, mine: boolean): boolean {
  if (mine) return !QUIET.includes(m.cls)
  return BAD_CLS.includes(m.cls)
}

/**
 * Coach-style narration for one move. Text contains move references that
 * resolve against `m.fenBefore` / `m.uci` (see ExplainText).
 */
export function narrate(moves: MoveAnalysis[], i: number, mineColor: string, opening?: string): string {
  const m = moves[i]
  const me = m.color === mineColor
  const prev = moves[i - 1]
  const next = moves[i + 1]
  const R = ref('b', [m.uci])
  const B = ref('b', [m.bestUci])

  if (!me) {
    const does = describeMove(m.fenBefore, m.uci, 'opponent')
    let t = `Your opponent played ${R}${does ? `, which ${does}` : ''}.`
    if (BAD_CLS.includes(m.cls)) {
      t += ` That was ${article(m.cls)} ${CLS_INFO[m.cls].label.toLowerCase()}!`
      if (next && next.color === mineColor) {
        const n = ref('a', [next.bestUci])
        const nd = describeMove(m.fenAfter, next.bestUci)
        t += ` Your best answer was ${n}${nd ? `: it ${nd}` : ''}.`
        if (next.uci === next.bestUci) t += ' And you found it!'
        else if (BAD_CLS.includes(next.cls) || next.cls === 'inaccuracy') t += ' You missed it, so look closely at the next move.'
      }
    } else if (m.cls === 'inaccuracy') {
      t += ' Not their best, which gives you a small chance.'
    } else if (next && next.color === mineColor && BAD_CLS.includes(next.cls)) {
      t += ' Careful: your next move is where things went wrong.'
    }
    return t
  }

  const punish = prev && prev.color !== mineColor && BAD_CLS.includes(prev.cls) && m.uci !== m.bestUci
  const lead = punish ? 'Your opponent had just slipped up, and this was your chance. ' : ''
  switch (m.cls) {
    case 'book':
      return `You played ${R}: a normal opening move${opening ? ` in the ${opening}` : ''}.`
    case 'forced':
      return `${R} was your only legal move.`
    case 'brilliant':
      return `${R}!! A sacrifice that works, and it’s the engine’s top choice.`
    case 'great':
      return `${R}! The only good move here: everything else was clearly worse.`
    case 'best': {
      const d = describeMove(m.fenBefore, m.uci)
      return `${R} is the best move${d ? `: it ${d}` : ''}.`
    }
    case 'excellent':
      return `${R} is excellent, almost as good as ${B}.`
    case 'good': {
      const d = describeMove(m.fenBefore, m.bestUci)
      return `${lead}${R} is fine, but ${B} was a bit better${d ? `: it ${d}` : ''}.`
    }
    default:
      return `${lead}You played ${R}, ${article(m.cls)} ${CLS_INFO[m.cls].label.toLowerCase()}. ${m.explanation ?? `${B} was better.`}`
  }
}

export interface PhaseRow {
  phase: Phase
  moves: number
  accuracy: number
  bad: MoveAnalysis[]
  tip: string
}

/** How you did in each phase of one game, with the tip that fits your mistakes there. */
export function phaseReport(game: Game): PhaseRow[] {
  const mine = game.analysis?.moves.filter((m) => m.color === game.userColor) ?? []
  return PHASES.map((phase) => {
    const ms = mine.filter((m) => m.phase === phase)
    const bad = ms.filter((m) => BAD_CLS.includes(m.cls))
    const tags = new Map<Tag, number>()
    for (const m of bad) if (m.tag && m.tag !== 'positional') tags.set(m.tag, (tags.get(m.tag) ?? 0) + 1)
    const top = [...tags].sort((x, y) => y[1] - x[1])[0]?.[0]
    return {
      phase,
      moves: ms.length,
      accuracy: ms.length ? ms.reduce((s, m) => s + m.accuracy, 0) / ms.length : 0,
      bad,
      tip: top ? TAGS[top].tip : PHASE_TIPS[phase],
    }
  }).filter((r) => r.moves > 0)
}

// ---- prompts for Claude ----

function cleanPgn(game: Game): string {
  const c = new Chess()
  c.loadPgn(game.pgn)
  const sans = c.history()
  const start = c.history({ verbose: true })[0]?.before ?? new Chess().fen()
  return numbered(start, sans) + ` ${game.white.result === 'win' ? '1-0' : game.black.result === 'win' ? '0-1' : '1/2-1/2'}`
}

function moveNote(m: MoveAnalysis): string {
  const line = plainText(sanLineRefs(m.fenBefore, m.bestLine), m.fenBefore)
  const why = m.explanation ? plainText(m.explanation, m.fenBefore, m.uci) : ''
  return [
    `- **${moveLabel(m)}** (${m.phase}): ${CLS_INFO[m.cls].label}. Winning chances ${Math.round(m.winBefore)}% → ${Math.round(m.winAfter)}%. Best was **${m.bestSan}**${line ? ` (engine line: ${line})` : ''}.`,
    `  - Position before the move (FEN): \`${m.fenBefore}\``,
    why ? `  - My analyser says: ${why}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const ASK_RULES = `Keep it simple: I'm a beginner. Use move numbers and algebraic notation. If you suggest a line, make sure it's legal in the position (FENs are given); don't invent moves.`

export function gamePrompt(game: Game): string {
  const a = game.analysis!
  const me = game.userColor === 'w' ? game.white : game.black
  const opp = game.userColor === 'w' ? game.black : game.white
  const mine = a.moves.filter((m) => m.color === game.userColor)
  const bad = mine.filter((m) => BAD_CLS.includes(m.cls) || m.cls === 'inaccuracy')
  const chances = a.moves.filter((m, i) => m.color !== game.userColor && BAD_CLS.includes(m.cls) && a.moves[i + 1] && a.moves[i + 1].uci !== a.moves[i + 1].bestUci)
  const phases = phaseReport(game)

  return `You are a friendly, patient chess coach. I'm a beginner rated about ${me.rating} on chess.com and I want to get better. Teach me using this game I played.

## The game
- I played **${game.userColor === 'w' ? 'White' : 'Black'}** against ${opp.username} (${opp.rating}), ${game.timeClass} (${game.timeControl}). Result: I ${game.result === 'win' ? 'won' : game.result === 'loss' ? 'lost' : 'drew'} (${(game.result === 'win' ? opp : me).result}).
- Opening: ${a.opening?.name ?? game.opening?.name ?? 'unknown'}.
- Accuracy: me ${a.accuracy[game.userColor].toFixed(1)}%, opponent ${a.accuracy[game.userColor === 'w' ? 'b' : 'w'].toFixed(1)}%.

PGN:
\`\`\`
${cleanPgn(game)}
\`\`\`

## How I did by phase
${phases.map((p) => `- ${p.phase}: ${p.moves} moves, accuracy ${p.accuracy.toFixed(0)}%, ${p.bad.length} mistakes/blunders${p.bad.length ? ` (${p.bad.map(moveLabel).join(', ')})` : ''}`).join('\n')}

## My bad moves (Stockfish 19, depth ${a.depth})
${bad.length ? bad.map(moveNote).join('\n') : 'None worth mentioning.'}

## Chances I missed after my opponent's mistakes
${chances.length ? chances.map((m) => `- After ${moveLabel(m)} (${CLS_INFO[m.cls].label.toLowerCase()}), the best answer was ${a.moves[m.ply + 1].bestSan} but I played ${a.moves[m.ply + 1].san}.`).join('\n') : 'None.'}

## What I want from you
1. Walk me through the game like a coach. At each key moment, say what I probably missed and what a good player looks at in that position.
2. Go through each of my blunders and mistakes: why it was bad, what I should have played, and the habit that would have stopped me.
3. **Opening:** what to change about how I play this opening. Give me the main ideas and the first few moves to remember.
4. **Middlegame:** the plans and tactics I missed, and how to spot them next time.
5. **Endgame** (if the game got there): what I should have done.
6. Finish with the 3 most important things for me to practise this week.

${ASK_RULES}`
}

export function patternsPrompt(games: Game[], puzzles: Puzzle[]): string {
  const analysed = games.filter((g) => g.analysis)
  const mine = analysed.flatMap((g) => g.analysis!.moves.filter((m) => m.color === g.userColor).map((m) => ({ g, m })))
  const me = games[0] ? (games[0].userColor === 'w' ? games[0].white : games[0].black) : null
  const rec = { w: 0, d: 0, l: 0 }
  for (const g of games) rec[g.result === 'win' ? 'w' : g.result === 'draw' ? 'd' : 'l']++
  const avg = analysed.length ? analysed.reduce((s, g) => s + g.analysis!.accuracy[g.userColor], 0) / analysed.length : 0

  const phases = PHASES.map((p) => {
    const ms = mine.filter((x) => x.m.phase === p)
    const bad = ms.filter((x) => BAD_CLS.includes(x.m.cls)).length
    const acc = ms.length ? ms.reduce((s, x) => s + x.m.accuracy, 0) / ms.length : 0
    return `- ${p}: average move accuracy ${acc.toFixed(0)}%, ${analysed.length ? (bad / analysed.length).toFixed(1) : 0} mistakes/blunders per game`
  })

  const tags = new Map<Tag, number>()
  for (const { m } of mine) if (m.tag && BAD_CLS.includes(m.cls)) tags.set(m.tag, (tags.get(m.tag) ?? 0) + 1)
  const topTags = [...tags].sort((x, y) => y[1] - x[1]).slice(0, 8)

  const openings = new Map<string, { n: number; w: number; d: number; l: number }>()
  for (const g of games) {
    const name = (g.opening?.name ?? g.analysis?.opening?.name ?? g.ecoName ?? 'Unknown').split(':')[0]
    const k = `${name} (as ${g.userColor === 'w' ? 'White' : 'Black'})`
    const o = openings.get(k) ?? { n: 0, w: 0, d: 0, l: 0 }
    o.n++
    o[g.result === 'win' ? 'w' : g.result === 'draw' ? 'd' : 'l']++
    openings.set(k, o)
  }
  const topOpenings = [...openings].sort((x, y) => y[1].n - x[1].n).slice(0, 10)

  const blunders = mine
    .filter((x) => x.m.cls === 'blunder' || x.m.cls === 'miss')
    .sort((x, y) => y.g.endTime - x.g.endTime)
    .slice(0, 10)

  return `You are a friendly, patient chess coach. I'm a beginner${me ? ` rated about ${me.rating}` : ''} on chess.com. Below is a summary of my recent games, analysed with Stockfish. Build me a plan to improve.

## Overview
- ${games.length} games (${rec.w} wins, ${rec.d} draws, ${rec.l} losses), ${analysed.length} analysed.
- Average accuracy: ${avg.toFixed(1)}%.
- Puzzles from my own mistakes: ${puzzles.length}, of which ${puzzles.filter((p) => p.box >= 4).length} mastered.

## By phase
${phases.join('\n')}

## My most common mistakes
${topTags.length ? topTags.map(([t, n]) => `- ${TAGS[t].label}: ${n}`).join('\n') : '- Not enough data yet.'}

## My openings
${topOpenings.map(([k, o]) => `- ${k}: ${o.n} games, ${o.w}W ${o.d}D ${o.l}L`).join('\n')}

## Some of my recent blunders
${blunders.length ? blunders.map(({ m, g }) => `${moveNote(m)}\n  - Game vs ${(g.userColor === 'w' ? g.black : g.white).username}, I was ${g.userColor === 'w' ? 'White' : 'Black'}.`).join('\n') : 'None yet.'}

## What I want from you
1. Tell me the 2–3 biggest things holding me back, based on the data above.
2. **Blunders:** what my blunders have in common, and a simple thinking routine to use before every move.
3. **Opening:** which openings I should play as White and as Black at my level (simple, principled ones), with the first moves and main ideas. Tell me which of my current openings to keep or drop.
4. **Middlegame:** the tactics and plans I need to learn first, in order.
5. **Endgame:** the basic endgames I must know at my level.
6. A weekly training plan (about 30–45 minutes a day) using free resources.

${ASK_RULES}`
}
