# A window reads its own writes

A read this window sends while one of its writes is still in the air waits
for that write first — `afterWrites` in `web/src/data/api.ts`.

## What it was

A message made into a task, and the Tasks tab pressed straight after. The
tab's read reached the server before the task did, so the list came back
without it. The write publishes an event to the project, but the event
names the tab that made it and that tab ignores it as its own echo
(`Project.tsx`) — rightly, for a change the screen has already drawn, and
wrongly here, where the screen that drew it was a different one. Nothing
read the list again, and the task was missing until a reload.

Being put on a task and opening My tasks at once was the same race. Both
were lost more often the busier the server was, which is why
`stage3 › a message arrives and can become a task` failed in nearly every
full check on a loaded machine and almost never alone.

## What it is

- A write (anything but GET and HEAD) is kept in a set until it answers.
- A read waits until every write sent before it has answered, then goes.
- Never longer than three seconds: a write that hangs must not hold every
  screen with it, so past that the read goes as it always did.

The screen is not held up. It is drawn from memory as before
(`data/memory.ts`), the write is optimistic as before, and the read's
answer replaces what is drawn in place when it comes — a moment later than
it would have, and right.

## What it is not

Not a queue: writes still go out the moment they are made, in parallel,
and nothing is sent later or retried. Offline writes still fail as they did
(`offline.md`).
