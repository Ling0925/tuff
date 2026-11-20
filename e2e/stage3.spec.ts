import { test, expect, type Locator, type Page } from '@playwright/test'
import { add, close, drawnWhole, login, make, openProject, settleThenReload } from './helpers.js'

async function openChat(page: Page) {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-messages').click()
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 30_000 })
}

test('a project can hold more than one room, and both are offered', async ({ page }) => {
  await openChat(page)
  // Separate rooms on one project, not one room with a filter — a filter is
  // something somebody forgets, and the people left out never find out. Both
  // are in the channel chooser on the project's bar, which is where choosing
  // between them belongs; the room itself is for reading.
  await expect(page.locator('[data-room="main"]')).toBeVisible()
  await expect(page.locator('[data-room="launch"]')).toBeVisible()
})

test('a message arrives and can become a task', async ({ page }) => {
  await openChat(page)
  const said = `Shall we move the launch ${Date.now()}`
  await page.getByLabel('Message').fill(said)
  await page.getByLabel('Message').press('Enter')
  await expect(page.getByText(said)).toBeVisible({ timeout: 15_000 })

  // What was decided in a thread stops living only in the thread.
  //
  // Reached over the message, the way a person reaches it: what can be done
  // to a message is a card that appears beside it on hover, and it takes the
  // pointer only while it is showing. Invisible and still clickable is the
  // state that put a dead strip across every card on the board.
  const message = page.locator('[data-message]').filter({ hasText: said })
  await message.hover()
  // Behind the card's ⋯, with the other things done to a message.
  await message.getByTestId('message-menu').click()
  await page.getByTestId('make-task-from-message').click()

  await page.getByTestId('tool-tasks').click()
  await expect(page.getByText(said)).toBeVisible({ timeout: 15_000 })
})

/*
 * The same channel opened from the column offers the same thing: what the
 * room's project lets this person do, not what the column knows — the
 * button was there inside the project and missing from here.
 */
test('a project channel opened from the column turns a message into a task too', async ({ page }) => {
  await login(page)
  await page.locator('aside').getByText('acme-rebrand-main', { exact: true }).click()
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 30_000 })
  const said = `From the column ${Date.now()}`
  await page.getByLabel('Message').fill(said)
  await page.getByLabel('Message').press('Enter')
  const message = page.locator('[data-message]').filter({ hasText: said })
  await expect(message).toBeVisible({ timeout: 15_000 })
  await message.hover()
  await message.getByTestId('message-menu').click()
  await expect(page.getByTestId('make-task-from-message')).toBeVisible()
})

test('a reply goes into its thread, not into the channel', async ({ page }) => {
  await openChat(page)
  const root = `Root ${Date.now()}`
  await page.getByLabel('Message').fill(root)
  await page.getByLabel('Message').press('Enter')
  await expect(page.getByText(root)).toBeVisible({ timeout: 15_000 })

  const rootMessage = page.locator('[data-history] [data-message]').filter({ hasText: root })
  await rootMessage.hover()
  await rootMessage.getByRole('button', { name: 'Reply in thread' }).click()

  // The thread opens beside the room, with the message it hangs off at its
  // head and a line of its own — `docs/specs/chat-threads.md`.
  const pane = page.locator('[data-thread]')
  await expect(pane.locator('[data-message]').first()).toContainText(root)
  const reply = `Reply ${Date.now()}`
  await pane.getByLabel('Message').fill(reply)
  await pane.getByLabel('Message').press('Enter')
  await expect(pane.getByText(reply)).toBeVisible({ timeout: 15_000 })
  // And the room counts it under the message it answers.
  await expect(rootMessage.getByTestId('open-thread')).toContainText('1 reply')
  // With the face of who answered, and when.
  await expect(rootMessage.locator('[data-replier-faces] > *')).toHaveCount(1, { timeout: 15_000 })
  await expect(rootMessage.getByTestId('open-thread')).toContainText('Last reply')

  // In the channel the reply is not at the top level: the room is not one
  // flat river, which is what keeps it readable.
  // The message whose thread is open is lit, and lets go when it shuts.
  await expect(rootMessage).toHaveAttribute('data-thread-open')
  await page.getByTestId('close-thread').click()
  await expect(pane).toHaveCount(0)
  await expect(rootMessage).not.toHaveAttribute('data-thread-open')
  const room = page.locator('[data-history]')
  await expect(room.getByText(root)).toBeVisible()
  await expect(room.getByText(reply)).toHaveCount(0)
})

/* A reply's link opens the room at the message
   it answers, with the thread open, wherever it is pasted. */
test('a reply’s link is copied from its menu, and opens its thread', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await openChat(page)
  const root = `Linked root ${Date.now()}`
  await page.getByLabel('Message').fill(root)
  await page.getByLabel('Message').press('Enter')
  const rootMessage = page.locator('[data-history] [data-message]').filter({ hasText: root })
  await expect(rootMessage).toBeVisible({ timeout: 15_000 })
  await rootMessage.hover()
  await rootMessage.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  const reply = `Linked reply ${Date.now()}`
  await pane.getByLabel('Message').fill(reply)
  /* Kept by the server, not only drawn: the reply is on the screen before
     its POST lands, and leaving the page below took the POST with it on a
     slow run — the link then opened a thread with nothing in it. */
  const kept = page.waitForResponse(
    (r) =>
      /\/messages$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST' && (r.request().postData() ?? '').includes(reply),
    { timeout: 15_000 },
  )
  await pane.getByLabel('Message').press('Enter')
  const replyMessage = pane.locator('[data-message]').filter({ hasText: reply })
  await expect(replyMessage).toBeVisible({ timeout: 15_000 })
  expect((await kept).ok()).toBe(true)

  await replyMessage.hover()
  await replyMessage.getByTestId('message-menu').click()
  await page.getByTestId('copy-message-link').click()
  await expect(replyMessage.getByRole('status')).toHaveText('Link copied')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toMatch(/\/chat\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/)

  await page.goto('/')
  await page.goto(link)
  // The message it answers lit in the room, as the room's own search opens
  // a reply, and the thread open beside it with the reply in it.
  await expect(page.locator('[data-history] [data-message][data-found-at]').filter({ hasText: root })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-thread] [data-message]').filter({ hasText: reply })).toBeVisible({ timeout: 15_000 })
})

