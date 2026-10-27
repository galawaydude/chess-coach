import Dexie, { type EntityTable } from 'dexie'
import type { Game, Line, Puzzle } from './types'

export interface CachedEval {
  key: string
  depth: number
  lines: Line[]
}

export interface Meta {
  key: string
  value: unknown
}

export const db = new Dexie('chess-coach') as Dexie & {
  games: EntityTable<Game, 'id'>
  puzzles: EntityTable<Puzzle, 'id'>
  evals: EntityTable<CachedEval, 'key'>
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  games: 'id, user, endTime, [user+endTime]',
  puzzles: 'id, user, gameId, due, [user+due]',
  evals: 'key',
  meta: 'key',
})

// v2: game ids are per user. Before, a game between two players you both
// loaded was stored once, under whoever was loaded first, and the other
// player's list silently skipped it.
db.version(2)
  .stores({
    games: 'id, user, endTime, [user+endTime]',
    puzzles: 'id, user, gameId, due, [user+due]',
    evals: 'key',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    const games = await tx.table('games').toArray()
    await tx.table('games').clear()
    await tx.table('games').bulkAdd(games.map((g) => ({ ...g, id: `${g.user}:${g.id}` })))
    const puzzles = await tx.table('puzzles').toArray()
    await tx.table('puzzles').clear()
    await tx.table('puzzles').bulkAdd(
      puzzles.map((p) => {
        const gameId = `${p.user}:${p.gameId}`
        return { ...p, gameId, id: `${gameId}:${p.ply}` }
      }),
    )
    // Re-download every month once so the games that were skipped come back.
    const metas = await tx.table('meta').toArray()
    await tx.table('meta').bulkDelete(metas.filter((m) => String(m.key).startsWith('archives:')).map((m) => m.key))
  })

/** Position key without move clocks so transpositions share a cache entry. */
export function evalKey(fen: string) {
  return fen.split(' ').slice(0, 4).join(' ')
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  return ((await db.meta.get(key))?.value as T) ?? fallback
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value })
}
