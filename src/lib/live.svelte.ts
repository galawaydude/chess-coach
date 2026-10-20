import { liveQuery } from 'dexie'

/**
 * A reactive Dexie query. `key` is read synchronously so Svelte tracks its
 * dependencies; the query re-subscribes whenever the key changes and re-runs
 * whenever the underlying tables change.
 */
export function live<T, K>(key: () => K, query: (k: K) => Promise<T>, init: T) {
  const s = $state({ value: init, loaded: false })
  $effect(() => {
    const k = key()
    const sub = liveQuery(() => query(k)).subscribe({
      next: (v) => {
        s.value = v
        s.loaded = true
      },
      error: (e) => console.error(e),
    })
    return () => sub.unsubscribe()
  })
  return s
}
