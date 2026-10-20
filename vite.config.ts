import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Cross-origin isolation unlocks SharedArrayBuffer, which the multi-threaded
// engine needs. Without these headers the app falls back to single-threaded.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022' },
})
