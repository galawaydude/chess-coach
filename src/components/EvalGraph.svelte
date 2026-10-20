<script lang="ts">
  import { formatScore, winPct } from '../lib/accuracy'
  import { CLS_INFO } from '../lib/analysis'
  import type { MoveAnalysis, Score } from '../lib/types'

  interface Props {
    start: Score
    moves: MoveAnalysis[]
    current: number // ply index of the selected move, -1 = start
    onSelect: (ply: number) => void
  }
  let { start, moves, current, onSelect }: Props = $props()

  const W = 600
  const H = 120
  let hover = $state<number | null>(null)

  const pts = $derived([start, ...moves.map((m) => m.evalAfter)].map((s) => 100 - winPct(s)))
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0)
  const y = (v: number) => (v / 100) * H
  const area = $derived(
    `M0,${H} ` + pts.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L${W},${H} Z`,
  )
  const marks = $derived(moves.filter((m) => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.cls)))

  function pick(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1))
    return Math.max(0, Math.min(pts.length - 1, i))
  }
</script>

<div class="wrap sunken">
  <!-- Arrow keys on the review page already step through moves. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <svg
    viewBox="0 0 {W} {H}"
    preserveAspectRatio="none"
    role="slider"
    tabindex="-1"
    aria-label="Evaluation over the game"
    aria-valuenow={current + 1}
    onpointermove={(e) => (hover = pick(e))}
    onpointerleave={() => (hover = null)}
    onclick={(e) => onSelect(pick(e as unknown as PointerEvent) - 1)}
  >
    <rect width={W} height={H} fill="#3a3a3a" />
    <path d={area} fill="#f2f2f2" />
    <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#888" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 3" />
    {#each marks as m (m.ply)}
      <circle
        cx={x(m.ply + 1)}
        cy={y(pts[m.ply + 1])}
        r="4"
        fill={CLS_INFO[m.cls].color}
        stroke="#fff"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    {/each}
    <line
      x1={x(current + 1)}
      x2={x(current + 1)}
      y1="0"
      y2={H}
      stroke="#0a246a"
      stroke-width="2"
      vector-effect="non-scaling-stroke"
    />
    {#if hover !== null}
      <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="#0a246a" stroke-opacity=".4" stroke-width="1" vector-effect="non-scaling-stroke" />
    {/if}
  </svg>
  {#if hover !== null}
    {@const m = moves[hover - 1]}
    <div class="tip" style:left="{(hover / Math.max(1, pts.length - 1)) * 100}%">
      {#if m}
        <b>{Math.floor(m.ply / 2) + 1}{m.color === 'w' ? '.' : '...'} {m.san}</b>
        {formatScore(m.evalAfter)}
        {#if !['best', 'excellent', 'good', 'book', 'forced'].includes(m.cls)}
          <span style:color={CLS_INFO[m.cls].color}>· {CLS_INFO[m.cls].label}</span>
        {/if}
      {:else}
        Start
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    padding: 2px;
  }
  svg {
    display: block;
    width: 100%;
    height: 110px;
    cursor: crosshair;
  }
  .tip {
    position: absolute;
    top: -6px;
    transform: translate(-50%, -100%);
    background: #ffffe1;
    border: 1px solid #000;
    padding: 2px 6px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }
</style>
