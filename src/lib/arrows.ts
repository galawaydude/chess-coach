// Board arrows and markers shared by the review and the trainer.

import type { DrawBrush, DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { CLS_INFO } from './analysis'
import type { Cls } from './types'

export const ARROW = {
  best: '#15781b',
  alt: '#2f6bd1',
  next: '#8e3fb5',
  engine: '#5a5a5a',
}

/** Extra chessground brushes: one per arrow kind, plus one per move rating. */
export const brushes: Record<string, DrawBrush> = {
  best: { key: 'xb', color: ARROW.best, opacity: 0.85, lineWidth: 11 },
  alt: { key: 'xa', color: ARROW.alt, opacity: 0.75, lineWidth: 8 },
  next: { key: 'xn', color: ARROW.next, opacity: 0.7, lineWidth: 8 },
  engine: { key: 'xe', color: ARROW.engine, opacity: 0.55, lineWidth: 9 },
  ...Object.fromEntries(
    Object.entries(CLS_INFO).map(([k, v], i) => [`cls-${k}`, { key: `xc${i}`, color: v.color, opacity: 0.8, lineWidth: 10 }]),
  ),
}

export function arrow(uci: string | undefined, brush: string): DrawShape[] {
  if (!uci || uci.length < 4) return []
  return [{ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush }]
}

/** Rating badge in the corner of the square a move landed on. */
export function badge(uci: string, cls: Cls): DrawShape {
  const info = CLS_INFO[cls]
  return {
    orig: uci.slice(2, 4) as Key,
    customSvg: {
      html: `<circle cx="82" cy="18" r="17" fill="${info.color}" stroke="#fff" stroke-width="3"/><text x="82" y="25" font-size="${info.glyph.length > 1 ? 18 : 22}" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Tahoma,sans-serif">${info.glyph}</text>`,
    },
  }
}

/** Drop arrows that repeat an earlier one (the earlier one wins). */
export function dedupe(shapes: DrawShape[]): DrawShape[] {
  const seen = new Set<string>()
  return shapes.filter((s) => {
    if (!s.dest) return true
    const k = s.orig + s.dest
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
