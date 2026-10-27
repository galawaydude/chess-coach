// Renders the app icon, Android launcher/splash resources and Play Store
// graphics from one design, using headless Chromium.
//   node branding/render.mjs   (needs playwright-core, e.g. from .dev/)
import { chromium } from '../.dev/node_modules/playwright-core/index.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const res = join(root, 'android/app/src/main/res')
const out = join(root, 'store')
mkdirSync(out, { recursive: true })
const knight = 'data:image/svg+xml;base64,' + readFileSync(join(root, 'branding/knight-white.svg')).toString('base64')

const NAVY = 'linear-gradient(135deg, #0a246a 0%, #3a6ea5 100%)'
const DESK = '#2f6f6f'

// One square tile: navy gradient, bevelled edge, knight with a hard 90s shadow.
const tile = (size, { round = false, radius = 0.18, bg = true, scale = 0.72 } = {}) => `
<div style="width:${size}px;height:${size}px;position:relative;overflow:hidden;
  ${bg ? `background:${NAVY};` : ''}
  border-radius:${round ? '50%' : radius * size + 'px'};
  ${bg ? `box-shadow: inset ${-size * 0.02}px ${-size * 0.02}px 0 rgba(0,0,0,.35), inset ${size * 0.02}px ${size * 0.02}px 0 rgba(255,255,255,.35);` : ''}">
  <img src="${knight}" style="position:absolute;left:${((1 - scale) / 2) * size}px;top:${((1 - scale) / 2) * size - size * 0.02}px;
    width:${scale * size}px;height:${scale * size}px;filter:drop-shadow(${size * 0.03}px ${size * 0.03}px 0 rgba(0,0,0,.45))">
</div>`

const b = await chromium.launch({ executablePath: '/usr/bin/chromium' })
const page = await b.newPage()
async function shot(html, w, h, file, transparent = true) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`)
  await page.waitForLoadState('load')
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } })
}

// Launcher icons (legacy square + round), and adaptive foreground (108dp canvas, art inside the 66dp safe zone).
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, k] of Object.entries(dens)) {
  const s = 48 * k
  const f = 108 * k
  await shot(tile(s, { radius: 0.2 }), s, s, `${res}/mipmap-${d}/ic_launcher.png`)
  await shot(tile(s, { round: true }), s, s, `${res}/mipmap-${d}/ic_launcher_round.png`)
  await shot(tile(f, { bg: false, scale: 0.5 }), f, f, `${res}/mipmap-${d}/ic_launcher_foreground.png`)
}

// Splash screens: teal desktop with the icon tile in the middle.
const splash = (w, h) => {
  const s = Math.round(Math.min(w, h) * 0.32)
  return `<div style="width:${w}px;height:${h}px;background:${DESK};display:grid;place-items:center">${tile(s)}</div>`
}
const sizes = {
  drawable: [480, 320],
  'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
}
for (const [dir, [w, h]] of Object.entries(sizes)) await shot(splash(w, h), w, h, `${res}/${dir}/splash.png`, false)

// Play Store: 512 icon (full square, Play rounds it) and the 1024x500 feature graphic.
await shot(tile(512, { radius: 0 }), 512, 512, `${out}/play-icon-512.png`, false)
await shot(`
<div style="width:1024px;height:500px;background:${DESK};display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box;font-family:Tahoma,Verdana,sans-serif">
  ${tile(300)}
  <div style="color:#fff">
    <div style="font-size:76px;font-weight:bold;text-shadow:4px 4px 0 rgba(0,0,0,.35)">Chess Coach</div>
    <div style="font-size:32px;margin-top:14px;opacity:.95;line-height:1.35">Learn from your own games.<br>Stockfish on your phone, free.</div>
  </div>
</div>`, 1024, 500, `${out}/feature-graphic-1024x500.png`, false)
await b.close()
console.log('done')
