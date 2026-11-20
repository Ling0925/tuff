import { test, expect, type Locator, type Page } from '@playwright/test'
import { login, openAccount } from './helpers.js'

/*
 * Every field says what it is — `web/src/ui/kit/fields.tsx`.
 *
 * The agent connect window's key was a password field, so the browser took
 * the webhook URL above it for a user name and offered the person's saved
 * sign-ins over both. Only the ways in are logins; nothing else is a
 * password field, and every other field tells the browser and the password
 * managers to keep out.
 */

const IGNORED = {
  autocomplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
}

async function notALogin(field: Locator) {
  for (const [name, value] of Object.entries(IGNORED)) await expect(field).toHaveAttribute(name, value)
}

/** What the browser filled by itself, which should be nothing outside the ways in. */
const autofilled = (page: Page) => page.evaluate(() => document.querySelectorAll('input:-webkit-autofill').length)

test('sign-in is a form the browser knows as one: email, current password, a submit', async ({ page }) => {
  await page.goto('/signin')
  const form = page.getByTestId('sign-in-form')
  const email = form.getByPlaceholder('email')
  await expect(email).toHaveAttribute('type', 'email')
  await expect(email).toHaveAttribute('autocomplete', 'email')
  await expect(email).toHaveAttribute('name', 'email')
  const password = form.getByPlaceholder('password')
  await expect(password).toHaveAttribute('type', 'password')
  await expect(password).toHaveAttribute('autocomplete', 'current-password')
  await expect(password).toHaveAttribute('name', 'password')
  await expect(form.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit')
})

test('the agent connect window’s URL and key are never a login, and nothing fills them', async ({ page }) => {
  // Signed in through the form first, so the context has a sign-in behind it.
  await login(page)
  await page.getByTestId('nav-members').click()
  await page.getByTestId('members-add').click()
  await page.getByTestId('add-tab-agents').click()
  const asked = page.getByTestId('agent-connect')

  for (const reach of ['webhook', 'routine'] as const) {
    await asked.locator(`[data-agent-reach="${reach}"]`).click()
    const url = asked.getByTestId('agent-url')
    await expect(url).toHaveAttribute('type', 'url')
    await expect(url).toHaveAttribute('inputmode', 'url')
    await expect(url).toHaveAttribute('spellcheck', 'false')
    await notALogin(url)

    const key = asked.getByTestId('agent-key-value')
    await expect(key).toHaveAttribute('type', 'text')
    await notALogin(key)
    // Hidden by its letters all the same.
    expect(await key.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-text-security'))).toBe('disc')

    await expect(asked.locator('input[type="password"]')).toHaveCount(0)
    expect(await autofilled(page)).toBe(0)
  }

  // The name of the agent is a name of a thing, not the person's.
  await notALogin(asked.getByTestId('agent-name'))
  // Focused and typed into, still nothing filled by the browser.
  await asked.getByTestId('agent-url').fill('https://example.com/hook')
  await asked.getByTestId('agent-key-value').click()
  expect(await autofilled(page)).toBe(0)
})

test('Account has no password field at rest, and the name in it is the person’s own', async ({ page }) => {
  await login(page)
  await openAccount(page)
  const name = page.getByTestId('my-name')
  await expect(name).toBeVisible({ timeout: 15_000 })
  await expect(name).toHaveAttribute('autocomplete', 'name')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  expect(await autofilled(page)).toBe(0)
})
