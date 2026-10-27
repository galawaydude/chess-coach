<script lang="ts">
  import { db } from '../lib/db'
  import { live } from '../lib/live.svelte'
  import { syncGames } from '../lib/chesscom'
  import { settings, saveSetting, enqueue, clearQueue, queue, go } from '../lib/state.svelte'
  import type { Game } from '../lib/types'

  let name = $state('')
  let months = $state(3)
  let status = $state('')
  let error = $state('')
  let busy = $state(false)
  let tc = $state('all')
  let res = $state('all')
  let analysed = $state('all')

  let seeded = false
  $effect(() => {
    if (settings.loaded && !seeded) {
      seeded = true
      name = settings.username
    }
  })

  const games = live(
    () => settings.username.toLowerCase(),
    (u) => db.games.where('[user+endTime]').between([u, 0], [u, Infinity]).reverse().toArray(),
    [] as Game[],
  )

  const shown = $derived(
    games.value.filter(
      (g) =>
        (tc === 'all' || g.timeClass === tc) &&
        (res === 'all' || g.result === res) &&
        (analysed === 'all' || (analysed === 'yes') === !!g.analysis),
    ),
  )
  const record = $derived({
    w: shown.filter((g) => g.result === 'win').length,
    d: shown.filter((g) => g.result === 'draw').length,
    l: shown.filter((g) => g.result === 'loss').length,
  })
  const pending = $derived(shown.filter((g) => !g.analysis).map((g) => g.id))

  async function load(e?: Event) {
    e?.preventDefault()
    if (!name.trim()) return
    busy = true
    error = ''
    try {
      await saveSetting('username', name.trim())
      const r = await syncGames(name, months, (s) => (status = s))
      status = r.added ? `Loaded ${r.added} new game${r.added === 1 ? '' : 's'}.` : 'Up to date.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      status = ''
    } finally {
      busy = false
    }
  }

  function moveCount(pgn: string) {
    const all = pgn.match(/(\d+)\.\s/g)
    return all ? parseInt(all[all.length - 1]) : 0
  }

  const me = (g: Game) => (g.userColor === 'w' ? g.white : g.black)
  const them = (g: Game) => (g.userColor === 'w' ? g.black : g.white)
  const acc = (g: Game, mine: boolean) => {
    if (!g.analysis) return ''
    const c = mine === (g.userColor === 'w') ? 'w' : 'b'
    return g.analysis.accuracy[c].toFixed(1)
  }
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const TC: Record<string, string> = { bullet: '⚡', blitz: '🔥', rapid: '⏱', daily: '☀' }
</script>