test('a project comes with its channel, however it was made', async ({ page }) => {
  /* Tall, so the column has room for every room: in a full run the other
     tests' channels put a new one behind "n more". */
  await page.setViewportSize({ width: 1280, height: 2400 })
  await login(page)

  /*
   * Not a thing to switch on afterwards.
   *
   * A conversation you have to create per project is one nobody has: the
   * first person to want it has to know it is missing, know where to make
   * it, and name it — and by then they have gone to Slack. The server opens
   * one with every project it creates, and this holds it to that.
   */
  const name = `Fresh ${Date.now()}`
  await add(page, 'new-project', name)
  await openProject(page, name)
  await page.getByTestId('tool-messages').click()

  // Ready to be typed into, not a screen offering to make one.
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-room="main"]')).toBeVisible()

  // And reachable from the sidebar without opening the project, because the
  // reason to come back to a conversation is the conversation.
  await expect(
    // One line, the project's address and the room's.
    page.locator('aside [data-room]').filter({ hasText: `${name.toLowerCase().replace(' ', '-')}-main` }),
  ).toBeVisible({ timeout: 15_000 })
})

test('a channel says who is in it, and can be made for some of them', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-messages').click()
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 30_000 })

  /*
   * Who is in a room was never said anywhere.
   *
   * A channel for four people out of nine looked exactly like one for all
   * nine, and the only way to find out which you were in was to say something
   * and see who answered.
   */
  await expect(page.locator('[data-members][data-open]')).toBeVisible()

  await page.getByTestId('create-new-channel').click()
  const name = `just-us-${Date.now()}`
  await page.getByTestId('draft-new-channel').fill(name)

  /* Nobody chosen is the common case and means the project. Choosing is what
     makes it a room of its own.

     Somebody named, not whoever is first. The roster is ordered by name, so
     "first" used to be a colleague and became the signed-in person the day
     the seed's names changed — after which this ticked itself, made a room
     of one, and still counted. */
  await page.locator('[data-pick-member]').filter({ hasText: 'Sam' }).locator('input').check()
  await page.getByTestId('make-channel').click()

  /* And it is the room on the screen, without being looked for at the end
     of the strip. */
  await expect(page.locator('main').locator(`[data-room="${name}"]`)).toHaveAttribute('data-on', 'true', {
    timeout: 15_000,
  })

  // Two: whoever was chosen, and whoever made it — a room you cannot see is
  // not a room, it is a mistake with a name. Asserted on the count rather
  // than on the sentence, which says names while there are few of them.
  await expect(page.locator('[data-members="2"]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-members][data-open]')).toHaveCount(0)
})

/*
 * The clock a machine set to en-US draws, which is where this broke.
 */
test.describe('a twelve-hour clock', () => {
  test.use({ locale: 'en-US' })

  test('the time beside a message stands on one line', async ({ page }) => {
    await openChat(page)
    const stamp = Date.now()
    // Two in a row from one person: the second is a continuation, and the
    // time stands where the avatar would be.
    for (const n of ['one', 'two']) {
      await page.getByLabel('Message').fill(`${n} ${stamp}`)
      await page.getByLabel('Message').press('Enter')
      await expect(page.getByText(`${n} ${stamp}`)).toBeVisible({ timeout: 15_000 })
    }
    const row = page.locator('[data-message]').last()
    await row.hover()

    const slot = row.locator('span').first()
    /*
     * The gutter is exactly as wide as the avatar it stands in for, so that
     * the words of every message in a run begin in the same column. Thirty-two
     * pixels holds "04:57" and does not hold "04:57 PM": the PM wrapped, and
     * the message stood two lines tall to say one thing.
     */
    await expect(slot).toHaveText(/^\d{1,2}[:.]\d{2}$/)
    const box = (await slot.boundingBox())!
    expect(box.height).toBeLessThan(24)

    // And the line that has room for it keeps the half of the day.
    await expect(page.locator('[data-message]').first()).toContainText(/\d{1,2}:\d{2}\s?(AM|PM)/)
  })
})

