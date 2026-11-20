# Narrow screens

## What is wrong

The product is three columns: the sidebar, the project's tools, and the work.
On a laptop that is 248 + 212 + everything else. On a tablet it is 460 pixels
of navigation and 308 of work, and a task called "One page: who to ask about
what" reads as "One …". On a phone the work is not on the screen at all — both
columns fit and the third one starts past the right edge.

Nothing is broken. Everything is the wrong size, which is worse, because it
looks like it is working.

## The rule

One breakpoint, at 1024px, and one idea: **below it, navigation stops being a
column.**

The three columns are a luxury of width. When the width is not there, the
navigation has to cost nothing until it is asked for, and the work gets all
of it.

- **The sidebar becomes a drawer.** A button in a slim bar opens it over the
  work; choosing anything closes it. It is the same sidebar, the same order,
  the same rows — a second navigation model for small screens is how two
  products grow inside one.
- **The project's tools go back to being tabs.** A row of segments above the
  work, which is what they were before the column and what the design calls
  them. The column was worth 212px when there were 212px to spare.
- **Everything else is the same screen.** The board still scrolls sideways, a
  task still opens over the list, the palette is still the palette.

Two sizes and not five. Every breakpoint is a layout somebody has to keep
working, and the product has one shape that needs a second: three columns, or
one with the navigation folded away.

## What does not move

The address bar still decides what is open. A drawer is not a screen: it has
no URL, it does not survive a reload, and pressing back does not close it —
pressing back leaves the project, as it does on a laptop.

Resizing the sidebars is a wide-screen affair. Below the breakpoint the
drawer is one width and the handle is gone, because dragging a 320px drawer
inside a 390px window is an argument about nothing.

## The sizes to check

- **390** — a phone upright. The narrowest thing that has to work.
- **768** — a tablet upright, and the width that was worst before this.
- **1024** — the breakpoint itself, from both sides.

Measured the same way as everything else: no horizontal scroll on the page,
nothing clipped, and the work wider than the navigation at every size.
