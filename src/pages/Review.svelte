<script lang="ts">
  import type { DrawShape } from 'chessground/draw'
  import Board from '../components/Board.svelte'
  import EvalBar from '../components/EvalBar.svelte'
  import EvalGraph from '../components/EvalGraph.svelte'
  import ArrowLegend from '../components/ArrowLegend.svelte'
  import { arrow, badge, dedupe, ARROW } from '../lib/arrows'
  import { db } from '../lib/db'
  import { live } from '../lib/live.svelte'
  import { parseGame, CLS_INFO, BAD } from '../lib/analysis'
  import { enqueue, queue, go, arrowPrefs } from '../lib/state.svelte'
  import { numbered } from '../lib/explain'
  import type { Cls, Color, Game } from '../lib/types'

  let { id }: { id: string } = $props()

  const game = live(
    () => id,
    (k) => db.games.get(k),
    undefined as Game | undefined,
  )
  const g = $derived(game.value)
  const parsed = $derived(g ? parseGame(g.pgn) : null)
  const a = $derived(g?.analysis)
  let ply = $state(-1)
  let flip = $state<boolean | null>(null)

  $effect(() => {
    if (g && !g.analysis && queue.current !== g.id && !queue.ids.includes(g.id)) enqueue(g.id)
  })

  const total = $derived(parsed?.moves.length ?? 0)
  const orientation = $derived(((flip ?? false) !== (g?.userColor === 'b') ? 'black' : 'white') as 'white' | 'black')
  const raw = $derived(ply >= 0 ? parsed?.moves[ply] : undefined)
  const fen = $derived(raw ? raw.after : (parsed?.startFen ?? 'start'))
  const cur = $derived(ply >= 0 ? a?.moves[ply] : undefined)
  const mine = (c: Color) => c === g?.userColor

  // Arrows: the move played (coloured by rating), what was better, the
  // engine's second choice, and the best move from the position on the board.
  const shapes = $derived.by(() => {
    const out: DrawShape[] = []
    const next = a?.moves[ply + 1]
    if (cur) {
      const quiet = cur.cls === 'book' || cur.cls === 'forced'
      if (arrowPrefs.played) out.push(...arrow(cur.uci, `cls-${cur.cls}`))
      if (arrowPrefs.best && !quiet && cur.bestUci !== cur.uci) out.push(...arrow(cur.bestUci, 'best'))
      if (arrowPrefs.alt && !quiet) out.push(...arrow(cur.secondUci, 'alt'))
      out.push(badge(cur.uci, cur.cls))
    }
    if (arrowPrefs.next && next) out.push(...arrow(next.bestUci, 'next'))
    return dedupe(out)
  })
  const legend = $derived([
    { key: 'played', label: 'Move played', color: cur ? CLS_INFO[cur.cls].color : '#888' },
    { key: 'best', label: 'Best move', color: ARROW.best },
    { key: 'alt', label: '2nd best', color: ARROW.alt },
    {
      key: 'next',
      label: a?.moves[ply + 1] && !mine(a.moves[ply + 1].color) ? 'Their best reply (threat)' : 'Best next move',
      color: ARROW.next,
    },
  ])

  function key(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
    if (e.key === 'ArrowLeft') ply = Math.max(-1, ply - 1)
    else if (e.key === 'ArrowRight') ply = Math.min(total - 1, ply + 1)
    else if (e.key === 'Home') ply = -1
    else if (e.key === 'End') ply = total - 1
    else if (e.key === 'f') flip = !flip
    else return
    e.preventDefault()
  }

  /** Jump to the user's next bad move. */
  function nextMistake(dir: 1 | -1) {
    if (!a) return
    for (let i = ply + dir; i >= 0 && i < a.moves.length; i += dir) {
      const m = a.moves[i]
      if (mine(m.color) && ['mistake', 'blunder', 'miss'].includes(m.cls)) return (ply = i)
    }
  }

  const SUMMARY: Cls[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']
  const counts = $derived.by(() => {
    const c: Record<string, { w: number; b: number }> = {}
    for (const k of SUMMARY) c[k] = { w: 0, b: 0 }
    for (const m of a?.moves ?? []) if (c[m.cls]) c[m.cls][m.color]++
    return c
  })

  const rows = $derived.by(() => {
    const out: { n: number; w?: number; b?: number }[] = []
    const moves = parsed?.moves ?? []
    const blackFirst = parsed?.startFen.split(' ')[1] === 'b'
    let n = parsed ? +parsed.startFen.split(' ')[5] : 1
    let i = 0
    if (blackFirst && moves.length) out.push({ n: n++, b: i++ })
    for (; i < moves.length; i += 2) out.push({ n: n++, w: i, b: i + 1 < moves.length ? i + 1 : undefined })
    return out
  })

  let listEl: HTMLDivElement | undefined = $state()
  // Keep the current move visible by scrolling only the move list.
  // (scrollIntoView would also scroll the page, which jumps the board around.)
  $effect(() => {
    const el = listEl?.querySelector<HTMLElement>(`[data-ply="${ply}"]`)
    if (!listEl || !el) return
    const top = el.offsetTop // .moves is position: relative, so this is relative to the list
    if (top < listEl.scrollTop) listEl.scrollTop = top
    else if (top + el.offsetHeight > listEl.scrollTop + listEl.clientHeight)
      listEl.scrollTop = top + el.offsetHeight - listEl.clientHeight
  })

  const players = $derived(
    g
      ? orientation === 'white'
        ? { top: g.black, bottom: g.white, topC: 'b' as Color, bottomC: 'w' as Color }
        : { top: g.white, bottom: g.black, topC: 'w' as Color, bottomC: 'b' as Color }
      : null,
  )
</script>

<svelte:window onkeydown={key} />

{#if !game.loaded}
  <p>Loading…</p>
{:else if !g || !parsed}
  <section class="win"><div class="title">Not found</div><div class="body">That game isn't in your library. <a href="#/games">Back to games</a></div></section>
{:else}
  <div class="layout">
    <section class="win board-win">
      <div class="title">
        <span>{g.white.username} vs {g.black.username}</span>
        <span class="spacer"></span>
        <a class="ext" href={g.url} target="_blank" rel="noreferrer">chess.com ↗</a>
      </div>
      <div class="body">
        {#snippet who(p: { username: string; rating: number }, c: Color)}
          <div class="player row">
            <span class="dot" class:black={c === 'b'}></span>
            <b>{p.username}</b>
            <span class="muted">({p.rating})</span>
            {#if mine(c)}<span class="you">you</span>{/if}
            <span class="grow"></span>
            {#if a}<span class="acc-chip sunken">{a.accuracy[c].toFixed(1)}%</span>{/if}
          </div>
        {/snippet}
        {@render who(players!.top, players!.topC)}
        <div class="board-row">
          <EvalBar score={ply >= 0 ? cur?.evalAfter : a?.startEval} flipped={orientation === 'black'} />
          <div class="grow">
            <Board {fen} {orientation} lastMove={raw?.lan} {shapes} />
          </div>
        </div>
        {@render who(players!.bottom, players!.bottomC)}
        {#if a}<ArrowLegend items={legend} prefs={arrowPrefs} />{/if}
        <div class="row controls">
          <button class="btn" onclick={() => (ply = -1)} title="Start (Home)">⏮</button>
          <button class="btn" onclick={() => (ply = Math.max(-1, ply - 1))} title="Back (←)">◀</button>
          <button class="btn" onclick={() => (ply = Math.min(total - 1, ply + 1))} title="Forward (→)">▶</button>
          <button class="btn" onclick={() => (ply = total - 1)} title="End (End)">⏭</button>
          <button class="btn" onclick={() => (flip = !flip)} title="Flip board (F)">⇅</button>
          <span class="grow"></span>
          {#if a}
            <button class="btn" onclick={() => nextMistake(-1)} title="Jump to your previous mistake">◀ Prev mistake</button>
            <button class="btn" onclick={() => nextMistake(1)} title="Jump to your next mistake">Next mistake ▶</button>
          {/if}
        </div>
      </div>
    </section>

    <div class="side stack">
      {#if !a}
        <section class="win">
          <div class="title">Analysing</div>
          <div class="body stack">
            {#if queue.current === g.id}
              <span>Stockfish is checking every move… {queue.done}/{queue.total} positions</span>
              <div class="progress sunken"><div style:width="{(queue.done / Math.max(1, queue.total)) * 100}%"></div></div>
            {:else}
              <span>Waiting in the queue ({queue.ids.indexOf(g.id) + 1} ahead of it)…</span>
            {/if}
          </div>
        </section>
      {:else}
        <section class="win">
          <div class="title">
            Game review
            <span class="spacer"></span>
            <span style="font-weight:normal">depth {a.depth}</span>
          </div>
          <div class="body stack">
            {#if a.opening}
              <div><span class="muted">Opening:</span> <b>{a.opening.name}</b> <span class="muted">({a.opening.eco})</span></div>
            {/if}
            <EvalGraph start={a.startEval} moves={a.moves} current={ply} onSelect={(p) => (ply = Math.min(total - 1, p))} />
            <table class="counts">
              <thead>
                <tr><th></th><th class="num">{g.white.username}</th><th class="num">{g.black.username}</th></tr>
              </thead>
              <tbody>
                <tr class="acc">
                  <td>Accuracy</td>
                  <td class="num"><b>{a.accuracy.w.toFixed(1)}</b></td>
                  <td class="num"><b>{a.accuracy.b.toFixed(1)}</b></td>
                </tr>
                {#if g.chesscomAccuracy}
                  <tr class="muted">
                    <td>chess.com said</td>
                    <td class="num">{g.chesscomAccuracy.white.toFixed(1)}</td>
                    <td class="num">{g.chesscomAccuracy.black.toFixed(1)}</td>
                  </tr>
                {/if}
                {#each SUMMARY as k (k)}
                  {#if counts[k].w || counts[k].b}
                    <tr>
                      <td><span class="glyph" style:background={CLS_INFO[k].color}>{CLS_INFO[k].glyph}</span> {CLS_INFO[k].label}</td>
                      <td class="num">{counts[k].w || ''}</td>
                      <td class="num">{counts[k].b || ''}</td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="win">
          <div class="title">
            {#if cur}
              <span class="glyph" style:background={CLS_INFO[cur.cls].color}>{CLS_INFO[cur.cls].glyph}</span>
              {Math.floor(cur.ply / 2) + 1}{cur.color === 'w' ? '.' : '...'} {cur.san} is {['inaccuracy', 'excellent'].includes(cur.cls) ? 'an' : 'a'}
              {CLS_INFO[cur.cls].label.toLowerCase()} move
            {:else}
              Coach says
            {/if}
          </div>
          <div class="body stack coach">
            {#if !cur}
              <p>Step through the game with ← → or click the graph. Red dots are the big swings.</p>
              {#if a.moves.some((m) => mine(m.color) && ['mistake', 'blunder', 'miss'].includes(m.cls))}
                <button class="btn primary" onclick={() => nextMistake(1)}>Show my first mistake ▶</button>
              {:else}
                <p><b>No real mistakes from you this game. Nice!</b></p>
              {/if}
            {:else}
              {#if cur.explanation}
                <p>{cur.explanation}</p>
              {:else if cur.cls === 'brilliant'}
                <p>A sacrifice that works! The engine agrees this was the best move.</p>
              {:else if cur.cls === 'great'}
                <p>The only good move here. Everything else was clearly worse.</p>
              {:else if cur.cls === 'best' || cur.cls === 'excellent'}
                <p>{cur.cls === 'best' ? 'The engine’s top choice.' : 'Almost as good as the best move.'}</p>
              {:else if cur.cls === 'book'}
                <p>A normal opening move{a.opening ? ` (${a.opening.name})` : ''}.</p>
              {:else if cur.cls === 'forced'}
                <p>The only legal move.</p>
              {:else}
                <p>A decent move. {cur.bestSan} was slightly better.</p>
              {/if}
              {#if cur.bestUci !== cur.uci && cur.bestLine.length && !['book', 'forced'].includes(cur.cls)}
                <div class="line sunken">
                  <span class="muted">Best line:</span>
                  {numbered(cur.fenBefore, cur.bestLine)}
                </div>
              {/if}
              <div class="row">
                {#if BAD.includes(cur.cls) && mine(cur.color)}
                  <button class="btn primary" onclick={() => go(`/play?fen=${encodeURIComponent(cur!.fenBefore)}&color=${g.userColor}`)}>
                    🎯 Practice this position
                  </button>
                {/if}
                <button class="btn" onclick={() => go(`/play?fen=${encodeURIComponent(fen)}&color=${g.userColor}`)}>Play on from here</button>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <section class="win">
        <div class="title">Moves</div>
        <div class="moves sunken" bind:this={listEl}>
          {#each rows as r (r.n)}
            <div class="mrow">
              <span class="mn">{r.n}.</span>
              {#each [r.w, r.b] as i, j (j)}
                {#if i === undefined}
                  <span></span>
                {:else}
                  {@const m = a?.moves[i]}
                  <button class="mv" class:sel={ply === i} data-ply={i} onclick={() => (ply = i)}>
                    {parsed.moves[i].san}
                    {#if m && !['best', 'excellent', 'good', 'book', 'forced'].includes(m.cls)}
                      <span class="glyph" style:background={CLS_INFO[m.cls].color}>{CLS_INFO[m.cls].glyph}</span>
                    {/if}
                  </button>
                {/if}
              {/each}
            </div>
          {/each}
          <div class="result">{g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '½-½'}</div>
        </div>
      </section>
    </div>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .board-row {
    display: flex;
    gap: 6px;
    margin: 6px 0;
  }
  .player {
    gap: 6px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border: 1px solid #000;
    background: #fff;
  }
  .dot.black {
    background: #000;
  }
  .you {
    background: var(--sel);
    color: #fff;
    padding: 0 5px;
    font-size: 11px;
  }
  .acc-chip {
    padding: 1px 8px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
  }
  .controls {
    margin-top: 8px;
  }
  .controls .btn {
    min-width: 40px;
  }
  .ext {
    color: #fff;
    font-weight: normal;
  }
  .counts {
    width: 100%;
    border-collapse: collapse;
  }
  .counts td,
  .counts th {
    padding: 2px 4px;
    font-weight: normal;
  }
  .counts th {
    border-bottom: 1px solid var(--lo);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .counts .acc td {
    border-bottom: 1px solid var(--lo);
    font-size: 15px;
  }
  .coach p {
    margin: 0;
    font-size: 14px;
  }
  .line {
    padding: 6px 8px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .moves {
    position: relative;
    max-height: 280px;
    overflow: auto;
    padding: 2px;
    margin: 0 3px 3px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .mrow {
    display: grid;
    grid-template-columns: 40px 1fr 1fr;
  }
  .mrow:nth-child(even) {
    background: #f1f1f1;
  }
  .mn {
    padding: 3px 6px;
    color: var(--muted);
  }
  .mv {
    border: 0;
    background: none;
    text-align: left;
    padding: 3px 6px;
    cursor: pointer;
    font: inherit;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .mv:hover {
    background: #dde4f2;
  }
  .mv.sel {
    background: var(--sel);
    color: #fff;
  }
  .result {
    text-align: center;
    padding: 4px;
    font-weight: bold;
  }
</style>