/* `docs/specs/chat-threads.md`. */
test('a message takes reactions, and says when it has become a task', async ({ page }) => {
  await openChat(page)
  const said = `React to me ${Date.now()}`
  await page.getByLabel('Message').fill(said)
  await page.getByLabel('Message').press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await expect(message).toBeVisible({ timeout: 15_000 })

  await message.hover()
  await message.getByTestId('add-reaction').click()
  await page.locator('[data-emoji]').first().click()
  const thumbs = message.locator('[data-reaction="👍"]')
  await expect(thumbs).toHaveText(/1/)
  await expect(thumbs).toHaveAttribute('aria-pressed', 'true')
  // The ones reached for most stand on the card, one press each: 👍 is
  // among them, and pressing it there takes it back.
  await message.hover()
  await message.locator('[data-quick-reaction="👍"]').click()
  await expect(message.locator('[data-reaction="👍"]')).toHaveCount(0)
  await message.hover()
  await message.locator('[data-quick-reaction="👍"]').click()
  await expect(message.locator('[data-reaction="👍"]')).toHaveText(/1/)
  // Who, under the pointer, as a sentence.
  await thumbs.hover()
  await expect(message.locator('[data-reaction-who]')).toContainText('You reacted')
  /* It is the server's, not only the screen's: a reload still has it —
     once the server has heard the press. A reload straight after it
     cancelled the PUT still on its way. */
  await settleThenReload(page, '/reactions/')
  await expect(page.locator('[data-history] [data-message]').filter({ hasText: said }).locator('[data-reaction="👍"]')).toHaveText(/1/, {
    timeout: 15_000,
  })
  // Pressed again, it is taken back.
  const again = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await again.locator('[data-reaction="👍"]').click()
  await expect(again.locator('[data-reaction]')).toHaveCount(0)

  await again.hover()
  await again.getByTestId('message-menu').click()
  await page.getByTestId('make-task-from-message').click()
  // What it became, as the task's card.
  await expect(again.locator('[data-made-task] [data-task-card]')).toContainText(said, { timeout: 15_000 })
  // The room's, not this tab's: a reload still draws it, and it is not
  // offered to be made into a task a second time.
  await page.reload()
  const made = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await expect(made.locator('[data-made-task] [data-task-card]')).toContainText(said, { timeout: 15_000 })
  await made.hover()
  await made.getByTestId('message-menu').click()
  await expect(page.getByTestId('make-task-from-message')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await made.locator('[data-made-task] [data-task-card]').click()
  // The task it became, open, in a list — not made and nowhere.
  await expect(page.getByTestId('task-title')).toHaveValue(said, { timeout: 15_000 })
})

/* `docs/specs/person-card.md`. */
test('a face in the room opens their card, and the card opens a conversation', async ({ page }) => {
  await openChat(page)
  const theirs = page.locator('[data-history] [data-message]').filter({ hasNotText: 'Dev' }).first()
  await expect(theirs).toBeVisible({ timeout: 15_000 })
  const name = (await theirs.locator('.font-medium').first().innerText()).trim()
  await theirs.getByTestId('person-face').first().click()
  const card = page.locator('[data-person-card]')
  await expect(card.getByTestId('person-card-name')).toHaveText(name)
  await card.getByTestId('person-card-message').click()
  // The direct conversation with them, at its own address.
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toMatch(/\/chat\/[0-9a-f-]{36}$/)
})

/* `docs/specs/removing-someone.md`: a direct conversation with somebody removed
   stays readable and has no line to write on. The server's answer stood in
   for: removing a fixture's person would take them from every other test. */
test('a conversation with somebody removed says so, and takes nothing more', async ({ page }) => {
  await page.route('**/api/conversations', async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const real = await r.fetch()
    const said = (await real.json()) as { conversations: { channel?: boolean; others_gone?: boolean }[] }
    for (const c of said.conversations) if (!c.channel) c.others_gone = true
    await r.fulfill({ response: real, json: said })
  })
  await openChat(page)
  const theirs = page.locator('[data-history] [data-message]').filter({ hasNotText: 'Dev' }).first()
  await expect(theirs).toBeVisible({ timeout: 15_000 })
  const name = (await theirs.locator('.font-medium').first().innerText()).trim()
  await theirs.getByTestId('person-face').first().click()
  await page.locator('[data-person-card]').getByTestId('person-card-message').click()
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toMatch(/\/chat\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('room-gone')).toContainText(`${name} is no longer in this workspace`, { timeout: 15_000 })
  await expect(page.getByLabel('Message')).toHaveCount(0)
  // A list still being read when the test ends is not a fault of the test.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/* `docs/specs/sidebar.md`, "The Chats page": a conversation with somebody who
   left is kept out of the column and the palette, and listed at the foot of
   the Chats page, which the column's Chat heading opens. One direct
   conversation is made to say so, as above. */
test('a chat with somebody who left is off the list and on the Chats page', async ({ page }) => {
  // A direct conversation of one's own, started from a face in a room.
  await openChat(page)
  const theirs = page.locator('[data-history] [data-message]').filter({ hasNotText: 'Dev' }).first()
  await expect(theirs).toBeVisible({ timeout: 15_000 })
  const others = (await theirs.locator('.font-medium').first().innerText()).trim()
  await theirs.getByTestId('person-face').first().click()
  await page.locator('[data-person-card]').getByTestId('person-card-message').click()
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toMatch(/\/chat\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/').pop() as string

  // And then they leave: the server says so from here on.
  await page.route('**/api/conversations', async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const real = await r.fetch()
    const said = (await real.json()) as { conversations: { id: string; others_gone?: boolean }[] }
    for (const c of said.conversations) if (c.id === id) c.others_gone = true
    await r.fulfill({ response: real, json: said })
  })
  await page.reload()
  await expect(page.getByTestId('room-gone')).toBeVisible({ timeout: 15_000 })
  // Not in the column, whatever is folded under "more".
  const more = page.locator('aside [data-testid="show-more"]').last()
  if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) === 'false') await more.click()
  await expect(page.locator(`aside [data-room][title="${others}"]`)).toHaveCount(0)

  // The heading opens every room, those with people who left at the foot —
  // drawn whole, from what the column already had.
  const heights = await drawnWhole(page, '[data-chats-page]', () => page.getByTestId('nav-chats').click())
  expect(heights.length).toBe(1)
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/\/chat$/)
  await expect(page.locator('[data-chat-row]').first()).toBeVisible()
  await expect(page.locator(`[data-chat-row="${others}"]`)).toHaveCount(0)
  const section = page.locator('[data-left-chats]')
  await expect(section).toContainText('People who left · 1')
  await section.locator(`[data-left-row="${others}"]`).click()

  // Opened as before: the history, and no line to write on.
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toMatch(new RegExp(`/chat/${id}$`))
  await expect(page.getByTestId('room-gone')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Message')).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/* `docs/specs/message-edit.md`. */
test('a message is edited in place, its file taken out, and then deleted', async ({ page }) => {
  await openChat(page)
  const stamp = Date.now()
  // A message with a picture on it.
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles({
      name: `edit-${stamp}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR42u3OMQEAAAgDoC251a3gLzRgcrcpAQEBAQEBAQEBAQGBHwtGFgABRpW1ugAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  // Sent at once, while the bytes may still be going up: the message waits
  // for the file rather than leaving without it.
  const field = page.getByLabel('Message')
  await field.fill(`Teh plan ${stamp}`)
  /* The server has it before it is changed: an edit of a row still on its
     way is a test racing itself. Listened for before it is sent — waited
     for after, the read that follows it had often come and gone. */
  const kept = page.waitForResponse(
    (r) => /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 20_000 },
  )
  await field.press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: `plan ${stamp}` })
  await expect(message.locator('[data-attachment]')).toHaveCount(1, { timeout: 20_000 })
  await expect(message.locator('[data-message-uploading]')).toHaveCount(0)
  expect((await kept).status()).toBe(201)

  await message.hover()
  await message.getByTestId('message-menu').click()
  await page.getByTestId('edit-message').click()
  const editor = message.locator('[data-message-editor]')
  await expect(editor.locator('[data-message-field]')).toBeFocused()
  await editor.getByTestId('drop-message-extra').click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type(`The plan ${stamp}`)
  await page.keyboard.press('Enter')

  await expect(message).toContainText(`The plan ${stamp}`)
  await expect(message.locator('[data-edited]')).toBeVisible()
  await expect(message.locator('[data-attachment]')).toHaveCount(0)
  // The server's, not only the screen's.
  await page.reload()
  const again = page.locator('[data-history] [data-message]').filter({ hasText: `The plan ${stamp}` })
  await expect(again.locator('[data-edited]')).toBeVisible({ timeout: 15_000 })
  await expect(again.locator('[data-attachment]')).toHaveCount(0)

  // Deleted, behind one more press.
  await again.hover()
  await again.getByTestId('message-menu').click()
  await page.getByTestId('delete-message').click()
  await page.getByTestId('confirm-delete-message').click()
  await expect(again).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-history]').getByText(`The plan ${stamp}`)).toHaveCount(0, { timeout: 15_000 })
})

/*
 * A picture keeps its room and shows itself blurred until it arrives.
 * It opened as a small grey box and grew.
 */
test('a picture in a message holds its size and shows a blurred glance while it loads', async ({ page }) => {
  await openChat(page)
  const stamp = Date.now()
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles({
      name: `wide-${stamp}.png`,
      mimeType: 'image/png',
      // 80 × 40, one colour: enough for a size and a glance.
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
        'base64',
      ),
    })
  await expect(page.locator('[data-attached] [data-holding]')).toHaveCount(1, { timeout: 20_000 })
  const field = page.getByLabel('Message')
  await field.fill(`Glance ${stamp}`)
  const sent = page.waitForResponse((r) => r.url().includes('/messages') && r.request().method() === 'POST')
  await field.press('Enter')
  await sent

  // Read again with the bytes held back — and not from the cache, which
  // already holds them from the sending: the room is the picture's shape,
  // filled with the glance, before any of it has arrived.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await page.route('**/api/blob/**', async (r) => {
    await new Promise((ok) => setTimeout(ok, 3000))
    await r.continue()
  })
  await page.reload()
  const message = page.locator('[data-history] [data-message]').filter({ hasText: `Glance ${stamp}` })
  await expect(message.locator('[data-glance]')).toHaveCount(1, { timeout: 15_000 })
  const box = await message.locator('img[data-attachment]').boundingBox()
  // Twice as wide as tall, as the picture is — kept before it arrives.
  expect(box && Math.abs(box.width - 2 * box.height)).toBeLessThan(2)
  // And it goes when the picture is in.
  await expect(message.locator('[data-glance]')).toHaveCount(0, { timeout: 15_000 })
})

/* `docs/specs/history.md` — kept at the bottom while it fills. */
test('a room opened at its last message stays there while its pictures arrive', async ({ page }) => {
  test.setTimeout(90_000)
  await openChat(page)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  const h = { authorization: `Bearer ${token}`, 'x-api-version': '1' }
  const room = await page.evaluate(async (hh) => {
    const all = (await (await fetch('/api/conversations', { headers: hh })).json()) as {
      conversations: { id: string; project_id: string | null; name: string | null }[]
    }
    const projects = (await (await fetch('/api/projects', { headers: hh })).json()) as { projects: { id: string; name: string }[] }
    const acme = projects.projects.find((p) => p.name === 'Acme rebrand')!
    return { id: all.conversations.find((c) => c.project_id === acme.id && c.name === 'main')!.id, project: acme.id }
  }, h)
  // A picture sent the old way — no size on its node — so it grows when it lands.
  // 1200 × 700, one colour: far taller than the box drawn before it loads.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAABLAAAAK8CAIAAABwUdHZAAANb0lEQVR42u3XMQEAMAjAsDE5mEMwZtDATSKhXyOrHwAAAPd8CQAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAGEIJAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAAAYQgkAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAABDCAAAgCEEAABgbwAM4wbsjxPdhgAAAABJRU5ErkJggg==',
    'base64',
  )
  const up = (await (
    await page.request.post(`/api/projects/${room.project}/uploads`, {
      headers: h,
      multipart: { file: { name: 'old.png', mimeType: 'image/png', buffer: png } },
    })
  ).json()) as { id?: string; file?: { id: string } }
  const fileId = up.id ?? up.file?.id
  const say = (content: unknown[]) =>
    page.request.post(`/api/conversations/${room.id}/messages`, {
      headers: { ...h, 'content-type': 'application/json' },
      data: { body: { type: 'doc', content } },
    })
  for (let i = 0; i < 25; i++) await say([{ type: 'paragraph', content: [{ type: 'text', text: `Filler ${i}` }] }])
  for (let i = 0; i < 3; i++) {
    await say([
      { type: 'paragraph', content: [{ type: 'text', text: `Old picture ${i}` }] },
      { type: 'attachment', attrs: { fileId, name: 'old.png', kind: 'image' } },
    ])
  }
  const last = `The last word ${Date.now()}`
  await say([{ type: 'paragraph', content: [{ type: 'text', text: last }] }])

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await page.route('**/api/blob/**', async (r) => {
    await new Promise((ok) => setTimeout(ok, 1000))
    /* Let go of after the route is taken off below, a picture still held
       here has been sent on already, and continuing it again threw. */
    await r.continue().catch(() => {})
  })
  await page.reload()
  const sheet = page.locator('[data-history]')
  await expect(sheet.getByText(last)).toBeVisible({ timeout: 15_000 })
  // After the pictures are in, still at the bottom.
  await expect(sheet.locator('img[data-attachment]').last()).toHaveJSProperty('complete', true, { timeout: 15_000 })
  await page.waitForTimeout(300)
  const gap = await sheet.evaluate((b) => b.scrollHeight - b.scrollTop - b.clientHeight)
  expect(gap).toBeLessThan(24)

  /* And every time, not every other time: with the pictures in the cache
     they grow in the same frame the sheet is put at the bottom, and that
     race lost about four reloads in ten. */
  await page.unroute('**/api/blob/**')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  for (let k = 0; k < 6; k++) {
    await page.reload()
    await expect(sheet.getByText(last)).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(400)
    expect(await sheet.evaluate((b) => b.scrollHeight - b.scrollTop - b.clientHeight)).toBeLessThan(24)
  }
})

/* A picture's copy for showing. */
test('a large picture is drawn from its copy, and opens and saves as the original', async ({ page }) => {
  await openChat(page)
  const stamp = Date.now()
  // 2400 × 1400: larger than a body ever draws it.
  const copied = page.waitForResponse((r) => /\/api\/files\/[^/]+\/display$/.test(r.url()) && r.request().method() === 'POST')
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles({
      name: `big-${stamp}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAACWAAAAV4CAIAAACrCnG7AAA9N0lEQVR42uzdS04dSbeAUVy6fSYJo4LxuWsheQC3USX/LgrDeeQjIr61JoCUjdyh/Z1Ivv388f0BAAAAAAAAaPjLIwAAAAAAAIAOgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACAEIEQAAAAAAAAQgRCAAAAAAAACBEIAQAAAAAAIEQgBAAAAAAAgBCBEAAAAAAAAEIEQgAAAAAAAAgRCAEAAAAAACBEIAQAAAAAAIAQgRAAAAAAAABCBEIAAAAAAAAIEQgBAAAAAAAgRCAEAAAAAACA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CAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMCIIAQAAAAAAIARQQgAAAAAAAAjghAAAAAAAABGBCEAAAAAAACMCEIAAAAAAAAYEYQAAAAAAAAwIggBAAAAAABgRBACAAAAAADAiCAEAAAAAACAEUEIAAAAAAAAI4IQAAAAAAAARgQhAAAAAAAAjAhCAAAAAAAAGBGEAAAAAAAAMCIIAQAAAAAAYEQQAgAAAAAAwIggBAAAAAAAgBFBCAAAAAAAACOCEAAAAAAAAEYEIQAAAAAAAIwIQgAAAAAAABgRhAAAAAAAADAiCAEAAAAAAGBEEAIAAAAAAMBIE8ga3II2fcAAAAAASUVORK5CYII=',
        'base64',
      ),
    })
  expect((await copied).status()).toBe(204)
  const field = page.getByLabel('Message')
  await field.fill(`Big ${stamp}`)
  await field.press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: `Big ${stamp}` })
  await expect(message.locator('img[data-attachment]')).toHaveCount(1, { timeout: 15_000 })

  // Read again by a browser that does not hold the bytes: the body draws the copy.
  await page.reload()
  const img = page
    .locator('[data-history] [data-message]')
    .filter({ hasText: `Big ${stamp}` })
    .locator('img[data-attachment]')
  await expect(img).toHaveJSProperty('complete', true, { timeout: 15_000 })
  const id = (await img.getAttribute('data-attachment'))!
  const links = await page.evaluate(async (fid) => {
    const t = JSON.parse(localStorage.getItem('session')!).access_token as string
    return (await (await fetch(`/api/files/${fid}/url`, { headers: { authorization: `Bearer ${t}`, 'x-api-version': '1' } })).json()) as {
      url: string
      display_url: string | null
    }
  }, id)
  expect(links.display_url).toBeTruthy()
  expect(await img.getAttribute('src')).toBe(links.display_url)
  // A sixth of the original's width or so, not all 2400 of it.
  expect(await img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(1600)

  // Opened, it becomes the original.
  await img.click()
  await expect(page.locator('[data-lightbox] img')).toHaveAttribute('src', links.url, { timeout: 15_000 })
})

