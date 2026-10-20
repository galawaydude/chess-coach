import { db } from './db'
import type { Puzzle } from './types'

// Leitner boxes: a puzzle you solve moves up a box and comes back later;
// a puzzle you miss drops to box 0 and comes back tomorrow.
const DAY = 86_400_000
export const INTERVALS = [1, 2, 4, 8, 16, 32].map((d) => d * DAY)
export const MASTERED_BOX = 4

export async function recordAttempt(p: Puzzle, solvedClean: boolean) {
  const box = solvedClean ? Math.min(p.box + 1, INTERVALS.length - 1) : 0
  const due = Date.now() + (solvedClean ? INTERVALS[box] : DAY)
  await db.puzzles.update(p.id, {
    box,
    due,
    attempts: p.attempts + 1,
    solves: p.solves + (solvedClean ? 1 : 0),
  })
}

export function nextDue(puzzles: Puzzle[], now = Date.now()) {
  return puzzles.filter((p) => p.due <= now).sort((a, b) => a.due - b.due || b.createdAt - a.createdAt)
}
