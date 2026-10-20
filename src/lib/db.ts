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