/* `data/warm.ts` — a room hovered in the sidebar opens with its pictures in. */
test('a room warmed from the sidebar opens with its pictures already sharp', async ({ page }) => {
  await openChat(page)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  const h = { authorization: `Bearer ${token}`, 'x-api-version': '1' }
  const where = await page.evaluate(async (hh) => {
    const all = (await (await fetch('/api/conversations', { headers: hh })).json()) as {
      conversations: { id: string; project_id: string | null; name: string | null }[]
    }
    const projects = (await (await fetch('/api/projects', { headers: hh })).json()) as { projects: { id: string; name: string }[] }
    const web = projects.projects.find((p) => p.name === 'Website')!
    return { id: all.conversations.find((c) => c.project_id === web.id && c.name === 'main')!.id, project: web.id }
  }, h)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
    'base64',
  )
  const up = (await (
    await page.request.post(`/api/projects/${where.project}/uploads`, {
      headers: h,
      multipart: { file: { name: 'warm.png', mimeType: 'image/png', buffer: png } },
    })
  ).json()) as { id: string }
  const said = `Warm ${Date.now()}`
  await page.request.post(`/api/conversations/${where.id}/messages`, {
    headers: { ...h, 'content-type': 'application/json' },
    data: {
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: said }] },
          {
            type: 'attachment',
            attrs: {
              fileId: up.id,
              name: 'warm.png',
              kind: 'image',
              pixelWidth: 80,
              pixelHeight: 40,
              blur: `data:image/png;base64,${png.toString('base64')}`,
            },
          },
        ],
      },
    },
  })

  // The hand passes over the room in the sidebar; its pictures come in.
  const warmed = page.waitForResponse((r) => r.url().includes('/api/blob/') && r.ok())
  await page.locator('aside [data-room]').filter({ hasText: 'website-main' }).first().hover()
  await warmed

  // Opened: the picture is drawn from what was fetched ahead — watched from
  // before the press, a glance never appears, not even for a frame.
  await page.evaluate(() => {
    const w = window as unknown as { glanced: boolean }
    w.glanced = false
    new MutationObserver(() => {
      if (document.querySelector('[data-history] [data-glance]')) w.glanced = true
    }).observe(document.body, { subtree: true, childList: true })
  })
  await page.locator('aside [data-room]').filter({ hasText: 'website-main' }).first().click()
  const message = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await expect(message.locator('img[data-attachment]')).toHaveJSProperty('complete', true, { timeout: 5000 })
  expect(await page.evaluate(() => (window as unknown as { glanced: boolean }).glanced)).toBe(false)
})

