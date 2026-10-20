<script lang="ts">
  import { formatScore, winPct } from '../lib/accuracy'
  import type { Score } from '../lib/types'

  let { score, flipped = false }: { score?: Score; flipped?: boolean } = $props()
  const white = $derived(score ? winPct(score) : 50)
</script>

<div class="bar sunken" class:flipped title="Evaluation (White's winning chances)">
  <div class="white" style:height="{white}%"></div>
  <span class="lbl" class:top={white < 50}>{score ? formatScore(score) : '–'}</span>
</div>

<style>
  .bar {
    position: relative;
    width: 22px;
    background: #333;
    padding: 2px;
    display: flex;
    flex-direction: column-reverse;
    overflow: hidden;
  }
  .bar.flipped {
    flex-direction: column;
  }
  .white {
    background: #f4f4f4;
    transition: height 0.3s;
  }
  .lbl {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 4px;
    text-align: center;
    font-size: 9px;
    font-weight: bold;
    color: #333;
  }
  .lbl.top {
    bottom: auto;
    top: 4px;
    color: #eee;
  }
  .flipped .lbl {
    bottom: auto;
    top: 4px;
  }
  .flipped .lbl.top {
    top: auto;
    bottom: 4px;
  }
</style>
