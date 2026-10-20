import { db, getMeta, setMeta } from './db'
import { analyseGame } from './analysis'

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
})()

export function saveSetting(key: 'username' | 'depth', value: string | number) {
  ;(settings as Record<string, unknown>)[key] = value
  return setMeta(key, value)
}

// ---- analysis queue ----

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
      await analyseGame(game, settings.depth, (d, t) => {
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