/* `data/warm.ts` — a project's rooms are warmed while somebody is in it. */
test('a project warms its rooms, so its Chat tab opens with pictures sharp', async ({ page }) => {
  await login(page)
  /* A project of its own: a shared one holds every picture earlier tests
     sent, and the room's first page is then other people's pictures. */
  const fresh = `Warm ${Date.now()}`
  await add(page, 'new-project', fresh)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  const h = { authorization: `Bearer ${token}`, 'x-api-version': '1' }
  const where = await page.evaluate(
    async (hh) => {
      const all = (await (await fetch('/api/conversations', { headers: hh })).json()) as {
        conversations: { id: string; project_id: string | null; name: string | null }[]
      }
      const projects = (await (await fetch('/api/projects', { headers: hh })).json()) as { projects: { id: string; name: string }[] }
      const p = projects.projects.find((x) => x.name === hh.fresh)!
      return { id: all.conversations.find((c) => c.project_id === p.id)!.id, project: p.id }
    },
    { ...h, fresh },
  )
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
    'base64',
  )
  const up = (await (
    await page.request.post(`/api/projects/${where.project}/uploads`, {
      headers: h,
      multipart: { file: { name: 'warm.png', mimeType: 'image/png', buffer: png } },
    })
  ).json()) as { id: string }
  const said = `In the project ${Date.now()}`
  await page.request.post(`/api/conversations/${where.id}/messages`, {
    headers: { ...h, 'content-type': 'application/json' },
    data: {
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: said }] },
          {
            type: 'attachment',
            attrs: {
              fileId: up.id,
              name: 'warm.png',
              kind: 'image',
              pixelWidth: 80,
              pixelHeight: 40,
              blur: `data:image/png;base64,${png.toString('base64')}`,
            },
          },
        ],
      },
    },
  })

  // In the project, on its tasks: its room's pictures come in by themselves.
  /* Until everything it asked for has come in — the bytes may come from the
     network or from what the project's Docs already held (`holdPictures`),
     and only the first is a response to wait for. What matters is the
     last line: the room opens with no glance. */
  await openProject(page, fresh)
  await page.getByTestId('tool-tasks').click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  /* This message's glance, not any: the room holds the pictures earlier
     runs sent, and one of those still arriving said nothing about this. */
  await page.evaluate((words) => {
    const w = window as unknown as { glanced: boolean }
    w.glanced = false
    new MutationObserver(() => {
      for (const m of document.querySelectorAll('[data-history] [data-message]')) {
        if (m.textContent?.includes(words) && m.querySelector('[data-glance]')) w.glanced = true
      }
    }).observe(document.body, { subtree: true, childList: true })
  }, said)
  await page.getByTestId('tool-messages').click()
  const message = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await expect(message.locator('img[data-attachment]')).toHaveJSProperty('complete', true, { timeout: 5000 })
  expect(await page.evaluate(() => (window as unknown as { glanced: boolean }).glanced)).toBe(false)
})

