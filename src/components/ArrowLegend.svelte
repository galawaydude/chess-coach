<script lang="ts">
  // Checkbox legend for board arrows. Each item toggles one kind of arrow.
  interface Item {
    key: string
    label: string
    color: string // CSS colour or gradient for the swatch
  }
  let { items, prefs }: { items: Item[]; prefs: Record<string, boolean> } = $props()
</script>

<div class="legend row">
  <span class="muted">Arrows:</span>
  {#each items as it (it.key)}
    <label class="row item">
      <input type="checkbox" bind:checked={prefs[it.key]} />
      <span class="sw" style:background={it.color}></span>
      {it.label}
    </label>
  {/each}
</div>

<style>
  .legend {
    margin-top: 8px;
    gap: 4px 14px;
    font-size: 12px;
  }
  .item {
    gap: 5px;
    cursor: pointer;
  }
  .sw {
    width: 18px;
    height: 6px;
    border-radius: 0 3px 3px 0;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
  }
</style>
