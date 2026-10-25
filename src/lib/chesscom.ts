import { db, getMeta, setMeta } from './db'
import { detectOpening } from './openings'
import { parseGame } from './analysis'
import type { Game, Player } from './types'

const API = 'https://api.chess.com/pub/player/'
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'])

interface RawGame {
  url: string
  uuid?: string
  pgn?: string
  end_time: number
  time_class: string
  time_control: string
  rated: boolean
  rules: string
  eco?: string
  accuracies?: { white: number; black: number }
  white: Player & { '@id'?: string }
  black: Player & { '@id'?: string }
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (r.status === 404) throw new Error('User not found on chess.com')
  if (!r.ok) throw new Error(`chess.com returned ${r.status}`)
  return r.json()
}

function toGame(raw: RawGame, user: string): Game | null {
  if (raw.rules !== 'chess' || !raw.pgn) return null
  const white = raw.white.username.toLowerCase() === user
  const me = white ? raw.white : raw.black
  const result = me.result === 'win' ? 'win' : DRAWS.has(me.result) ? 'draw' : 'loss'
  const eco = raw.eco?.split('/openings/')[1]?.replace(/-/g, ' ').replace(/\s\d+\.+.*$/, '')
  return {
    id: raw.uuid ?? raw.url,
    url: raw.url,
    pgn: raw.pgn,
    endTime: raw.end_time * 1000,
    timeClass: raw.time_class,
    timeControl: raw.time_control,
    rated: raw.rated,
    white: { username: raw.white.username, rating: raw.white.rating, result: raw.white.result },
    black: { username: raw.black.username, rating: raw.black.rating, result: raw.black.result },
    user,
    userColor: white ? 'w' : 'b',
    result,
    ecoName: eco,
    chesscomAccuracy: raw.accuracies,
  }
}

/**
 * Fetch the user's monthly archives, newest first, until `months` months have
 * been loaded. Finished months never change, so they're only downloaded once.
 */
export async function syncGames(username: string, months = 3, onStatus?: (s: string) => void) {
  const user = username.trim().toLowerCase()
  const { archives } = await get<{ archives: string[] }>(`${API}${encodeURIComponent(user)}/games/archives`)
  const done = new Set(await getMeta<string[]>(`archives:${user}`, []))
  const current = archives.at(-1)
  const wanted = archives.slice(-months).reverse()
  let added = 0
  for (const url of wanted) {
    if (done.has(url)) continue
    onStatus?.(`Downloading ${url.split('/games/')[1]}…`)
    const { games } = await get<{ games: RawGame[] }>(url)
    const parsed = games.map((g) => toGame(g, user)).filter((g): g is Game => !!g)
    const have = new Set((await db.games.bulkGet(parsed.map((g) => g.id))).filter(Boolean).map((g) => g!.id))
    const fresh = parsed.filter((g) => !have.has(g.id))
    for (const g of fresh) {
      try {
        const o = await detectOpening(parseGame(g.pgn).moves.map((m) => m.after))
        if (o) g.opening = { eco: o.eco, name: o.name }
      } catch {}
    }
    await db.games.bulkAdd(fresh)
    added += fresh.length
    // The newest month keeps getting games, so it's re-fetched until a newer one exists.
    if (url !== current) done.add(url)
  }
  await setMeta(`archives:${user}`, [...done])
  return { added, totalMonths: archives.length }
}