/* Several pictures stand in one row. */
test('several pictures in a message stand in one row, and the lightbox pages through them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openChat(page)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
    'base64',
  )
  const stamp = Date.now()
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles([0, 1, 2, 3, 4, 5].map((i) => ({ name: `row-${stamp}-${i}.png`, mimeType: 'image/png', buffer: png })))
  await expect(page.locator('[data-attached] [data-holding]')).toHaveCount(6, { timeout: 20_000 })
  const field = page.getByLabel('Message')
  await field.fill(`Six ${stamp}`)
  await field.press('Enter')

  const message = page.locator('[data-history] [data-message]').filter({ hasText: `Six ${stamp}` })
  const gallery = message.locator('[data-gallery]')
  await expect(gallery).toContainText('6 attachments')
  const tiles = gallery.locator('[data-gallery-tile]')
  const shown = await tiles.count()
  // One row, as many as fit, and what does not fit said on the last.
  expect(shown).toBeLessThan(6)
  await expect(gallery.locator('[data-gallery-more]')).toHaveText(`+${6 - shown}`)
  const tops = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)

  // Opened, it pages through all six — past the ones the row could not show.
  await tiles.first().click()
  await expect(page.locator('[data-lightbox-counter]')).toHaveText('1 / 6')
  for (let i = 2; i <= 6; i++) {
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[data-lightbox-counter]')).toHaveText(`${i} / 6`)
  }
  await expect(page.getByTestId('lightbox-next')).toHaveCount(0)
  await page.getByTestId('lightbox-prev').click()
  await expect(page.locator('[data-lightbox-counter]')).toHaveText('5 / 6')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-lightbox]')).toHaveCount(0)
})

/* A task named with #, carried as its card. */
test('a task is named in a message with #, and its card opens it', async ({ page }) => {
  await login(page)
  await openProject(page, 'Website')
  await page.getByTestId('tool-tasks').click()
  const title = `Hero image ${Date.now()}`
  await make(page, page.getByTestId('create-new-task'), title)
  await close(page)
  await page.getByTestId('tool-messages').click()
  const field = page.locator('[data-chat-composer] [data-message-field]').first()
  await field.click()
  // @ pressed three times is one @, not three.
  for (let i = 0; i < 3; i++) await page.getByLabel('Mention someone').click()
  await expect(field).toHaveText('@')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('Look at ')
  // The button opens the same list # does.
  await page.getByLabel('Mention a task').click()
  await page.keyboard.type(title.slice(0, 10))
  await expect(page.locator('[data-task-row]').filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-task-row]').filter({ hasText: title }).click()
  await page.keyboard.type('please')
  await page.keyboard.press('Enter')

  const message = page.locator('[data-history] [data-message]').filter({ hasText: 'please' }).last()
  await expect(message.locator('[data-taskref]')).toContainText(title)
  const card = message.locator(`[data-task-card]`).filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 10_000 })

  // And its name in the words opens it too — not My tasks.
  await page.goBack()
  await message.locator('[data-taskref]').click()
  await expect(page.getByTestId('task-title')).toHaveValue(title, { timeout: 10_000 })
})

/* Files sent together stand close together. */
test('files sent together stand as one close list, and pictures have an edge', async ({ page }) => {
  await openChat(page)
  const stamp = Date.now()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMEAO5hCMmbv4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AL/zAcRgtCDyAAAAAElFTkSuQmCC',
    'base64',
  )
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles([
      { name: `a-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from('first') },
      { name: `b-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from('second') },
      { name: `c-${stamp}.png`, mimeType: 'image/png', buffer: png },
    ])
  await expect(page.locator('[data-attached] [data-holding]')).toHaveCount(3, { timeout: 20_000 })
  await page.getByLabel('Message').fill(`Bundle ${stamp}`)
  await page.getByLabel('Message').press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: `Bundle ${stamp}` })
  const files = message.locator('[data-files]')
  await expect(files.getByTestId('save-file')).toHaveCount(2, { timeout: 15_000 })
  const tops = await files.locator('> *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))
  // Four pixels between them, not the sixteen two separate blocks had.
  expect(Math.round(tops[1]!.top - tops[0]!.bottom)).toBe(4)
  await expect(message.locator('[data-edge]')).toHaveCount(1)
})

test('a new line started with Shift+Enter takes the hint away', async ({ page }) => {
  await openChat(page)
  const field = page.getByLabel('Message')
  await field.click()
  await expect(page.locator('[data-placeholder]').first()).toBeVisible()
  await page.keyboard.press('Shift+Enter')
  await expect(page.locator('[data-placeholder]')).toHaveCount(0)
  await page.keyboard.press('Backspace')
  await expect(page.locator('[data-placeholder]').first()).toBeVisible()
})

test('bold pressed in an empty field says it is on before anything is typed', async ({ page }) => {
  await openChat(page)
  await page.getByLabel('Message').click()
  await page.getByRole('button', { name: 'Show formatting' }).click()
  const bold = page.getByRole('button', { name: 'Bold' })
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
})

/* A room that belongs to no project takes files too. */
test('a direct conversation takes a file, and sends it', async ({ page }) => {
  await login(page)
  await page.getByTestId('start-dm').click()
  await page.getByTestId('new-chat-direct').click()
  await page.locator('[data-direct-to]').first().click()
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 15_000 })
  const stamp = Date.now()
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles({
      name: `dm-${stamp}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })
  const field = page.getByLabel('Message')
  await field.fill(`With a file ${stamp}`)
  await field.press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: `With a file ${stamp}` })
  await expect(message.locator('[data-attachment]')).toHaveCount(1, { timeout: 20_000 })
  await expect(message).toContainText(`dm-${stamp}.txt`)
})

/* `docs/specs/docs.md`: # names a document as it names a task. */
test('a document is named in a room with #, and opens from the message', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-files').click()
  const doc = `Brief ${Date.now()}`
  await add(page, 'new-document', doc)
  await page.getByTestId('tool-messages').click()
  const field = page.getByLabel('Message')
  await field.click()
  /* Its own button, beside the task's: the list it opens is docs alone. */
  await page.getByLabel('Mention a doc').click()
  await page.keyboard.type(doc)
  await expect(page.locator('[data-task-list]')).toContainText(`Docs matching “${doc}”`)
  await page.locator('[data-task-row]').filter({ hasText: doc }).first().click()
  await field.press('Enter')
  const said = page.locator('[data-history] [data-docref]').filter({ hasText: doc }).last()
  await expect(said).toBeVisible({ timeout: 15_000 })
  await said.click()
  await expect(page.getByTestId('file-name')).toHaveValue(doc, { timeout: 15_000 })
})

test('a task comment names a document with #', async ({ page }) => {
  await login(page)
  await openProject(page, 'Acme rebrand')
  await page.getByTestId('tool-files').click()
  const doc = `Spec ${Date.now()}`
  await add(page, 'new-document', doc)
  await page.getByTestId('tool-tasks').click()
  const title = `Read the spec ${Date.now()}`
  await add(page, 'new-task', title)
  await page.locator('[data-open-task]').filter({ hasText: title }).click()
  const line = page.getByTestId('new-comment')
  await line.click()
  await page.keyboard.type(`See #${doc.slice(0, 8)}`)
  await page.locator('[data-name-row]').filter({ hasText: doc }).first().click()
  await line.press('Enter')
  await expect(page.locator('[data-comment] [data-docref]').filter({ hasText: doc })).toBeVisible({ timeout: 15_000 })
})

