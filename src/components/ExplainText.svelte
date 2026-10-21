<script lang="ts">
  // Renders an explanation with every move as a clickable chip. Clicking (or
  // hovering) a chip shows a mini board right below the text with that move as
  // an arrow and the squares the explanation talks about circled.

  import { Chess } from 'chess.js'
  import type { DrawShape } from 'chessground/draw'
  import type { Key } from 'chessground/types'
  import Board from './Board.svelte'
  import { REF_RE, refStart, playUci, type RefCtx } from '../lib/explain'
  import { arrow } from '../lib/arrows'
  import type { Color } from '../lib/types'

  interface Props {
    text: string
    fen: string // position before your move
    played?: string // your move (uci), needed for references after it
    me: Color
  }
  let { text, fen, played, me }: Props = $props()

  interface Ref {
    san: string
    label: string // "25... Be6"
    fenAfter: string
    uci: string
    mover: Color
  }
  type Part = { t: 'text'; s: string } | { t: 'sq'; s: string } | { t: 'ref'; r: Ref }

  function resolve(ctx: RefCtx, list: string): Ref | null {
    const start = refStart(ctx, fen, played)
    if (!start) return null
    const c = new Chess(start)
    const ucis = list.split(',')
    try {
      for (const u of ucis.slice(0, -1)) playUci(c, u)
      const mover = c.turn()
      const [, , , , , full] = c.fen().split(' ')
      const m = playUci(c, ucis[ucis.length - 1])
      return { san: m.san, label: `${full}${mover === 'w' ? '.' : '...'} ${m.san}`, fenAfter: c.fen(), uci: m.lan, mover }
    } catch {
      return null
    }
  }

  const parts = $derived.by(() => {
    const out: Part[] = []
    const pushText = (s: string) => {
      // Square names ("on g2") get highlighted too.
      let last = 0
      for (const m of s.matchAll(/\b[a-h][1-8]\b/g)) {
        if (m.index! > last) out.push({ t: 'text', s: s.slice(last, m.index) })
        out.push({ t: 'sq', s: m[0] })
        last = m.index! + m[0].length
      }
      if (last < s.length) out.push({ t: 'text', s: s.slice(last) })
    }
    let last = 0
    for (const m of text.matchAll(REF_RE)) {
      if (m.index! > last) pushText(text.slice(last, m.index))
      const r = resolve(m[1] as RefCtx, m[2])
      if (r) out.push({ t: 'ref', r })
      else pushText(m[2].split(',').at(-1)!)
      last = m.index! + m[0].length
    }
    if (last < text.length) pushText(text.slice(last))
    return out
  })

  const squares = $derived(parts.filter((p) => p.t === 'sq').map((p) => p.s))
  const refs = $derived(parts.filter((p): p is { t: 'ref'; r: Ref } => p.t === 'ref').map((p) => p.r))

  let pinned = $state<Ref | null>(null)
  let hovered = $state<Ref | null>(null)
  const shown = $derived(hovered ?? pinned)

  $effect(() => {
    // New explanation: close the board.
    void text
    pinned = null
    hovered = null
  })

  const shapes = $derived.by(() => {
    if (!shown) return []
    const out: DrawShape[] = arrow(shown.uci, shown.mover === me ? 'best' : 'red')
    for (const sq of squares) out.push({ orig: sq as Key, brush: 'yellow' })
    return out
  })

  function step(d: 1 | -1) {
    if (!pinned) return
    const i = refs.indexOf(pinned)
    const n = refs[i + d]
    if (n) pinned = n
  }
</script>

<span class="ex">
  {#each parts as p, i (i)}
    {#if p.t === 'text'}{p.s}{:else if p.t === 'sq'}<b class="sq">{p.s}</b>{:else}<button
        type="button"
        class="chip"
        class:mine={p.r.mover === me}
        class:on={shown === p.r}
        title="Show {p.r.label} on a board"
        onclick={() => (pinned = pinned === p.r ? null : p.r)}
        onpointerenter={(e) => e.pointerType === 'mouse' && (hovered = p.r)}
        onpointerleave={() => (hovered = null)}>{p.r.san}</button
      >{/if}
  {/each}
</span>

{#if shown}
  <div class="thumb sunken">
    <div class="mini">
      <Board fen={shown.fenAfter} orientation={me === 'w' ? 'white' : 'black'} lastMove={shown.uci} {shapes} coordinates={false} />
    </div>
    <div class="cap">
      <b>{shown.label}</b>
      <span class="muted">{shown.mover === me ? 'your move' : 'your opponent'}</span>
      {#if squares.length}<span class="muted">· circled: {[...new Set(squares)].join(', ')}</span>{/if}
      {#if pinned && refs.length > 1}
        <span class="row nav">
          <button type="button" class="btn sm" onclick={() => step(-1)} disabled={refs.indexOf(pinned) <= 0}>◀</button>
          <button type="button" class="btn sm" onclick={() => step(1)} disabled={refs.indexOf(pinned) >= refs.length - 1}>▶</button>
          <button type="button" class="btn sm" onclick={() => (pinned = null)}>Close</button>
        </span>
      {/if}
    </div>
  </div>
{:else if refs.length}
  <span class="hint muted">Click a highlighted move to see it on a board.</span>
{/if}

<style>
  .chip {
    border: 0;
    font: inherit;
    font-weight: bold;
    padding: 0 5px;
    margin: 0 1px;
    cursor: pointer;
    background: #f3dede;
    color: #7a1414;
    box-shadow:
      inset -1px -1px #b08a8a,
      inset 1px 1px #fff;
  }
  .chip.mine {
    background: #dcefdc;
    color: #0f5a14;
    box-shadow:
      inset -1px -1px #86a986,
      inset 1px 1px #fff;
  }
  .chip.on,
  .chip:hover {
    background: var(--sel);
    color: #fff;
  }
  .sq {
    background: #fff1c2;
    padding: 0 2px;
  }
  .thumb {
    display: flex;
    gap: 10px;
    padding: 6px;
    margin-top: 6px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .mini {
    width: 220px;
    max-width: 100%;
  }
  .cap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    min-width: 120px;
    flex: 1;
  }
  .nav {
    margin-top: 4px;
    gap: 4px;
  }
  .hint {
    display: block;
    font-size: 12px;
    margin-top: 4px;
  }
</style>
