import { expect, test } from '@playwright/test'
import { drawnWhole, login, openProject } from './helpers.js'

/*
 * A project's feedback page, phase 1: asking.
 * Turned on in the project's settings, read by somebody with no account,
 * and what they ask held until they confirm their address. Pressing the
 * mailed link is the server tests' (`server/test/feedback.test.ts`): the
 * browser cannot read the mail.
 */
test('a feedback page is turned on in a project’s settings, and somebody with no account asks on it', async ({ page, browser }) => {
  test.setTimeout(60_000)
  await login(page)
  /* Never in `ours`, our kept workspace, which the dev account is
     also in and may land on: the fixture is the studio. */
  if (/^\/ours(\/|-|$)/.test(new URL(page.url()).pathname)) await page.goto('/studio')
  await openProject(page, 'Onboarding')
  const heights = await drawnWhole(page, '[data-testid="project-feedback"]', () => page.getByTestId('tool-settings').click())
  expect(heights.length, `the section drew at ${heights.join(', ')} px`).toBe(1)

  /* The page brings Triage where there is none, and says so first. */
  const triage = page.getByTestId('triage-switch')
  const hadTriage = await triage.isChecked()

  /* A page made by an earlier run keeps its address: a page that changed
     its address holds the old one for thirty days and is not renamed
     again until then. A new one is given an address of this run's. */
  const made = (await page.getByTestId('feedback-follow').count()) > 0
  const slug = made ? await page.getByTestId('feedback-slug').inputValue() : `studio-${Date.now().toString(36)}`
  if (!made) await page.getByTestId('feedback-slug').fill(slug)
  const on = page.getByTestId('feedback-switch')
  if (await on.isChecked()) {
    // Left on by an earlier run: off first, so the address is saved on its own.
    await on.click()
    await expect(on).not.toBeChecked()
  }
  await expect(page.getByTestId('feedback-slug-said')).toHaveText('')
  if (!hadTriage) await expect(page.getByText('Turning this on adds a Triage list where requests arrive.')).toBeVisible()
  await on.click()
  await expect(on).toBeChecked()
  await expect(triage).toBeChecked({ timeout: 15_000 })
  await expect(page.getByTestId('feedback-address')).toContainText(`/f/${slug}`, { timeout: 15_000 })
  await expect(page.getByTestId('feedback-follow')).toBeChecked()

  /* Somebody else, in a browser with no session at all. */
  const stranger = await browser.newContext()
  const asks = await stranger.newPage()
  /* Drawn whole from a cold open: watched from the document's first frame,
     since `drawnWhole` watches a page that is already there. */
  await asks.addInitScript(() => {
    const w = window as unknown as { heights: number[] }
    w.heights = []
    let first = 0
    const look = (t: number) => {
      const el = document.querySelector('[data-feedback-page] main')
      const h = el ? Math.round(el.getBoundingClientRect().height) : 0
      if (h > 0) {
        if (!first) first = t
        if (w.heights[w.heights.length - 1] !== h) w.heights.push(h)
      }
      if (!first || t - first < 1200) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await asks.goto(`/f/${slug}`)
  await asks.waitForTimeout(1500)
  const drawn = await asks.evaluate(() => (window as unknown as { heights: number[] }).heights)
  expect(drawn.length, `the page drew at ${drawn.join(', ')} px`).toBe(1)
  await expect(asks.getByRole('heading', { name: 'Onboarding' })).toBeVisible()

  const send = asks.locator('[data-feedback-send]')
  await expect(send).toBeDisabled()
  await asks.getByLabel('What would you like?').fill('Dark mode')
  await asks.getByLabel('Tell us more (optional)').fill('For working at night.')
  await asks.getByLabel('Your email').fill(`stranger-${Date.now()}@example.com`)
  await send.click()
  await expect(asks.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 15_000 })

  // A link nobody mailed says so, and leads back to the page.
  await asks.goto(`/f/${slug}/confirm/${'A'.repeat(43)}`)
  await expect(asks.getByText('This link has expired or was already used.')).toBeVisible({ timeout: 15_000 })
  await asks.locator('[data-feedback-back]').click()
  await expect(asks.locator('[data-feedback-form]')).toBeVisible()

  // Off again, so the fixture is as it was — and the page says it is not available.
  await on.click()
  await expect(on).not.toBeChecked()
  // The page leaves Triage as it is; the fixture had none, so it goes by hand.
  await expect(triage).toBeChecked()
  if (!hadTriage) {
    await triage.click()
    await expect(triage).not.toBeChecked()
  }
  await expect
    .poll(
      async () => {
        await asks.goto(`/f/${slug}`)
        return asks
          .getByText('This page isn’t available right now.')
          .waitFor({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false)
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  await stranger.close()
})

test('an address no page has says so', async ({ page }) => {
  await page.goto('/f/no-page-is-called-this')
  await expect(page.getByText('This page doesn’t exist.')).toBeVisible({ timeout: 15_000 })
})
