# The palette

⌘K, the search field in the bar, and a phone's Search tab are one thing:
the way to anywhere by name. The project's handbook says why there is only one.

## What it holds

Opened with nothing typed, it begins with what this person did last time:

- **Recent** — the last three questions asked here that led somewhere,
  and the last five places opened from it, each with what sort of thing it
  is (Project, Task, Doc, Chat, Person, Screen). Pressing a question asks it
  again rather than going anywhere. Kept with the rest of what this window
  remembers (`data/memory.ts`), per person and workspace, so another
  account on the same machine does not see them. A recent place in a
  project that has gone is not offered.
- **Projects**, each with its own mark.
- **Go to** — the screens the column and the bar reach, with their glyphs,
  and what is waiting behind one where something is: the notifications'
  count. Last among them, for whoever has `agent.connect`, **Connect an
  agent**: it opens People & Agents with the window that connects one
  over it, on its agents tab, so closing it leaves somebody where agents
  are kept. Typed, it is found by its own words and by what somebody
  looking for it types instead — `ai`, `claude`, `codex`, `cursor`, `mcp`,
  `bot`, `llm`. It is not kept among the recents: it is a window, not a
  place, and a right that can be taken away. Added when the place was
  renamed from Members, for the people
  who never found agents there.

Typed, the same groups narrow, and three more join them: **People** by
name or what they do, **Chat** — every room this person is in, by the name
the column gives it, so a conversation with somebody no longer in the
workspace is still found — and **Found**, what the server's search
returned, each with the glyph of its tool:

- **A task by its handle** first: `TRA-111` in full, `tra111`, `TRA-11` on
  the way to it, or the number alone. A handle is what people say, paste
  and type, and it is in no title. Every task found shows its handle before
  its title.
- Then **titles**, then **the words inside** — a description, an
  announcement, a document — with the piece of sentence around them where
  the project's name would be, so it is clear why it was found. The words
  are drawn out by the database and kept under a trigram index; against the
  load table, ten thousand descriptions answer in about 50 ms.
- Then **what was said in chat**, from three letters: the line with the
  words, who said it and in which room. Chosen, the room opens at it.

Last, **Make**: a task with the words typed, in the project being looked
at.

## How it looks and is worked

- A solid box over the dialogs' dim, the way New project is — not glass:
  rows of names with the page swimming through them were rows to read past.
  The field on top — a magnifier before it, ⌘K after —
  and the filters under it: the four kinds by their tools' names and
  glyphs, and the project — shown once something is typed, or while one
  of them is on. With nothing typed the palette is places and screens,
  which they do not narrow, and four buttons that did nothing were four
  things to read past. Their row opens at the first letter, growing into
  its height as they fade in over 150 ms, so the list moves down in one
  piece rather than jumping; it closes the same way. A line saying what
  typing would find held the place for a while, and was one more thing
  to read past.
  They were hidden once before and nobody found them; that time they
  appeared at the foot of the answers, and here they are under the words
  being typed.
- Rows forty tall, the chosen one lit as an inset rounded wash with ↵ at
  its end; the list keeps the chosen row in sight as the keys walk it.
- The pointer chooses a row only by moving onto it. Rows that arrive under
  a pointer at rest — as typing narrows the list — do not take the choice
  from the first result: the browser reports a move of nothing when the
  layout shifts, and Enter was opening whatever had landed under the
  cursor, a room called acme-… instead of the project called Acme.
- The keys said once at the foot: esc close, ↑ ↓ move, ↵ open.
- No entrance animation: it is opened by a keystroke dozens of times a day.

On a phone the same rows are the Search tab's page, in panels.
