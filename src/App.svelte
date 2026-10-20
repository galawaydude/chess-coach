<script lang="ts">
  import { route, go, queue } from './lib/state.svelte'
  import { threaded, pool } from './lib/engine'
  import Games from './pages/Games.svelte'
  import Review from './pages/Review.svelte'
  import Coach from './pages/Coach.svelte'
  import Stats from './pages/Stats.svelte'
  import Play from './pages/Play.svelte'

  const page = $derived(route.parts[0] ?? 'games')
  const tabs = [
    ['games', '♟ Games'],
    ['coach', '🎓 Coach'],
    ['stats', '📊 Patterns'],
  ] as const
</script>

<div class="shell">
  <header class="win">
    <div class="title">
      <span>♞ Chess Coach</span>
      <span class="spacer"></span>
      <span class="eng" title="Stockfish 19 lite, running locally">
        SF19 · {pool.size} workers{threaded ? ' · MT' : ''}
      </span>
    </div>
    <nav class="row">
      {#each tabs as [k, label] (k)}
        <button class="btn" class:on={page === k || (k === 'games' && page === 'game')} onclick={() => go('/' + k)}>
          {label}
        </button>
      {/each}
      <span class="grow"></span>
      {#if queue.current}
        <span class="muted">
          Analysing… {queue.done}/{queue.total}{queue.ids.length ? ` (+${queue.ids.length} queued)` : ''}
        </span>
        <div class="progress sunken mini"><div style:width="{(queue.done / Math.max(1, queue.total)) * 100}%"></div></div>
      {/if}
    </nav>
  </header>

  <main>
    {#if page === 'game' && route.parts[1]}
      {#key route.parts[1]}<Review id={route.parts[1]} />{/key}
    {:else if page === 'coach'}
      <Coach />
    {:else if page === 'play'}
      {#key route.query.toString()}<Play fen={route.query.get('fen') ?? ''} />{/key}
    {:else if page === 'stats'}
      <Stats />
    {:else}
      <Games />
    {/if}
  </main>
</div>

<style>
  .shell {
    max-width: 1280px;
    margin: 0 auto;
    padding: 12px 16px 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  nav {
    padding: 6px 4px 3px;
  }
  .eng {
    font-weight: normal;
    font-size: 11px;
    opacity: 0.85;
  }
  .mini {
    width: 120px;
    height: 16px;
    padding: 2px;
  }
  @media (max-width: 560px) {
    .eng {
      display: none;
    }
  }
</style>
