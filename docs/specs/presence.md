# Who is here

Three states, one dot on the mark: **here**, **away**, **busy**. Everything
else a chat product shows about presence is one of these three with more
words on it.

## Why three and not five

Slack's green dot, hollow dot and do-not-disturb moon are the three answers
anybody acts on: can I expect a reply now, will this wait, and should I not
ring at all. "Offline" and "idle" are the same answer to the person looking —
nobody is coming back to you in the next minute — so they are one state, and
calling it *away* says the useful half.

A typed status with an emoji on it is a different feature: it is a sentence
somebody wrote, not a state the product knows, and it belongs with the rest
of a person's profile rather than on every avatar in the product. Not now.

## What is stored

Two columns on `actor`, because a person being here is a property of them and
not a fifth entity:

- `seen_at` — when they were last **active**, not when a socket opened. A
  laptop asleep with a tab open holds its websocket for hours; a connection
  is not a person.
- `presence` — what they chose, `away` or `busy`, or null for "work it out".

Derived on read, never stored: `busy` when chosen, `away` when chosen or
when `seen_at` is older than five minutes, `here` otherwise. One SQL function
answers it, `presence_of(seen_at, chosen)`, so no screen invents its own
threshold.

## How being here is known

The shell already holds one socket per signed-in person — `/ws/me`,
A frame on it says "still here", and the server stamps
`seen_at`. Sent when the socket opens, every minute while the tab is
**visible**, and the moment it becomes visible again.

Visible, not merely open: a backgrounded tab stops saying anything and its
person goes away in five minutes, which is the behaviour somebody expects
when they switch to another app. A locked screen with the tab in front is
the case this gets wrong — the browser calls that visible, and the product
has no way to know better.

No new endpoint and no polling: the socket is already open, and the stamp is
one write a minute per person looking at the product.

### Agents

An agent holds no tab, so the socket never hears from it, and every agent
read as away — grey beside "Claude Code" in a direct conversation while it
was answering in it. An agent's calls with its token are its being here:
each one stamps `seen_at` the way the socket's frame does, at most once a
minute (`agentHere` in `presence.ts`, from `authenticate`). Five minutes
after its last call it is away, as a person is five minutes after the tab
went to the back.

Only an agent's token. A person's own token is their tool at work — Claude
Code on their laptop at three in the morning — and is not them looking, so
it stamps nothing.

## Where it is drawn

On the mark, bottom right, as a dot with a ring of the surface behind it so
it reads on any ground. The person's own mark in the sidebar carries it too —
somebody who set themselves to do-not-disturb and cannot see that they did
will wonder why the room went quiet.

| State | Dot |
| --- | --- |
| here | filled, green |
| away | a ring in quiet ink, **filled with the ground** — hollow, not transparent |
| busy | filled, red, with a bar across it |

Hollow and transparent are not the same picture. Left transparent, the middle
of the away ring showed whatever was behind it — the avatar's own tint at the
corner — and read as a bite taken out of the mark rather than as a mark of
its own. Filled with the ground it is a ring sitting on the surface, which is
what hollow is supposed to say: a place where somebody is not.

Shown where a person is a person: the members screen, a direct conversation
in the sidebar, the account row at the foot of it. Not on every message in a
channel — four hundred dots down a column of chat is a column of dots.

## Choosing

Three rows in the menu behind the account row: Active, Away, Do not disturb.
Active is "work it out", not "say I am here": somebody who chooses it and
closes the laptop goes away like everybody else, which is the only honest
thing that answer can mean.

Do not disturb is a statement to other people here, and nothing more — it
does not hold back notifications. Quiet hours already do that, they are a
schedule rather than a mood, and two mechanisms for the same thing is how
somebody ends up missing a page because of a switch they flipped on Tuesday.

The dot stands out past the rim of the face by most of itself. Centred on
the curve, its inner half lay over the second initial; on the rim it says
here, away or busy without covering who.
