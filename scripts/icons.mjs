/*
 * The app's icons, drawn from `web/public/icon.svg`.
 *
 *   node scripts/icons.mjs web/public/icon.svg web/public
 *
 * Through the browser the e2e suite already has, so drawing them needs no
 * package of its own. The manifest's two are the tile in four fifths of the
 * square, as a dock draws one; iOS's is full bleed and square-cornered,
 * because it cuts its own squircle and a rounded one inside it shows black
 * corners. `web/index.html` says the same where it links them.
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [svgPath, outDir] = process.argv.slice(2)
const svg = readFileSync(svgPath, 'utf8')
// Full bleed for iOS, which masks into its own squircle: the square ground, no corners.
const square = svg.replace('rx="13.4054" fill="#393939"', 'rx="0" fill="#393939"')
if (square === svg) throw new Error('icon.svg: the tile to square for iOS was not found')
const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64')

/*
 * Drawn large and brought down, never drawn small.
 *
 * The ground's grain is an SVG noise filter, and its frequency is in the
 * drawing's own units: drawn at 192 pixels it lands one speck per pixel,
 * hard and bright, where the design was made at two thousand and seen
 * shrunk — the grain averaged into a texture. So each one is drawn at 2048
 * and halved down to its size, which is how the original was looked at.
 */
const BIG = 2048
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<html><body></body></html>')

async function bake(src, size, inset, file) {
  const data = await page.evaluate(
    async ({ src, size, inset, BIG }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const pad = Math.round(BIG * inset)
      let c = document.createElement('canvas')
      c.width = c.height = BIG
      c.getContext('2d').drawImage(img, pad, pad, BIG - 2 * pad, BIG - 2 * pad)
      while (c.width / 2 >= size) {
        const n = document.createElement('canvas')
        n.width = n.height = c.width / 2
        const g = n.getContext('2d')
        g.imageSmoothingQuality = 'high'
        g.drawImage(c, 0, 0, n.width, n.height)
        c = n
      }
      if (c.width !== size) {
        const n = document.createElement('canvas')
        n.width = n.height = size
        const g = n.getContext('2d')
        g.imageSmoothingQuality = 'high'
        g.drawImage(c, 0, 0, size, size)
        c = n
      }
      return c.toDataURL('image/png')
    },
    { src, size, inset, BIG },
  )
  writeFileSync(`${outDir}/${file}`, Buffer.from(data.split(',')[1], 'base64'))
}

// The manifest's: the tile in four fifths of the square, the way a dock draws one.
await bake(b64(svg), 192, 0.1, 'icon-192.png')
await bake(b64(svg), 512, 0.1, 'icon-512.png')
await bake(b64(square), 180, 0, 'apple-touch-icon.png')
// The tab's, baked for the same reason: the browser draws an SVG favicon at
// sixteen pixels, grain and all.
await bake(b64(svg), 64, 0, 'favicon.png')

/*
 * The mark the page shows while the app starts — `#splash` in
 * `web/index.html` — eighty pixels drawn at three times, for a phone's
 * screen. Under `src/` so the build names it by its contents and the
 * service worker keeps it with the bundles: it is needed on exactly the
 * starts where the network is slow.
 */
await bake(b64(svg), 240, 0, '../src/splash.png')

/*
 * And what iOS shows before the page: the same mark at the same size in
 * the middle of the screen, so the one hands over to the other without
 * moving. iOS takes a launch image only for an exact match of the screen,
 * so there is one per size it comes in, light and dark — the ground being
 * `--canvas`: white on a phone, the grey on a tablet, the near-black in
 * dark. Portrait only; turned on its side the app draws its own.
 */
const SCREENS = [
  // [points wide, points tall, scale]
  [440, 956, 3], [402, 874, 3], [420, 912, 3], [430, 932, 3], [393, 852, 3],
  [428, 926, 3], [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2],
  [375, 667, 2], [320, 568, 2],
  [1024, 1366, 2], [834, 1194, 2], [820, 1180, 2], [834, 1112, 2], [810, 1080, 2],
  [768, 1024, 2], [744, 1133, 2],
]
const links = []
for (const [w, h, scale] of SCREENS) {
  for (const dark of [false, true]) {
    const ground = dark ? '#090909' : w < 640 ? '#ffffff' : '#f5f5f7'
    const file = `launch/${w * scale}x${h * scale}${dark ? '-dark' : ''}.png`
    const data = await page.evaluate(
      async ({ src, W, H, mark, ground, BIG }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        let c = document.createElement('canvas')
        c.width = c.height = BIG
        c.getContext('2d').drawImage(img, 0, 0, BIG, BIG)
        while (c.width / 2 >= mark) {
          const n = document.createElement('canvas')
          n.width = n.height = c.width / 2
          const g = n.getContext('2d')
          g.imageSmoothingQuality = 'high'
          g.drawImage(c, 0, 0, n.width, n.height)
          c = n
        }
        const out = document.createElement('canvas')
        out.width = W
        out.height = H
        const g = out.getContext('2d')
        g.fillStyle = ground
        g.fillRect(0, 0, W, H)
        g.imageSmoothingQuality = 'high'
        g.drawImage(c, Math.round((W - mark) / 2), Math.round((H - mark) / 2), mark, mark)
        return out.toDataURL('image/png')
      },
      { src: b64(svg), W: w * scale, H: h * scale, mark: 80 * scale, ground, BIG },
    )
    mkdirSync(`${outDir}/launch`, { recursive: true })
    writeFileSync(`${outDir}/${file}`, Buffer.from(data.split(',')[1], 'base64'))
    links.push(
      `    <link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: portrait) and (prefers-color-scheme: ${dark ? 'dark' : 'light'})" />`,
    )
  }
}
// Written into the page between its two markers, so the list there is this one.
const index = `${outDir}/../index.html`
writeFileSync(
  index,
  readFileSync(index, 'utf8').replace(
    /(<!--launch-->\n)[\s\S]*?( *<!--\/launch-->)/,
    `$1${links.join('\n')}\n$2`,
  ),
)
await browser.close()
