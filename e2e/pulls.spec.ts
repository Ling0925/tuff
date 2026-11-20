import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { test, expect, type Page } from '@playwright/test'
import { add, login, openProject } from './helpers.js'

/*
 * A pull request's state on a task, the way GitHub draws it,
 * The tinted logo and a grey tail of
 * words said nothing anybody could read at a glance; each row is GitHub's
 * glyph for the state in GitHub's colour, the state as a word in a pill, and
 * the checks as a mark of their own.
 *
 * Nothing talks to GitHub here: the rows the webhook would have written are
 * written straight in, as the tables' owner, and taken out again after.
 */
const require = createRequire(new URL('../server/package.json', import.meta.url))
const postgres = require('postgres') as typeof import('postgres').default

/* Pictures for the task, light and dark, when asked for: `SHOTS_DIR=…`. */
const shot = async (page: Page, name: string) => {
  if (!process.env.SHOTS_DIR) return
  const pulls = page.getByTestId('task-pulls')
  await pulls.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-light.png` })
  await page.emulateMedia({ colorScheme: 'dark' })
  await pulls.screenshot({ path: `${process.env.SHOTS_DIR}/${name}-dark.png` })
  await page.emulateMedia({ colorScheme: 'light' })
}

const PULLS = [
  {
    number: 41,
    title: 'Sign-in errors say what went wrong',
    state: 'open',
    draft: false,
    review: 'approved',
    checks: 'success',
    closes: true,
  },
  {
    number: 38,
    title: 'Move the session check into one place',
    state: 'merged',
    draft: false,
    review: 'approved',
    checks: 'success',
    closes: false,
  },
  {
    number: 35,
    title: 'Try a second cookie for the refresh token',
    state: 'closed',
    draft: false,
    review: null,
    checks: 'failure',
    closes: false,
  },
  {
    number: 44,
    title: 'Remember the last workspace on this device',
    state: 'open',
    draft: true,
    review: null,
    checks: 'pending',
    closes: false,
  },
] as const

test('each pull request on a task shows its state as GitHub does: glyph, colour, a word in a pill, and its checks', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  const title = `Pulls ${Date.now()}`
  await add(page, 'new-task', title)

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  const made: { install?: string; link?: string; pulls: string[] } = { pulls: [] }
  try {
    const [task] = await sql<{ id: string; workspace_id: string; project_id: string; author_id: string }[]>`
      select id, workspace_id, project_id, author_id from task where title = ${title} and deleted_at is null`
    expect(task).toBeTruthy()
    const t = task!
    const [had] = await sql<{ id: string }[]>`
      select id from github_install where workspace_id = ${t.workspace_id} and deleted_at is null`
    let install = had?.id
    if (!install) {
      install = randomUUID()
      await sql`
        insert into github_install (id, workspace_id, installation_id, account_login, account_type, installed_by)
        values (${install}, ${t.workspace_id}, ${900_000_000 + Math.floor(Math.random() * 99_999_999)}, 'studio', 'Organization', ${t.author_id})`
      made.install = install
    }
    const [linked] = await sql<{ id: string }[]>`
      select id from github_link where project_id = ${t.project_id} and deleted_at is null`
    let link = linked?.id
    if (!link) {
      link = randomUUID()
      await sql`
        insert into github_link (id, workspace_id, project_id, install_id, repo_id, repo_name, private, linked_by)
        values (${link}, ${t.workspace_id}, ${t.project_id}, ${install}, ${900_000_000 + Math.floor(Math.random() * 99_999_999)},
                'studio/website', true, ${t.author_id})`
      made.link = link
    }
    for (const [i, p] of PULLS.entries()) {
      const id = randomUUID()
      made.pulls.push(id)
      await sql`
        insert into github_pull (id, workspace_id, project_id, link_id, number, title, url, author_login, state, draft, review, checks, updated_at)
        values (${id}, ${t.workspace_id}, ${t.project_id}, ${link}, ${made.link ? p.number : 10_000 + Math.floor(Math.random() * 80_000)}, ${p.title},
                ${`https://github.com/studio/website/pull/${p.number}`}, 'yuri', ${p.state}, ${p.draft}, ${p.review}, ${p.checks},
                now() - ${`${i} minutes`}::interval)`
      await sql`
        insert into github_pull_task (workspace_id, project_id, pull_id, task_id, closes)
        values (${t.workspace_id}, ${t.project_id}, ${id}, ${t.id}, ${p.closes})`
    }

    await page.locator('[data-open-task]').filter({ hasText: title }).click()
    await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 15_000 })
    await page.reload()
    const section = page.getByTestId('task-pulls')
    await expect(section).toBeVisible({ timeout: 15_000 })
    const rows = section.locator('a[data-pull]')
    await expect(rows).toHaveCount(4)

    const row = (n: number) => rows.nth(n)
    // Open, approved, checks passing, and it closes the task.
    await expect(row(0).locator('[data-pull-state]')).toHaveText('Open')
    await expect(row(0).locator('[data-pull-state]')).toHaveAttribute('data-pull-state', 'open')
    await expect(row(0)).toContainText('Approved')
    await expect(row(0).getByRole('img', { name: 'Checks passed' })).toBeVisible()
    await expect(row(0)).toContainText('Closes it')
    // Merged and closed: the reviewers and the checks are over, so not said.
    await expect(row(1).locator('[data-pull-state]')).toHaveText('Merged')
    await expect(row(1)).not.toContainText('Approved')
    await expect(row(1).locator('[data-checks]')).toHaveCount(0)
    await expect(row(2).locator('[data-pull-state]')).toHaveText('Closed')
    await expect(row(2).locator('[data-checks]')).toHaveCount(0)
    // A draft is a draft before it is open, and its checks are running.
    await expect(row(3).locator('[data-pull-state]')).toHaveText('Draft')
    await expect(row(3).getByRole('img', { name: 'Checks running' })).toBeVisible()

    // Each opens on GitHub, every row is one height, and nothing is wider than the row.
    await expect(row(0)).toHaveAttribute('href', 'https://github.com/studio/website/pull/41')
    for (let i = 0; i < 4; i++) {
      const box = (await row(i).boundingBox())!
      expect(box.height).toBe(48)
      const over = await row(i).evaluate((a) => {
        const edge = a.getBoundingClientRect().right
        return [...a.querySelectorAll('*')].some((el) => el.getBoundingClientRect().right > edge + 0.5)
      })
      expect(over).toBe(false)
      // The pill is never shortened.
      const pill = row(i).locator('[data-pull-state]')
      expect(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    await shot(page, 'pulls-desktop')

    // On a phone the title gives way, the pill does not, and "Closes it" goes.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rows).toHaveCount(4)
    await expect(row(0).getByText('Closes it')).toBeHidden()
    await expect(row(0).locator('[data-pull-state]')).toHaveText('Open')
    for (let i = 0; i < 4; i++) {
      const over = await row(i).evaluate((a) => {
        const edge = a.getBoundingClientRect().right
        return [...a.querySelectorAll('*')].some((el) => el.getBoundingClientRect().right > edge + 0.5)
      })
      expect(over).toBe(false)
      const pill = row(i).locator('[data-pull-state]')
      expect(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    await shot(page, 'pulls-phone')
  } finally {
    if (made.pulls.length) await sql`delete from github_pull where id in ${sql(made.pulls)}`
    if (made.link) await sql`delete from github_link where id = ${made.link}`
    if (made.install) await sql`delete from github_install where id = ${made.install}`
    await sql.end()
  }
})