/* `docs/specs/docs.md`: a file sent in a room says so in Docs, and leads back. */
test('a file sent in a room says in Docs where it was sent, and opens that room', async ({ page }) => {
  await openChat(page)
  const name = `sent-${Date.now()}.txt`
  await page
    .locator('[data-chat-composer] [data-attach-input]')
    .first()
    .setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('from the room'),
    })
  const field = page.getByLabel('Message')
  await field.fill(`Here it is ${Date.now()}`)
  await field.press('Enter')
  await expect(page.locator('[data-history] [data-attachment]').filter({ hasText: name })).toHaveCount(1, { timeout: 20_000 })
  await page.getByTestId('tool-files').click()
  /* A text file is an upload: under Uploads, not Docs, where Files opens. */
  await page.locator('[data-docs-kind="uploads"]').click()
  const row = page.locator('[data-file]').filter({ hasText: name })
  await expect(row.locator('[data-file-origin="message"]')).toContainText('#acme-rebrand-', { timeout: 15_000 })
  await row.locator('[data-file-origin]').click()
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 15_000 })
})

/* `docs/specs/chat-threads.md`: Escape shuts a thread, as its × does — but
   not over words being written in it. */
test('Escape shuts a thread, and leaves one being written in', async ({ page }) => {
  await openChat(page)
  const root = `Esc ${Date.now()}`
  await page.getByLabel('Message').fill(root)
  await page.getByLabel('Message').press('Enter')
  const rootMessage = page.locator('[data-history] [data-message]').filter({ hasText: root })
  await expect(rootMessage).toBeVisible({ timeout: 15_000 })

  await rootMessage.hover()
  await rootMessage.getByRole('button', { name: 'Reply in thread' }).click()
  const pane = page.locator('[data-thread]')
  await expect(pane).toBeVisible()
  /* Words in its line: Escape is the line's, and the thread stays. */
  const line = pane.getByLabel('Message')
  await line.click()
  await page.keyboard.type('half a thought')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await expect(pane).toBeVisible()
  /* Emptied, Escape is the way out. */
  await line.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0, { timeout: 5_000 })
})

/*
 * A phone has no pointer to hover with, so the card of actions
 * beside a message never stood up there. A held finger opens them as a
 * sheet — the quick reactions, the reply, the text, the link, a task, and
 * what this person may change — and a finger that scrolls does not.
 */
test.describe('a phone holds a message for its actions', () => {
  test.use({ hasTouch: true })

  test('a long press opens the sheet; a scroll from a message does not', async ({ page }) => {
    test.setTimeout(90_000)
    await openChat(page)
    const said = `Hold me ${Date.now()}`
    await page.getByLabel('Message').fill(said)
    await page.getByLabel('Message').press('Enter')
    const message = page.locator('[data-history] [data-message]').filter({ hasText: said })
    await expect(message).toBeVisible({ timeout: 15_000 })
    await page.setViewportSize({ width: 390, height: 844 })

    const cdp = await page.context().newCDPSession(page)
    const point = async (m: Locator) => {
      const words = m.locator('[data-message-body]')
      await words.scrollIntoViewIfNeeded()
      const b = (await words.boundingBox())!
      return { x: Math.round(b.x + Math.min(40, b.width / 2)), y: Math.round(b.y + b.height / 2) }
    }
    const hold = async (m: Locator, ms = 600) => {
      const at = await point(m)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
      await page.waitForTimeout(ms)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(250)
    }
    const sheet = page.locator('[data-message-sheet]')

    // A scroll that starts on a message, then rests: the scroll, not the sheet.
    const at = await point(message)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x, y: at.y + i * 12 }] })
      await page.waitForTimeout(16)
    }
    await page.waitForTimeout(700)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(sheet).toHaveCount(0)
    // And a fling across it.
    await cdp.send('Input.synthesizeScrollGesture', { x: at.x, y: at.y, yDistance: 200, gestureSourceType: 'touch', speed: 1200 })
    await page.waitForTimeout(600)
    await expect(sheet).toHaveCount(0)

    // Held, it opens whole, with what this person may do to their own message.
    const heights = await drawnWhole(page, '[data-message-sheet]', () => hold(message))
    expect(heights.length).toBe(1)
    await expect(message).toHaveAttribute('data-held', 'true')
    for (const id of [
      'sheet-reply',
      'copy-message-text',
      'select-message-text',
      'copy-message-link',
      'make-task-from-message',
      'edit-message',
      'delete-message',
    ]) {
      await expect(sheet.getByTestId(id)).toBeVisible()
    }
    // The finger lifting pressed nothing in it, and did not close it.
    await expect(sheet).toBeVisible()

    // A quick reaction, one press.
    await sheet.locator('[data-quick-reaction="👍"]').tap()
    await expect(sheet).toHaveCount(0)
    await expect(message.locator('[data-reaction="👍"]')).toHaveText(/1/)
    await expect(message).not.toHaveAttribute('data-held', 'true')

    // A task from it.
    await hold(message)
    await sheet.getByTestId('make-task-from-message').tap()
    await expect(message.locator('[data-made-task] [data-task-card]')).toContainText(said, { timeout: 15_000 })

    // Its thread; a reply held there has the same sheet, without a way into
    // the thread it is already in.
    await hold(message)
    await sheet.getByTestId('sheet-reply').tap()
    const pane = page.locator('[data-thread]')
    await expect(pane.locator('[data-message]').first()).toContainText(said)
    const reply = `Answer ${Date.now()}`
    await pane.getByLabel('Message').fill(reply)
    await pane.getByLabel('Message').press('Enter')
    const answer = pane.locator('[data-message]').filter({ hasText: reply })
    await expect(answer).toBeVisible({ timeout: 15_000 })
    await hold(answer)
    await expect(sheet.getByTestId('copy-message-link')).toBeVisible()
    await expect(sheet.getByTestId('edit-message')).toBeVisible()
    await expect(sheet.getByTestId('sheet-reply')).toHaveCount(0)
  })
})

