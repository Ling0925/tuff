# A sound when something is said to you

Two soft notes, a fifth apart, a sixth of a second — drawn by the browser
with Web Audio, so there is no file to ship. `web/src/data/chime.ts`.

## When

- A **message** in a room left at "All new messages" — not one you said
  (the server does not tell you of your own), and not one in the room on
  the screen while the window is in front: you are already looking.
- A **mention** anywhere, as long as the room was not told to say nothing —
  in which case the server made no note, and there is nothing to hear.
- At most once a second, however many arrive together.

A room at "Mentions only" makes a sound only for a mention; one at
"Nothing" makes none.

## The switch

**Play a sound when a message arrives**, under Notifications in settings —
on by default, and kept on this device rather than on the account, like the
theme: a sound is about the room somebody is sitting in, and a laptop at the
office and a phone at home want different answers.

A browser makes no sound before the page has been touched, so the sound is
readied on the first press or key, and anything that arrives before that is
silent.

## Readied without costing the press

The audio context is **made while nothing is happening** — an idle moment
after the app has loaded — and a press only **starts** it. Making one opens
the audio device, and that is synchronous on the main thread: about 200 ms in
Chrome and 120–160 ms in Firefox (WebKit only pays for it when the context
starts, off the main thread). It used to be made inside the first press
anywhere, so somebody whose first act was lifting a card on the board had the
lift stand still for a fifth of a second. Starting one that is made
already is a `resume()` that returns at once.

Made before any press, the context starts suspended in every browser, which
is what Safari needs: WebKit starts audio only from inside a press, so the
press must have something to start. Chrome and Firefox remember a press for
the life of the page, so a context made after one starts by itself.

Every press asks — `pointerdown`, `pointerup`, `touchend`, `keydown` — not
only the first, and it costs a state check: on a phone it is the finger
lifting that counts as a press, not it landing, and iOS suspends audio again
behind a call or a locked screen. With the sound switched off nothing is
made; switching it on makes it in the next idle moment.

`e2e/stage4.spec.ts` holds it: the context is made before the first press,
is running after it, and no long task lands on it.
