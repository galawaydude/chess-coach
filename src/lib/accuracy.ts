// Win probability and accuracy, using Lichess's published formulas.
// chess.com's CAPS formula is closed, so numbers are close but not identical.

import type { Color, Score } from './types'

export function scoreToCp(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 1000 : s.mate < 0 ? -1000 : 0
  return Math.max(-1000, Math.min(1000, s.cp ?? 0))
}

/** White's winning chances in %, 0..100. */
export function winPct(s: Score): number {
  const cp = scoreToCp(s)
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export function winFor(s: Score, c: Color) {
  const w = winPct(s)
  return c === 'w' ? w : 100 - w
}

/** Accuracy of one move from the mover's win % before and after. */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411
  return Math.max(0, Math.min(100, raw + 1))
}

function stdDev(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

/**
 * Game accuracy per side. `wins` is White's win % at every position, starting
 * with the initial one. Volatile stretches are weighted more, and the weighted
 * mean is blended with a harmonic mean so a single blunder still hurts.
 */
export function gameAccuracy(wins: number[], firstMover: Color = 'w'): { w: number; b: number } {
  const n = wins.length
  if (n < 2) return { w: 100, b: 100 }
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)))
  const windows: number[][] = []
  for (let i = 0; i < size - 2 && windows.length < n - 1; i++) windows.push(wins.slice(0, size))
  for (let i = 0; i + size <= n; i++) windows.push(wins.slice(i, i + size))
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))))

  const acc: Record<Color, { a: number; w: number }[]> = { w: [], b: [] }
  for (let i = 0; i < n - 1; i++) {
    const c: Color = (i % 2 === 0) === (firstMover === 'w') ? 'w' : 'b'
    const before = c === 'w' ? wins[i] : 100 - wins[i]
    const after = c === 'w' ? wins[i + 1] : 100 - wins[i + 1]
    acc[c].push({ a: moveAccuracy(before, after), w: weights[Math.min(i, weights.length - 1)] })
  }
  const side = (xs: { a: number; w: number }[]) => {
    if (!xs.length) return 100
    const wm = xs.reduce((s, x) => s + x.a * x.w, 0) / xs.reduce((s, x) => s + x.w, 0)
    const hm = xs.length / xs.reduce((s, x) => s + 1 / Math.max(x.a, 0.01), 0)
    return (wm + hm) / 2
  }
  return { w: side(acc.w), b: side(acc.b) }
}

export function formatScore(s: Score | undefined): string {
  if (!s) return '0.0'
  if (s.mate !== undefined) return s.mate === 0 ? '#' : `${s.mate > 0 ? '' : '-'}M${Math.abs(s.mate)}`
  const cp = s.cp ?? 0
  if (Math.abs(cp) >= 10000) return cp > 0 ? '1-0' : '0-1'
  return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1)
}
