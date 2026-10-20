<script lang="ts">
  // Single-series line chart with a crosshair tooltip. Plain SVG, no library.
  interface Props {
    points: { x: number; y: number; label: string }[]
    yMin?: number
    yMax?: number
    format?: (y: number) => string
    height?: number
  }
  let { points, yMin, yMax, format = (y) => y.toFixed(0), height = 160 }: Props = $props()

  const W = 600
  const PAD = { l: 36, r: 8, t: 8, b: 8 }
  let hover = $state<number | null>(null)

  const lo = $derived(yMin ?? Math.min(...points.map((p) => p.y)))
  const hi = $derived(yMax ?? Math.max(...points.map((p) => p.y)))
  const span = $derived(hi - lo || 1)
  const px = (i: number) => PAD.l + (points.length > 1 ? (i / (points.length - 1)) * (W - PAD.l - PAD.r) : 0)
  const py = (y: number) => PAD.t + (1 - (y - lo) / span) * (height - PAD.t - PAD.b)
  const d = $derived(points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(' '))
  const ticks = $derived([lo, lo + span / 2, hi])

  function move(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1))
    hover = Math.max(0, Math.min(points.length - 1, i))
  }
</script>

<div class="wrap">
  <svg
    viewBox="0 0 {W} {height}"
    role="img"
    aria-label="Line chart"
    onpointermove={move}
    onpointerleave={() => (hover = null)}
    style:height="{height}px"
    preserveAspectRatio="none"
  >
    {#each ticks as t (t)}
      <line x1={PAD.l} x2={W - PAD.r} y1={py(t)} y2={py(t)} stroke="#d0d0d0" vector-effect="non-scaling-stroke" />
    {/each}
    <path {d} fill="none" stroke="#0a246a" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
    {#if hover !== null}
      <line x1={px(hover)} x2={px(hover)} y1={PAD.t} y2={height - PAD.b} stroke="#808080" vector-effect="non-scaling-stroke" />
    {/if}
  </svg>
  {#each ticks as t (t)}
    <span class="tick" style:top="{py(t)}px">{format(t)}</span>
  {/each}
  {#if hover !== null}
    <span class="dot" style:left="{(px(hover) / W) * 100}%" style:top="{py(points[hover].y)}px"></span>
    <div class="tip" style:left="{(px(hover) / W) * 100}%" style:top="{py(points[hover].y)}px">
      <b>{format(points[hover].y)}</b> · {points[hover].label}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  svg {
    display: block;
    width: 100%;
  }
  .tick {
    position: absolute;
    left: 0;
    transform: translateY(-50%);
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #0a246a;
    border: 2px solid #fff;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 10px));
    background: #ffffe1;
    border: 1px solid #000;
    padding: 2px 6px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
