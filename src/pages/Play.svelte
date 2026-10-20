<script lang="ts">
  import { Chess } from 'chess.js'
  import Trainer from '../components/Trainer.svelte'
  import type { Color } from '../lib/types'

  let { fen }: { fen: string } = $props()

  const valid = $derived.by(() => {
    try {
      return new Chess(fen || undefined).fen()
    } catch {
      return null
    }
  })
</script>

{#if valid}
  <div class="stack">
    <div class="row">
      <button class="btn" onclick={() => history.back()}>◀ Back</button>
      <span style="color:#e8f0f0">Play this position out against Stockfish. Every move you make gets graded.</span>
    </div>
    <Trainer startFen={valid} userColor={valid.split(' ')[1] as Color} />
  </div>
{:else}
  <section class="win"><div class="title">Bad position</div><div class="body">That position couldn't be loaded.</div></section>
{/if}
