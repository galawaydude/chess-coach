import { db, getMeta, setMeta } from './db'
import { analyseGame, isCurrent } from './analysis'

// ---- routing (hash based, so the app works from any static host) ----

function parse() {
  const h = location.hash.slice(1) || '/'
  const [path, qs] = h.split('?')
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) }
}

export const route = $state(parse())
addEventListener('hashchange', () => Object.assign(route, parse()))

export function go(path: string) {
  location.hash = path
}

// ---- settings ----

export const settings = $state({ username: '', depth: 14, loaded: false })

;(async () => {
  settings.username = await getMeta('username', '')
  settings.depth = await getMeta('depth', 14)
  settings.loaded = true
  refreshOutdated()
})()

export function saveSetting(key: 'username' | 'depth', value: string | number) {
  ;(settings as Record<string, unknown>)[key] = value
  return setMeta(key, value)
}

// ---- arrow toggles (per browser, best effort) ----

function loadArrows() {
  const d = { played: true, best: true, alt: true, next: true, engine: true, spoiler: false }
  try {
    return { ...d, ...JSON.parse(localStorage.getItem('arrows') ?? '{}') }
  } catch {
    return d
  }
}
export const arrowPrefs = $state<Record<string, boolean>>(loadArrows())
$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(arrowPrefs)
    try {
      localStorage.setItem('arrows', json)
    } catch {}
  })
})

// ---- analysis queue ----

/** Games analysed by an older version get their explanations refreshed in the background. */
export async function refreshOutdated() {
  const ids = (await db.games.toArray()).filter((g) => g.analysis && !isCurrent(g)).map((g) => g.id)
  if (ids.length) enqueue(...ids)
}

export const queue = $state({
  ids: [] as string[],
  current: null as string | null,
  done: 0,
  total: 0,
  error: '',
})

let running = false

export function enqueue(...ids: string[]) {
  for (const id of ids) if (!queue.ids.includes(id) && queue.current !== id) queue.ids.push(id)
  run()
}

export function clearQueue() {
  queue.ids = []
}

async function run() {
  if (running) return
  running = true
  while (queue.ids.length) {
    const id = queue.ids.shift()!
    const game = await db.games.get(id)
    if (!game) continue
    queue.current = id
    queue.done = 0
    queue.total = 0
    try {
      const depth = game.analysis && !isCurrent(game) ? game.analysis.depth : settings.depth
      await analyseGame(game, depth, (d, t) => {
        queue.done = d
        queue.total = t
      })
    } catch (e) {
      queue.error = String(e)
      console.error(e)
    }
  }
  queue.current = null
  running = false
}
