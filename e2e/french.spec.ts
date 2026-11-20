import { test, expect, type Page } from '@playwright/test'
import { add, login, openAccount, openProject } from './helpers.js'

/*
 * French, to whoever chooses it.
 *
 * The choice is kept on the account, and the accounts are shared by the
 * tests a worker runs one after another, so it is put back whatever
 * happens: a studio left in French is every later test in that worker
 * looking for English that is not there.
 */
async function backToEnglish(page: Page) {
  await page.evaluate(async () => {
    const raw = localStorage.getItem('session')
    const token = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined
    localStorage.removeItem('tongue')
    if (token) {
      await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ language: null }),
      })
    }
  })
}

test('the interface speaks French to someone who chooses it, on every device they sign in on', async ({ page, browser }) => {
  await login(page)
  try {
    await openAccount(page)
    await Promise.all([page.waitForEvent('load'), page.getByTestId('tongue').selectOption('fr')])
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(page.getByTestId('nav-my')).toContainText('Mes tâches')

    // Another device, never told anything, takes the account's language.
    const other = await browser.newContext()
    const there = await other.newPage()
    await login(there)
    await expect(there.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(there.getByTestId('nav-my')).toContainText('Mes tâches')
    await other.close()
  } finally {
    await backToEnglish(page)
  }
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByTestId('nav-my')).toContainText('My Tasks')
})

test('a project’s settings name its tools as its tabs do, in French too', async ({ page }) => {
  await login(page)
  const name = `Outils ${Date.now()}`
  await add(page, 'new-project', name)
  try {
    await openAccount(page)
    await Promise.all([page.waitForEvent('load'), page.getByTestId('tongue').selectOption('fr')])
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await openProject(page, name)
    await page.getByTestId('tool-settings').click()

    // One place names a tool — `web/src/words/tools.ts` — and the switch
    // that turns it off says what its tab says.
    const said = ['Tâches', 'Discussion', 'Fichiers', 'Annonces']
    await expect(page.locator('[data-tool-switch]')).toHaveText(said)
    for (const [i, kind] of ['tasks', 'messages', 'files', 'posts'].entries()) {
      await expect(page.getByTestId(`tool-${kind}`).first()).toContainText(said[i]!)
    }
    await expect(page.getByTestId('tool-settings').first()).toContainText('Paramètres')
  } finally {
    await backToEnglish(page)
  }
})
