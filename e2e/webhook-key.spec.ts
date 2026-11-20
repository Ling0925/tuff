import { test, expect, type Page } from '@playwright/test'
import { drawnWhole, login } from './helpers.js'

/* And the agents spec. */

async function openConnect(page: Page) {
  await page.getByTestId('nav-members').click()
  await page.getByTestId('members-add').click()
  await page.getByTestId('add-tab-agents').click()
  return page.getByTestId('agent-connect')
}

test('an agent’s Authorization header is set, replaced and removed on its page, and never shown', async ({ page }) => {
  await login(page)
  const asked = await openConnect(page)
  const name = `Grok ${Date.now()}`
  await asked.locator('[data-agent-reach="webhook"]').click()
  await asked.getByTestId('agent-name').fill(name)
  await asked.locator('[data-agent-project]').filter({ hasText: 'Website' }).click()
  await asked.getByTestId('agent-url').fill('https://example.com/grok')
  await asked.getByTestId('agent-connect-go').click()
  await page.getByTestId('agent-made').getByRole('button', { name: 'Done' }).click()
  const open = page.locator('[data-agent-open]')
  await expect(open.getByTestId('agent-name')).toHaveValue(name, { timeout: 15_000 })

  const key = open.getByTestId('agent-key')
  await expect(key.getByTestId('agent-key-state')).toHaveText('Not set')

  // Set: a press, the value, Save.
  const secret = `Bearer grok-${Date.now()}`
  await key.getByTestId('agent-key-edit').click()
  await key.getByTestId('agent-key-value').fill(secret)
  const saved = page.waitForResponse((r) => /\/api\/agents\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH')
  await key.getByTestId('agent-key-save').click()
  expect((await saved).status()).toBe(200)
  await expect(key.getByTestId('agent-key-state')).toHaveText('Set')
  await expect(key.getByTestId('agent-key-value')).toHaveCount(0)

  // Still set after a reload, and the value is nowhere on the page.
  await page.reload()
  await expect(open.getByTestId('agent-key').getByTestId('agent-key-state')).toHaveText('Set', { timeout: 15_000 })
  expect(await page.content()).not.toContain(secret)

  // Anything but one line of plain ASCII is refused before it is sent; then replaced.
  await key.getByTestId('agent-key-edit').click()
  await key.getByTestId('agent-key-value').fill('Bearer é')
  await key.getByTestId('agent-key-save').click()
  await expect(key.getByRole('alert')).toContainText('one line of plain text')
  await key.getByTestId('agent-key-value').fill(`Bearer grok-replaced-${Date.now()}`)
  await key.getByTestId('agent-key-save').click()
  await expect(key.getByTestId('agent-key-value')).toHaveCount(0)
  await expect(key.getByTestId('agent-key-state')).toHaveText('Set')

  // Removed.
  await key.getByTestId('agent-key-remove').click()
  await expect(key.getByTestId('agent-key-state')).toHaveText('Not set')
})

test('an agent is connected as a Claude Code routine with its URL and token, which stays set', async ({ page }) => {
  await login(page)
  const asked = await openConnect(page)
  const name = `Routine ${Date.now()}`
  await asked.locator('[data-agent-reach="routine"]').click()
  await expect(asked).toContainText('claude.ai/code/routines')
  // Whose rights it works with, said before it is connected.
  await expect(asked.getByTestId('agent-routine-rights')).toContainText('sign in as this agent')
  await asked.getByTestId('agent-name').fill(name)
  await asked.locator('[data-agent-project]').filter({ hasText: 'Website' }).click()
  // Only Anthropic's address, and only with a token.
  await asked.getByTestId('agent-url').fill('https://example.com/fire')
  await asked.getByTestId('agent-key-value').fill('Bearer sk-ant-token')
  await expect(asked.getByTestId('agent-connect-go')).toBeDisabled()
  await asked.getByTestId('agent-url').fill('https://api.anthropic.com/v1/claude_code/routines/trig_e2e/fire')
  await expect(asked.getByTestId('agent-connect-go')).toBeEnabled()
  await asked.getByTestId('agent-connect-go').click()
  await expect(page.getByTestId('agent-made').getByTestId('agent-secret')).toHaveCount(0)
  await page.getByTestId('agent-made').getByRole('button', { name: 'Done' }).click()

  const open = page.locator('[data-agent-open]')
  await expect(open.getByTestId('agent-name')).toHaveValue(name, { timeout: 15_000 })
  await expect(open.locator('[data-agent-reach-card] [data-agent-reach="routine"]')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-members-column] [data-agent]').filter({ hasText: name })).toContainText('Claude Code routine')
  await expect(open.getByTestId('agent-key').getByTestId('agent-key-state')).toHaveText('Set')
  // Replaced, never taken off.
  await expect(open.getByTestId('agent-key-remove')).toHaveCount(0)
})

test('the connect window keeps its height while the way it is reached is chosen', async ({ page }) => {
  await login(page)
  const asked = await openConnect(page)
  await expect(asked.locator('[data-agent-reach-picker] [role="radio"]')).toHaveCount(3)
  // Side by side, one height, each its own glyph.
  const boxes = await asked.locator('[data-agent-reach]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), height: Math.round(r.height), glyph: el.querySelector('svg')?.innerHTML ?? '' }
    }),
  )
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1)
  expect(new Set(boxes.map((b) => b.height)).size).toBe(1)
  expect(new Set(boxes.map((b) => b.glyph)).size).toBe(3)
  // A name and one line each, none cut short.
  const cut = await asked
    .locator('[data-reach-name], [data-reach-line]')
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent))
  expect(cut, `cut short: ${cut.join(', ')}`).toEqual([])
  const heights = await drawnWhole(page, '[data-dialog-panel]', async () => {
    for (const r of ['webhook', 'routine', 'mcp', 'routine', 'webhook']) {
      await asked.locator(`[data-agent-reach="${r}"]`).click()
      await page.waitForTimeout(120)
    }
  })
  expect(heights.length, `the window changed height: ${heights.join(' → ')}`).toBe(1)
  // The arrows move the choice.
  await asked.locator('[data-agent-reach="webhook"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(asked.locator('[data-agent-reach="routine"]')).toHaveAttribute('aria-checked', 'true')
  await expect(asked.getByTestId('agent-routine-rights')).toBeVisible()
})

