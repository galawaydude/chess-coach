export type Color = 'w' | 'b'

/** Engine score, always from White's point of view. */
export interface Score {
  cp?: number
  mate?: number
}

export interface Line {
  score: Score
  pv: string[] // UCI moves
}

export interface PosEval {
  fen: string
  depth: number
  lines: Line[]
}

export type Cls =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'forced'

export type Phase = 'opening' | 'middlegame' | 'endgame'

export type Tag =
  | 'hung-piece'
  | 'missed-capture'
  | 'allowed-mate'
  | 'missed-mate'
  | 'allowed-fork'
  | 'missed-fork'
  | 'bad-trade'
  | 'allowed-tactic'
  | 'missed-tactic'
  | 'positional'

export interface MoveAnalysis {
  ply: number // 0-based index of the move in the game
  san: string
  uci: string
  color: Color
  fenBefore: string
  fenAfter: string
  evalAfter: Score // white POV, after the move
  bestUci: string
  bestSan: string
  bestLine: string[] // SAN, starting with the best move
  winBefore: number // mover's win %, with best play
  winAfter: number // mover's win %, after the played move
  accuracy: number
  cls: Cls
  phase: Phase
  explanation?: string
  tag?: Tag
}

export interface GameAnalysis {
  depth: number
  startEval: Score
  moves: MoveAnalysis[]
  accuracy: { w: number; b: number }
  opening?: { eco: string; name: string; lastBookPly: number }
}

export interface Player {
  username: string
  rating: number
  result: string
}

export interface Game {
  id: string
  url: string
  pgn: string
  endTime: number // ms
  timeClass: string
  timeControl: string
  rated: boolean
  white: Player
  black: Player
  user: string // lowercased username this game was fetched for
  userColor: Color
  result: 'win' | 'loss' | 'draw'
  ecoName?: string
  opening?: { eco: string; name: string }
  chesscomAccuracy?: { white: number; black: number }
  analysis?: GameAnalysis
  analyzedAt?: number
}

export interface Puzzle {
  id: string // `${gameId}:${ply}`
  gameId: string
  user: string
  ply: number
  fen: string
  color: Color
  playedSan: string
  bestUci: string
  bestSan: string
  cls: Cls
  phase: Phase
  tag?: Tag
  explanation?: string
  createdAt: number
  // spaced repetition
  box: number
  due: number
  attempts: number
  solves: number
}
