/**
 * Writes the premade agent faces out as the stills the API points at.
 * `web/public/faces/<id>.svg`, and a PNG of
 * each at 192 pixels for the apps, which draw an `avatar_url` with an image
 * decoder that does not read SVG. Run after changing `data/agentFaces.ts`:
 *
 *   node --import tsx web/scripts/agent-faces.ts
 *
 * The outputs are committed, so a build needs no browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { AGENT_FACE_IDS, agentFaceSvg } from '../src/data/agentFaces.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'faces')
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 192, height: 192 } })
for (const id of AGENT_FACE_IDS) {
  const svg = agentFaceSvg(id, 'width="192" height="192"')
  writeFileSync(join(OUT, `${id}.svg`), svg + '\n')
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: join(OUT, `${id}.png`), omitBackground: true })
}
await browser.close()
console.log(`${AGENT_FACE_IDS.length} faces written to ${OUT}`)
