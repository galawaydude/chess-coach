<script lang="ts">
  // Copies a ready-made coaching prompt to paste into Claude (or Claude Code).
  let { make, label = '📋 Copy prompt for Claude' }: { make: () => string; label?: string } = $props()

  let status = $state('')
  let text = $state('')
  let open = $state(false)

  async function copy() {
    text = make()
    try {
      await navigator.clipboard.writeText(text)
      status = 'Copied! Paste it into Claude.'
    } catch {
      // Clipboard blocked: show the text so it can be copied by hand.
      open = true
      status = 'Copy the text below.'
    }
  }
</script>

<div class="stack cp">
  <div class="row">
    <button type="button" class="btn" onclick={copy}>{label}</button>
    <button
      type="button"
      class="btn sm"
      onclick={() => {
        if (!text) text = make()
        open = !open
      }}>{open ? 'Hide' : 'Show'} prompt</button
    >
    {#if status}<span class="muted">{status}</span>{/if}
  </div>
  {#if open}
    <textarea class="sunken" readonly rows="12" onfocus={(e) => e.currentTarget.select()}>{text}</textarea>
  {/if}
</div>

<style>
  .cp {
    gap: 6px;
  }
  textarea {
    width: 100%;
    border: 0;
    padding: 6px 8px;
    font: 12px/1.4 var(--mono);
    resize: vertical;
  }
</style>
