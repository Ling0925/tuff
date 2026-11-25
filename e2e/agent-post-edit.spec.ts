import { test, expect } from '@playwright/test'
import { invitationTo, login, openProject, PASSWORD } from './helpers.js'

/*
 * An agent's announcement is changed by whoever connected the agent.
 * Edit behind ⋯ opens its
 * title and words, Done closes them, and the change is kept. A member who
 * did not connect the agent is not offered it. Who may on the server, and
 * through what, is `post-edit-rights.test.ts`.
 */
test('whoever connected an agent edits its announcement; a member who did not is not offered it', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/')
  const stamp = Date.now()
  const email = `kit${stamp}@example.com`

  /* A member onto Onboarding, invited by address — joining by the letter
     (or by the link handed over, on a server with no mail) proves it, and
     an unproved address connects no agent — holding nothing
     beyond being on it; and an announcement there by an agent the owner
     connected. */
  const made = await page.evaluate(
    async ({ n, email }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
      const projects = (await (await fetch('/api/projects', { headers: h })).json()) as { projects: { id: string; name: string }[] }
      const p = projects.projects.find((x) => x.name === 'Onboarding')!
      const invite = await fetch('/api/invites', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ email, project_ids: [p.id], rights: [] }),
      })
      if (!invite.ok) return { error: `invite ${invite.status}` }
      const { token: invitation } = (await invite.json()) as { token?: string }
      const agent = await fetch('/api/agents', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ name: `Owner’s scribe ${n % 100000}`, project_ids: [p.id], reach: 'mcp' }),
      })
      if (!agent.ok) return { error: `agents ${agent.status}` }
      const { token, agent_id } = (await agent.json()) as { token: string; agent_id: string }
      const title = `By the owner’s scribe ${n}`
      const said = await fetch(`/api/projects/${p.id}/posts`, {
        method: 'POST',
        headers: { ...h, authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From the agent.' }] }] },
        }),
      })
      if (!said.ok) return { error: `post ${said.status}` }
      return { projectId: p.id, ownersAgent: agent_id, ownersTitle: title, invitation }
    },
    { n: stamp, email },
  )
  expect('error' in made, JSON.stringify(made)).toBe(false)
  const { projectId, ownersAgent, ownersTitle, invitation } = made as {
    projectId: string
    ownersAgent: string
    ownersTitle: string
    invitation?: string
  }

  const them = await (await browser.newContext()).newPage()
  await them.goto(await invitationTo(email, invitation))
  await them.getByTestId('join-name').fill(`Kit ${stamp}`)
  await them.getByTestId('join-email').fill(email)
  await them.getByTestId('join-password').fill(PASSWORD)
  await them.getByTestId('join').click()
  await expect(them.getByTestId('nav-my')).toBeVisible({ timeout: 20_000 })

  /* The owner says Kit may connect agents; Kit connects one and it writes. */
  const kit = await page.evaluate(async (name) => {
    const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
    const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
    const people = (await (await fetch('/api/people', { headers: h })).json()) as { people: { actor_id: string; name: string }[] }
    const who = people.people.find((x) => x.name === name)!
    const r = await fetch(`/api/people/${who.actor_id}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ may_connect_agents: true }),
    })
    return { id: who.actor_id, status: r.status }
  }, `Kit ${stamp}`)
  expect(kit.status).toBe(200)
  const kits = await them.evaluate(
    async ({ p, n }) => {
      const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
      const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
      const agent = await fetch('/api/agents', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ name: `Kit’s scribe ${n % 100000}`, project_ids: [p], reach: 'mcp' }),
      })
      if (!agent.ok) return { error: `agents ${agent.status}` }
      const { token, agent_id } = (await agent.json()) as { token: string; agent_id: string }
      const title = `By Kit’s scribe ${n}`
      const said = await fetch(`/api/projects/${p}/posts`, {
        method: 'POST',
        headers: { ...h, authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From Kit’s agent.' }] }] },
        }),
      })
      return said.ok ? { agent: agent_id, title } : { error: `post ${said.status}` }
    },
    { p: projectId, n: stamp },
  )
  expect('error' in kits, JSON.stringify(kits)).toBe(false)
  const { agent: kitsAgent, title: kitsTitle } = kits as { agent: string; title: string }

  try {
    await openProject(them, 'Onboarding')
    await them.getByTestId('tool-posts').click()

    /* The owner's agent's: Kit did not connect it, and is offered nothing. */
    await them.locator('[data-open-post]').filter({ hasText: ownersTitle }).first().click()
    await expect(them.getByTestId('post-title')).toHaveValue(ownersTitle, { timeout: 15_000 })
    await expect(them.getByTestId('post-title')).toBeDisabled()
    await them.getByTestId('post-menu').click()
    await expect(them.getByTestId('copy-post-link')).toBeVisible()
    await expect(them.getByTestId('edit-post')).toHaveCount(0)
    await expect(them.getByTestId('delete-post')).toHaveCount(0)
    await them.keyboard.press('Escape')
    await them.getByTestId('close-post').click()

    /* Kit's agent's: shut until Edit, open after it, and kept after Done. */
    await them.locator('[data-open-post]').filter({ hasText: kitsTitle }).first().click()
    const title = them.getByTestId('post-title')
    await expect(title).toHaveValue(kitsTitle, { timeout: 15_000 })
    await expect(title).toBeDisabled()
    const patches: string[] = []
    them.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().includes('/api/posts/')) patches.push(r.postData() ?? '')
    })

    /* Opened and closed with nothing changed — the caret through the title
       and into the words — says nothing to anybody: no PATCH. */
    await them.getByTestId('post-menu').click()
    await them.getByTestId('edit-post').click()
    await expect(title).toBeEnabled()
    await expect(title).toBeFocused()
    await them.getByTestId('post-body').click()
    await them.getByTestId('post-done').click()
    await expect(title).toBeDisabled()
    await them.waitForTimeout(500)
    expect(patches).toEqual([])

    await them.getByTestId('post-menu').click()
    await them.getByTestId('edit-post').click()
    await expect(title).toBeEnabled()
    await expect(title).toBeFocused()
    const fixed = `Fixed by Kit ${stamp}`
    await title.fill(fixed)
    const saved = them.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/posts/'))
    await them.getByTestId('post-done').click()
    expect((await saved).status()).toBe(200)
    /* The title alone: the words were not touched, and are not sent. */
    expect(patches.map((x) => Object.keys(JSON.parse(x)))).toEqual([['title']])
    await expect(title).toBeDisabled()
    await expect(them.getByTestId('post-done')).toHaveCount(0)

    await them.reload()
    await expect(them.getByTestId('post-title')).toHaveValue(fixed, { timeout: 15_000 })
  } finally {
    /* Nothing left in the studio: both agents disconnected, Kit taken out. */
    await page.evaluate(
      async ({ agents, person }) => {
        const s = JSON.parse(localStorage.getItem('session') ?? '{}') as { access_token?: string }
        const h = { authorization: `Bearer ${s.access_token}`, 'x-api-version': '1', 'content-type': 'application/json' }
        for (const id of agents) await fetch(`/api/agents/${id}`, { method: 'DELETE', headers: h })
        await fetch(`/api/people/${person}`, { method: 'DELETE', headers: h, body: JSON.stringify({}) })
      },
      { agents: [ownersAgent, kitsAgent], person: kit.id },
    )
    await them.context().close()
  }
})
