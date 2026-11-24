import { expect, test } from '@playwright/test'
import { login } from './helpers'

/*
 * A segmented control's chip sits on the answer, four from the track on
 * every side, whatever happens to the track after the press — `ui/kit/rows.tsx`,
 * `Fluid`. New conversation's switch lost its inset on one side when the
 * window's body grew a scrollbar after a tab was pressed: the track
 * narrowed, and the chip, measured before, stood past the half it was on.
 */
const chipOn = (page: import('@playwright/test').Page, tab: string) =>
  page.evaluate((testId) => {
    const on = document.querySelector(`[data-testid="${testId}"]`)!
    const chip = on.parentElement!.querySelector('[data-glow]')!
    const a = on.getBoundingClientRect()
    const b = chip.getBoundingClientRect()
    return [b.left - a.left, b.right - a.right, b.width - a.width].map((n) => Math.round(n))
  }, tab)

test('the chip stays on the answer when the track narrows after the press', async ({ page }) => {
  await login(page)
  await page.getByTestId('start-dm').click()
  await expect(page.getByTestId('new-chat-channel')).toHaveAttribute('data-on', 'true')

  await page.getByTestId('new-chat-direct').click()
  await page.getByTestId('new-chat-channel').click()
  await page.waitForTimeout(400)
  expect(await chipOn(page, 'new-chat-channel')).toEqual([0, 0, 0])

  // What a scrollbar arriving does: the track is narrower, and nothing re-renders.
  await page.getByTestId('new-chat-direct').click()
  await page.waitForTimeout(400)
  await page.evaluate(() => {
    const track = document.querySelector('[data-testid="new-chat-direct"]')!.parentElement as HTMLElement
    track.style.width = `${track.getBoundingClientRect().width - 16}px`
  })
  await page.waitForTimeout(200)
  expect(await chipOn(page, 'new-chat-direct')).toEqual([0, 0, 0])
})
