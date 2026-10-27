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
      <span class="brand"><img src="{import.meta.env.BASE_URL}knight.svg" alt="" /> Chess Coach</span>
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
      {#key route.query.toString()}<Play fen={route.query.get('fen') ?? ''} color={route.query.get('color')} />{/key}
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
    /* Keep clear of the status bar, notch and gesture bar on phones (Capacitor sets these). */
    padding: calc(12px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))
      calc(16px + var(--safe-area-inset-right, env(safe-area-inset-right, 0px)))
      calc(32px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))
      calc(16px + var(--safe-area-inset-left, env(safe-area-inset-left, 0px)));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .brand img {
    width: 18px;
    height: 18px;
    filter: drop-shadow(1px 1px 0 rgb(0 0 0 / 0.4));
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
