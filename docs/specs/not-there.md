# Not there, and not answering

"Sometimes locally it opens like this — 'Nothing here is number 118' — though
the task exists."

## What it was

Every screen that opens one thing — a task, a document, an announcement,
and the address that turns `/tasks/118` into an id — treated any failed
request as "it is gone". A 404 and a server that was restarting looked the
same, and the second one was remembered: the lookup for 118 was cached as
nothing for the rest of the session, so going back to the task kept saying
it did not exist.

Locally the server restarts often — every `pnpm check` restarts it, and so
does a change to the server — so the window was wide. In production a
deploy, a 502 from the edge, or a database that took too long does the
same, more rarely.

## What it is

A refusal keeps its status (`Refused` in `data/api.ts`). **Only a refusal of the request — 404 and 403 above all, any 4xx but 429 —
mean gone** — the object is not there, or not yours to see, which the
server answers the same way on purpose. Anything else is asked again, after half a second and then
twice as long each time up to eight, until it answers; the screen shows what
it remembered meanwhile, or nothing, and never claims the thing was deleted.

A refetch of something already on the screen that fails keeps what is
there, unless the answer is that it has gone.
