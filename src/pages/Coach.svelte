<script lang="ts">
  import Trainer from '../components/Trainer.svelte'
  import { db } from '../lib/db'
  import { live } from '../lib/live.svelte'
  import { settings, go } from '../lib/state.svelte'
  import { recordAttempt, MASTERED_BOX } from '../lib/srs'
  import { CLS_INFO } from '../lib/analysis'
  import type { Game, Phase, Puzzle } from '../lib/types'

  const puzzles = live(
    () => settings.username.toLowerCase(),
    (u) => db.puzzles.where('user').equals(u).toArray(),
    [] as Puzzle[],
  )

  let phaseFilter = $state<'all' | Phase>('all')
  let mode = $state<'due' | 'all'>('due')
  let currentId = $state<string | null>(null)
  let seen = $state<string[]>([])
  let streak = $state(0)
  let session = $state({ solved: 0, tried: 0 })

  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(t)
  })
  const pool = $derived(puzzles.value.filter((p) => phaseFilter === 'all' || p.phase === phaseFilter))
  const due = $derived(pool.filter((p) => p.due <= now))
  const mastered = $derived(puzzles.value.filter((p) => p.box >= MASTERED_BOX).length)

  function pickNext() {
    now = Date.now()
    const src = (mode === 'due' ? due : pool).filter((p) => !seen.includes(p.id) && p.id !== currentId)
    const ordered =
      mode === 'due'
        ? src.sort((a, b) => a.box - b.box || a.due - b.due)
        : src.sort(() => Math.random() - 0.5)
    currentId = ordered[0]?.id ?? null
    if (currentId) seen.push(currentId)
  }

  $effect(() => {
    if (puzzles.loaded && currentId === null && pool.length) pickNext()
  })

  const puzzle = $derived(puzzles.value.find((p) => p.id === currentId))
  // Freeze the puzzle object while solving so SRS updates don't remount the board.
  let frozen = $state<Puzzle | undefined>()
  $effect(() => {
    if (puzzle && puzzle.id !== frozen?.id) frozen = puzzle
    else if (!currentId) frozen = undefined
  })

  let game = $state<Game | undefined>()
  $effect(() => {
    const id = frozen?.gameId
    if (id) db.games.get(id).then((g) => (game = g))
  })

  async function resolved(clean: boolean) {
    if (!frozen) return
    session.tried++
    if (clean) {
      session.solved++
      streak++
    } else streak = 0
    await recordAttempt(frozen, clean)
  }

  const opp = $derived(game ? (game.userColor === 'w' ? game.black : game.white) : null)
  const BOX = ['New', 'Learning', 'Learning', 'Getting it', 'Mastered', 'Mastered']
</script>

<div class="stack">
  <section class="win">
    <div class="title">Coach · learn from your own mistakes</div>
    <div class="body row">
      <span><b>{due.length}</b> due</span>
      <span class="muted">·</span>
      <span>{puzzles.value.length} total</span>
      <span class="muted">·</span>
      <span>{mastered} mastered</span>
      {#if session.tried}
        <span class="muted">·</span>
        <span>This session: {session.solved}/{session.tried} clean{streak > 1 ? ` · 🔥 ${streak} in a row` : ''}</span>
      {/if}
      <span class="grow"></span>
      <select bind:value={mode} onchange={() => { seen = []; currentId = null }} aria-label="Which puzzles">
        <option value="due">Due for review</option>
        <option value="all">All my mistakes (shuffled)</option>
      </select>
      <select bind:value={phaseFilter} onchange={() => { seen = []; currentId = null }} aria-label="Game phase">
        <option value="all">All phases</option>
        <option value="opening">Opening</option>
        <option value="middlegame">Middlegame</option>
        <option value="endgame">Endgame</option>
      </select>
    </div>
  </section>

  {#if !puzzles.loaded}
    <p>Loading…</p>
  {:else if !puzzles.value.length}
    <section class="win">
      <div class="title">No puzzles yet</div>
      <div class="body">
        <p>Every mistake, blunder and missed chance in your analysed games becomes a puzzle here.</p>
        <button class="btn primary" onclick={() => go('/games')}>Go analyse some games</button>
      </div>
    </section>
  {:else if !frozen}
    <section class="win">
      <div class="title">All caught up</div>
      <div class="body stack">
        <p>
          {mode === 'due'
            ? 'Nothing is due right now. Puzzles you got right come back in a few days; ones you missed come back tomorrow.'
            : 'You went through every puzzle in this filter.'}
        </p>
        <div class="row">
          <button class="btn primary" onclick={() => { mode = 'all'; seen = []; currentId = null }}>Practice anyway (shuffled)</button>
          <button class="btn" onclick={() => go('/games')}>Analyse more games</button>
        </div>
      </div>
    </section>
  {:else}
    <div class="ctx row muted">
      <span class="glyph" style:background={CLS_INFO[frozen.cls].color}>{CLS_INFO[frozen.cls].glyph}</span>
      {#if game && opp}
        From your game vs <b>{opp.username}</b> ({opp.rating}) on {new Date(game.endTime).toLocaleDateString()} · move
        {frozen.fen.split(' ')[5]} · {frozen.phase}
        <a href="#/game/{encodeURIComponent(frozen.gameId)}">open game</a>
      {/if}
      <span class="grow"></span>
      <span>Box: {BOX[frozen.box]}</span>
    </div>
    {#key frozen.id}
      <Trainer startFen={frozen.fen} userColor={frozen.color} puzzle={frozen} onResolved={resolved} onNext={pickNext} />
    {/key}
  {/if}
</div>

<style>
  .ctx {
    padding: 0 4px;
    color: #e8f0f0;
  }
  .ctx a,
  .ctx b {
    color: #fff;
  }
</style>