test('an agent’s reach is changed on its page: a new address clears its key, a routine needs its token, MCP stops it', async ({ page }) => {
  await login(page)
  const asked = await openConnect(page)
  const name = `Mover ${Date.now()}`
  await asked.locator('[data-agent-reach="webhook"]').click()
  await asked.getByTestId('agent-name').fill(name)
  await asked.locator('[data-agent-project]').filter({ hasText: 'Website' }).click()
  await asked.getByTestId('agent-url').fill('https://93.184.215.14/first')
  await asked.getByTestId('agent-key-value').fill('Bearer first-key')
  await asked.getByTestId('agent-connect-go').click()
  await page.getByTestId('agent-made').getByRole('button', { name: 'Done' }).click()
  const open = page.locator('[data-agent-open]')
  await expect(open.getByTestId('agent-name')).toHaveValue(name, { timeout: 15_000 })
  const card = open.locator('[data-agent-reach-card]')
  await expect(card.locator('[data-agent-reach="webhook"]')).toHaveAttribute('aria-checked', 'true')
  await expect(card.getByTestId('agent-reach-url')).toHaveValue('https://93.184.215.14/first')
  await expect(card.getByTestId('agent-key-state')).toHaveText('Set')

  // A new address says, before saving, that the header goes.
  await card.getByTestId('agent-reach-url').fill('https://93.184.215.15/second')
  await expect(card.getByTestId('agent-reach-warning')).toContainText('removes the saved Authorization header')
  await expect(card.getByTestId('agent-reach-warning')).toContainText('new webhook secret')
  const saved = page.waitForResponse((r) => r.url().endsWith('/reach') && r.request().method() === 'PUT')
  await card.getByTestId('agent-reach-save').click()
  expect((await saved).status()).toBe(200)
  // A new receiver is signed with a new secret, shown once.
  const resigned = page.getByTestId('agent-reach-secret')
  await expect(resigned.getByTestId('agent-secret')).toContainText('whs_')
  await resigned.getByRole('button', { name: 'Done' }).click()
  await expect(resigned).toHaveCount(0)
  await expect(card.getByTestId('agent-key-state')).toHaveText('Not set')
  await expect(card.getByTestId('agent-reach-save')).toHaveCount(0)

  // A routine: Anthropic's address, and not without its token.
  await card.locator('[data-agent-reach="routine"]').click()
  await card.getByTestId('agent-reach-url').fill('https://api.anthropic.com/v1/claude_code/routines/trig_page/fire')
  await expect(card.getByTestId('agent-reach-save')).toBeDisabled()
  await expect(card.getByTestId('agent-reach-rights')).toContainText('sign in as this agent')
  await card.getByTestId('agent-reach-key').fill('Bearer sk-ant-page')
  await card.getByTestId('agent-reach-save').click()
  await expect(card.getByTestId('agent-key-state')).toHaveText('Set')
  await expect(card.locator('[data-agent-reach="routine"]')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-members-column] [data-agent]').filter({ hasText: name })).toContainText('Claude Code routine')

  // MCP: it says the calls stop, and they do.
  await card.locator('[data-agent-reach="mcp"]').click()
  await expect(card.getByTestId('agent-reach-warning')).toContainText('stops calling it')
  await card.getByTestId('agent-reach-save').click()
  await expect(card.getByTestId('agent-reach-save')).toHaveCount(0)
  await expect(card.getByTestId('agent-reach-url')).toHaveCount(0)
  await expect(open.locator('[data-agent-setup]')).toBeVisible()

  // And back to a webhook: its secret, once.
  await card.locator('[data-agent-reach="webhook"]').click()
  await card.getByTestId('agent-reach-url').fill('https://93.184.215.14/again')
  await card.getByTestId('agent-reach-save').click()
  const told = page.getByTestId('agent-reach-secret')
  await expect(told.getByTestId('agent-secret')).toContainText('whs_')
  await told.getByRole('button', { name: 'Done' }).click()
  await expect(told).toHaveCount(0)
  expect(await page.content()).not.toContain('sk-ant-page')
})
