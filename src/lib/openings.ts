import { evalKey } from './db'

let book: Promise<Record<string, [string, string]>> | null = null

export function loadBook() {
  book ??= fetch(import.meta.env.BASE_URL + 'openings.json').then((r) => r.json())
  return book
}

/** The deepest named opening reached by a sequence of positions (FENs after each ply). */
export async function detectOpening(fens: string[]) {
  const b = await loadBook()
  let found: { eco: string; name: string; lastBookPly: number } | undefined
  for (let i = 0; i < fens.length && i < 40; i++) {
    const hit = b[evalKey(fens[i])]
    if (hit) found = { eco: hit[0], name: hit[1], lastBookPly: i }
  }
  return found
}

export async function inBook(fen: string) {
  return !!(await loadBook())[evalKey(fen)]
}