<div class="stack">
  <section class="win">
    <div class="title">Load games from chess.com</div>
    <form class="body row" onsubmit={load}>
      <label for="u">Username:</label>
      <input id="u" type="text" bind:value={name} placeholder="your chess.com username" autocomplete="off" spellcheck="false" />
      <select bind:value={months} aria-label="How far back">
        <option value={1}>Last month</option>
        <option value={3}>Last 3 months</option>
        <option value={6}>Last 6 months</option>
        <option value={12}>Last year</option>
        <option value={999}>Everything</option>
      </select>
      <button class="btn primary" disabled={busy || !name.trim()}>{busy ? 'Loading…' : 'Load games'}</button>
      {#if status}<span class="muted">{status}</span>{/if}
      {#if error}<span class="loss-txt">⚠ {error}</span>{/if}
    </form>
  </section>

  {#if settings.username}
    <section class="win">
      <div class="title">
        <span>{settings.username}'s games</span>
        <span class="spacer"></span>
        <span style="font-weight:normal">{shown.length} shown · +{record.w} ={record.d} −{record.l}</span>
      </div>
      <div class="body stack">
        <div class="row">
          <select bind:value={tc} aria-label="Time control">
            <option value="all">All time controls</option>
            <option value="bullet">Bullet</option>
            <option value="blitz">Blitz</option>
            <option value="rapid">Rapid</option>
            <option value="daily">Daily</option>
          </select>
          <select bind:value={res} aria-label="Result">
            <option value="all">All results</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="draw">Draws</option>
          </select>
          <select bind:value={analysed} aria-label="Analysis status">
            <option value="all">Analysed or not</option>
            <option value="yes">Analysed</option>
            <option value="no">Not analysed</option>
          </select>
          <span class="grow"></span>
          <label for="depth" class="muted">Engine depth</label>
          <select id="depth" value={settings.depth} onchange={(e) => saveSetting('depth', +e.currentTarget.value)}>
            <option value={10}>10 · quick</option>
            <option value={12}>12 · fast</option>
            <option value={14}>14 · normal</option>
            <option value={16}>16 · deep</option>
            <option value={18}>18 · deepest</option>
          </select>
          {#if queue.current || queue.ids.length}
            <button class="btn" onclick={clearQueue}>Stop queue</button>
          {/if}
          <button class="btn primary" disabled={!pending.length} onclick={() => enqueue(...pending)}>
            Analyse {pending.length} game{pending.length === 1 ? '' : 's'}
          </button>
        </div>

        <div class="table sunken">
          {#if !games.loaded}
            <p class="empty">Loading…</p>
          {:else if !games.value.length}
            <p class="empty">No games yet. Hit <b>Load games</b> above.</p>
          {:else}
            <table class="list">
              <thead>
                <tr>
                  <th>Date</th>
                  <th class="wide">Type</th>
                  <th>Opponent</th>
                  <th>Result</th>
                  <th class="num wide">Moves</th>
                  <th class="num">Accuracy</th>
                  <th class="wide">Opening</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each shown as g (g.id)}
                  <tr class="click" onclick={() => go('/game/' + encodeURIComponent(g.id))}>
                    <td>{date(g.endTime)}</td>
                    <td class="wide" title={g.timeControl}>{TC[g.timeClass] ?? ''} {g.timeClass}</td>
                    <td>
                      <span class="pc" title={g.userColor === 'w' ? 'You had White' : 'You had Black'}>{g.userColor === 'w' ? '□' : '■'}</span>
                      {them(g).username} <span class="muted">({them(g).rating})</span>
                    </td>
                    <td class={g.result === 'win' ? 'win-txt' : g.result === 'loss' ? 'loss-txt' : ''}>
                      {g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw'}
                      <span class="muted wide" style="font-weight:normal">· {g.result === 'win' ? them(g).result : me(g).result}</span>
                    </td>
                    <td class="num wide">{moveCount(g.pgn)}</td>
                    <td class="num">
                      {#if g.analysis}
                        <b>{acc(g, true)}</b> <span class="muted">/ {acc(g, false)}</span>
                      {:else if queue.current === g.id}
                        <span class="muted">{Math.round((queue.done / Math.max(1, queue.total)) * 100)}%</span>
                      {:else if queue.ids.includes(g.id)}
                        <span class="muted">queued</span>
                      {/if}
                    </td>
                    <td class="opening wide" title={g.opening?.name ?? g.ecoName}>{g.opening?.name ?? g.ecoName ?? ''}</td>
                    <td>
                      {#if !g.analysis && queue.current !== g.id && !queue.ids.includes(g.id)}
                        <button
                          class="btn sm"
                          onclick={(e) => {
                            e.stopPropagation()
                            enqueue(g.id)
                          }}>Analyse</button
                        >
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      </div>
    </section>
  {:else}
    <section class="win">
      <div class="title">Welcome</div>
      <div class="body">
        <p>
          This is your personal chess coach. Load your chess.com games, and it will analyse every move with Stockfish
          right here in your browser, rate your accuracy, explain your mistakes, and turn them into puzzles you
          replay until they stick.
        </p>
        <p class="muted">Nothing leaves your computer except the request to chess.com for your public games.</p>
      </div>
    </section>
  {/if}
</div>

<style>
  .table {
    max-height: 62vh;
    overflow: auto;
    padding: 2px;
  }
  .empty {
    padding: 24px;
    text-align: center;
    margin: 0;
  }
  .opening {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pc {
    font-size: 12px;
  }
  @media (max-width: 640px) {
    .wide {
      display: none;
    }
    .table :global(td) {
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }
  input[type='text'] {
    width: 220px;
    max-width: 100%;
  }
</style>
