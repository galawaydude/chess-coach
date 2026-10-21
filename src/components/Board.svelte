<script lang="ts">
  import { Chessground } from 'chessground'
  import type { Api } from 'chessground/api'
  import type { DrawShape } from 'chessground/draw'
  import type { Key } from 'chessground/types'
  import { Chess, SQUARES } from 'chess.js'
  import { untrack } from 'svelte'
  import { brushes } from '../lib/arrows'
  import 'chessground/assets/chessground.base.css'
  import 'chessground/assets/chessground.brown.css'
  import 'chessground/assets/chessground.cburnett.css'

  interface Props {
    fen: string
    orientation?: 'white' | 'black'
    lastMove?: string // uci
    /** Which side can move pieces; omit for a view-only board. */
    movable?: 'white' | 'black' | 'both'
    shapes?: DrawShape[]
    onMove?: (uci: string) => void
    coordinates?: boolean
  }

  let { fen, orientation = 'white', lastMove, movable, shapes = [], onMove, coordinates = true }: Props = $props()

  let el: HTMLDivElement
  let cg: Api | undefined

  function dests(chess: Chess) {
    const d = new Map<Key, Key[]>()
    for (const s of SQUARES) {
      const ms = chess.moves({ square: s, verbose: true })
      if (ms.length) d.set(s, ms.map((m) => m.to))
    }
    return d
  }

  function config() {
    const chess = new Chess(fen)
    const turn = chess.turn() === 'w' ? 'white' : 'black'
    const canMove = movable === 'both' || movable === turn
    return {
      fen,
      orientation,
      turnColor: turn,
      check: chess.inCheck(),
      lastMove: lastMove ? ([lastMove.slice(0, 2), lastMove.slice(2, 4)] as Key[]) : undefined,
      movable: {
        free: false,
        color: canMove ? turn : undefined,
        dests: canMove ? dests(chess) : new Map(),
        showDests: true,
      },
      drawable: { autoShapes: shapes },
    } as const
  }

  $effect(() => {
    cg = untrack(() => Chessground(el, {
      ...config(),
      animation: { enabled: true, duration: 160 },
      coordinates,
      highlight: { lastMove: true, check: true },
      drawable: { autoShapes: shapes, brushes: brushes as never },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      events: {
        move: (orig, dest) => {
          const chess = new Chess(fen)
          const piece = chess.get(orig as never)
          // Auto-queen: under-promotion almost never matters at this level.
          const promo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : ''
          onMove?.(orig + dest + promo)
          // Re-sync in case the parent rejected the move and kept the old position.
          setTimeout(() => cg?.set(config()))
        },
      },
    }))
    return () => cg?.destroy()
  })

  $effect(() => {
    cg?.set(config())
  })
</script>

<div class="board-frame sunken">
  <div bind:this={el} class="board"></div>
</div>

<style>
  .board-frame {
    padding: 3px;
    width: 100%;
  }
  .board {
    aspect-ratio: 1;
    width: 100%;
  }
  .board :global(coords) {
    font-family: var(--font);
    font-weight: bold;
  }
</style>