/* `docs/specs/emoji.md`: every emoji, not forty-eight of them. */
test('any emoji is found by a word, given as a reaction and written in a message', async ({ page }) => {
  await openChat(page)
  const said = `Every emoji ${Date.now()}`
  await page.getByLabel('Message').fill(said)
  await page.getByLabel('Message').press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await expect(message).toBeVisible({ timeout: 15_000 })

  // The picker opens at its own size, and stays that size as the list arrives.
  await message.hover()
  const heights = await drawnWhole(page, '[data-emoji-picker]', () => message.getByTestId('add-reaction').click())
  expect(heights).toHaveLength(1)
  const picker = page.locator('[data-emoji-picker]')
  await expect(picker.getByTestId('emoji-search')).toBeFocused()
  // Sections a press away.
  await picker.locator('[data-emoji-tab="flags"]').click()
  await expect(picker.locator('[data-emoji-section="flags"]')).toBeVisible()
  // A giraffe was never in the short set; a word finds it and Enter gives it.
  await picker.getByTestId('emoji-search').fill('giraffe')
  await expect(picker.locator('[data-emoji="🦒"]')).toBeVisible()
  await expect(picker.locator('[data-emoji-name]')).toContainText('giraffe')
  await picker.getByTestId('emoji-search').press('Enter')
  await expect(message.locator('[data-reaction="🦒"]')).toHaveText(/1/)
  await settleThenReload(page, '/reactions/')
  await expect(page.locator('[data-history] [data-message]').filter({ hasText: said }).locator('[data-reaction="🦒"]')).toHaveText(/1/, {
    timeout: 15_000,
  })

  // In the line: from the picker, in the tone chosen there, and by : and a name.
  const field = page.getByLabel('Message')
  await page.getByTestId('chat-emoji').click()
  const again = page.locator('[data-emoji-picker]')
  // The last one used is first.
  await expect(again.locator('[data-emoji]').first()).toHaveAttribute('data-emoji', '🦒')
  await again.getByTestId('emoji-tone').click()
  await again.locator('[data-tone="3"]').click()
  await again.getByTestId('emoji-search').fill('waving hand')
  await again.locator('[data-emoji="👋🏽"]').click()
  await expect(page.locator('[data-emoji-picker]')).toHaveCount(0)
  await expect(field).toBeFocused()
  await page.keyboard.type(' and :octop')
  await expect(page.locator('[data-emoji-list] [data-emoji-row="🐙"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-emoji-list]')).toHaveCount(0)
  const stamp = `${Date.now()}`
  await page.keyboard.type(` ${stamp}`)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-history] [data-message]').filter({ hasText: `👋🏽 and 🐙 ${stamp}` })).toBeVisible({ timeout: 15_000 })
})

/* A file picked and not sent reads as a draft. */
test('a picked file waits inside the line as a tile, and goes with the message', async ({ page }) => {
  await openChat(page)
  // Slowed, so the tile is seen going up and then done.
  await page.route(/\/api\/(projects|conversations)\/[^/]+\/uploads$/, async (route) => {
    await new Promise((r) => setTimeout(r, 700))
    await route.continue()
  })
  const composer = page.locator('[data-chat-composer]')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR42u3OMQEAAAgDoC251a3gLzRgcrcpAQEBAQEBAQEBAQGBHwtGFgABRpW1ugAAAABJRU5ErkJggg==',
    'base64',
  )
  const stamp = Date.now()
  const before = (await composer.boundingBox())!
  // Whole from its first frame: the same height going up and when done.
  const heights = await drawnWhole(
    page,
    '[data-chat-composer] [data-attached]',
    () => composer.locator('[data-attach-input]').setInputFiles({ name: `draft-${stamp}.png`, mimeType: 'image/png', buffer: png }),
    1600,
  )
  expect(heights).toEqual([64])
  const tile = composer.locator('[data-attached] [data-holding]')
  await expect(tile).toHaveCount(1, { timeout: 20_000 })
  // In the box being written in, above the words — not in the history, and
  // nothing of a message about it.
  await expect(page.locator('[data-history] [data-holding]')).toHaveCount(0)
  await expect(composer.locator('[data-attached] [data-avatar], [data-attached] time')).toHaveCount(0)
  const t = (await tile.boundingBox())!
  const words = (await composer.locator('[data-message-field]').boundingBox())!
  expect(t.height).toBe(64)
  expect(t.width).toBe(64)
  expect(t.y + t.height).toBeLessThanOrEqual(words.y)
  // The composer grew by the row of tiles and kept its foot where it was.
  const after = (await composer.boundingBox())!
  expect(Math.round(after.y + after.height)).toBe(Math.round(before.y + before.height))

  // A file is a tile of its own, with its name and size, and its ✕ takes it out.
  await composer
    .locator('[data-attach-input]')
    .setInputFiles({ name: `notes-${stamp}.txt`, mimeType: 'text/plain', buffer: Buffer.from('hello there') })
  const file = composer.locator('[data-attached] [data-tile][data-kind="file"]')
  await expect(file).toContainText(`notes-${stamp}.txt`)
  await expect(file.locator('[role="progressbar"]')).toHaveCount(1)
  await expect(composer.locator('[data-attached] [data-holding]')).toHaveCount(2, { timeout: 20_000 })
  await expect(file).toContainText('11 B')
  await file.locator('[data-remove-attached]').click()
  await expect(composer.locator('[data-attached] [data-holding]')).toHaveCount(1)

  // Sent, it moves into the message and the line is empty again.
  const field = page.getByLabel('Message')
  await field.fill(`With a draft ${stamp}`)
  await field.press('Enter')
  const message = page.locator('[data-history] [data-message]').filter({ hasText: `With a draft ${stamp}` })
  await expect(message.locator('[data-attachment]')).toHaveCount(1, { timeout: 20_000 })
  await expect(composer.locator('[data-attached]')).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('an address in a message sent as words is a link', async ({ page }) => {
  /* A message sent through the API, an import or an agent with an
     address in its words reads with that address as a link — and the
     same address in code stays code. `docs/specs/rich-text.md`. */
  await openChat(page)
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('session')!).access_token as string)
  const h = { authorization: `Bearer ${token}`, 'x-api-version': '1' }
  const room = await page.evaluate(async (hh) => {
    const all = (await (await fetch('/api/conversations', { headers: hh })).json()) as {
      conversations: { id: string; project_id: string | null; name: string | null }[]
    }
    const projects = (await (await fetch('/api/projects', { headers: hh })).json()) as { projects: { id: string; name: string }[] }
    const acme = projects.projects.find((p) => p.name === 'Acme rebrand')!
    const me = (await (await fetch('/api/me', { headers: hh })).json()) as { workspace: { slug: string } }
    return { id: all.conversations.find((c) => c.project_id === acme.id)!.id, ws: me.workspace.slug }
  }, h)
  const url = 'https://example.com/chat/tuf-149'
  const said = `Notes ${Date.now()}`
  await page.request.post(`/api/conversations/${room.id}/messages`, {
    headers: { ...h, 'content-type': 'application/json' },
    data: {
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: `${said} (${url}). Not ` },
              { type: 'text', text: 'https://example.com/code', marks: [{ type: 'code' }] },
              { type: 'text', text: ' nor javascript:alert(1)' },
            ],
          },
        ],
      },
    },
  })
  await page.goto(`/${room.ws}/chat/${room.id}`)
  const message = page.locator('[data-history] [data-message]').filter({ hasText: said })
  await expect(message).toBeVisible({ timeout: 15_000 })
  const link = message.locator(`a[href="${url}"]`)
  await expect(link).toHaveText(url)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(message.locator('a[href="https://example.com/code"], a[href^="javascript"]')).toHaveCount(0)
})
