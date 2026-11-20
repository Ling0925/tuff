# Every emoji

The composer and the reactions offered forty-eight emoji, the ones
a team sends about work, on the argument that people choose from the same
dozen and a picker of three thousand is a dependency and a search box. The
first half was true and the gap was the rest: somebody always wanted the
forty-ninth, and a reaction the server would take was one the web could not
give.

## What it is

One picker, the line's and a reaction's (`ui/EmojiPicker.tsx`):

- **A search** at the top, focused when it opens, matching the start of any
  word of an emoji's name or its CLDR keywords — "thu" finds 👍, "fusee"
  finds 🚀 in French, and the English name finds it in French too. The name
  first, then names holding every word, the shorter first; then keywords, in
  Unicode's order. ↑↓←→ move, Enter takes the lit one, Escape clears the
  words and then closes.
- **Recently used** first: what this person reacted with or wrote, newest
  first, on this machine (`data/frequent.ts`), topped up from a short set so
  a new machine does not open on nothing.
- **Unicode's sections behind tabs** — smileys and people, nature, food,
  activities, travel, objects, symbols, flags. The tab of the section in
  view is lit.
- **Skin tone**, one choice for every emoji that has the five, kept on this
  machine. Mixed tones (two people, two tones) are left to the keyboard.
- **The name of the one under the hand** at the foot, a fixed band, so
  nothing moves as the pointer crosses the grid.
- **`:` and two letters** in the line offers the eight that match where the
  caret is; ↑↓, Enter or Tab, Escape — as `@` and `#` do. "12:30" and
  "Note:" are not asked about.

## Where the list comes from

Unicode's own files, not a package: `emoji-test.txt` for the emoji and their
order, CLDR's annotations for names and keywords in English and French.
`web/scripts/emoji.mjs` makes `web/src/data/emoji/en.json` and `fr.json`
from them (Unicode-3.0 licence; its notice travels inside each file); run
it again when Unicode adds emoji. The script refuses to write an emoji the
server would refuse as a reaction (`server/src/http/chat.ts`), in any tone,
and `web/test/emoji.test.ts` holds the files to that.

The files are not in the bundle. Each is an asset fetched the first time a
line to write on is drawn and the machine is idle, then from the cache —
36 KB compressed in English, 52 KB in French (with the English names
beside). The main bundle carries the picker and the search, not the list.

## Opens whole, and fast

A fixed size from its first frame. Before the list has arrived the picker
shows the recent row, which needs no list, and the sections take their
place in a grid already the right size. Only the rows in view are drawn —
`@tanstack/react-virtual`, already a dependency — so two thousand buttons
are not made on every open.

## Emoji a machine cannot draw

Unicode adds emoji every year and an older system draws them as an empty
box or as the pieces of a sequence. The picker draws one emoji of each
version from 12.0 on a canvas when it loads the list, and offers nothing
newer than the last one drawn in colour at the width of one face. A canvas
that will not say is taken to draw 15.0.

## Not changed

The server already took any emoji of up to sixteen characters
(`docs/api.md`, Reactions), so the contract is as it was. The Apple and
Android apps send what their own system keyboard gives.
