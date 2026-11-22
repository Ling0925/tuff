import { SAYS, MAKE } from '../../data/words.js'
import { TASKS as W } from '../../words/tasks.js'
import { NewButton } from '../New.jsx'
import { Dot, Fluid } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { SORT_SAID } from './model.jsx'
import { ViewPanel } from './view.jsx'
import { BoardCard, ColumnFade, BoardBar } from './board.jsx'
import { ListBar } from './listBar.jsx'
import { ListTaker } from './listTaker.jsx'
import { Unread } from './unread.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type BoardMoves } from './useBoardMoves.js'
import { type BoardLayout } from './useBoardLayout.js'
import { type ListShape } from './useListShape.js'
import { type CardRenderer } from './cardRenderer.jsx'
import { type TaskKeys } from './useTaskKeys.js'
import { type ColumnPanes } from './useColumnPanes.js'

/**
 * The tasks as a board.
 */
export function boardView({
  canMake,
  group,
  sort,
  dir,
  who,
  list,
  onNavigate,
  meId,
  labels,
  view,
  wide,
  panel,
  shows,
  setShows,
  isShut,
  narrow,
  people,
  lists,
  load,
  more,
  unread,
  taskWhat,
  byColumn,
  taken,
  drag,
  board,
  layer,
  handlers,
  arranged,
  held,
  stack,
  allLabels,
  card,
  cardFns,
  look,
  partsSaid,
  columnPane,
}: Pick<TasksProps, 'canMake' | 'group' | 'sort' | 'dir' | 'who' | 'list' | 'onNavigate' | 'meId'> &
  Required<Pick<TasksProps, 'labels'>> &
  Pick<
    TaskData,
    | 'view'
    | 'wide'
    | 'panel'
    | 'shows'
    | 'setShows'
    | 'isShut'
    | 'narrow'
    | 'people'
    | 'lists'
    | 'load'
    | 'more'
    | 'unread'
    | 'taskWhat'
    | 'byColumn'
  > &
  Pick<BoardMoves, 'taken' | 'drag' | 'board' | 'layer' | 'handlers'> &
  Pick<BoardLayout, 'arranged' | 'held' | 'stack'> &
  Pick<ListShape, 'allLabels'> &
  Pick<CardRenderer, 'card'> &
  Pick<TaskKeys, 'cardFns' | 'look' | 'partsSaid'> &
  Pick<ColumnPanes, 'columnPane'>): React.ReactNode {
  return (
    view === 'board' && (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {/*
          The board gets the panel too, now that it is only there while
          somebody is using it.
          
          It could not have one standing open: four columns need 760 pixels
          at their narrowest, and 280 beside them pushed the last column off
          the screen at 1400. Taking the width by choice is a different
          bargain from taking it always.
        */}
        {/*
         * The board reaches the bottom of the pane it is in.
         *
         * Every tool shares one body and that body pays twenty-four at its
         * foot, which is right for a sheet of rows or a document — they end
         * and want air under them. A board does not end: its columns are
         * the floor, and twenty-four of page below them plus the sixteen
         * the scrollbar takes read as columns that stopped short of their
         * own container.
         *
         * Taken back here rather than removed there, because the list on
         * the same screen still wants it. The scrollbar keeps its sixteen:
         * it is a control, not a margin.
         */}
        {/* On a phone the columns scroll out to the sheet's edges, padded
            back in: inside the gutter they were cut off a gutter short of
            the edge, a strip of sheet with half a column clipped in it. */}
        <div className="-mb-6 flex min-h-0 flex-1 max-lg:-mx-[var(--gutter)]">
          <div className="flex min-h-0 min-w-px flex-1 flex-col">
            <div
              ref={board}
              data-board
              {...handlers}
              className="flex min-h-0 min-w-px flex-1 gap-3 overflow-x-auto max-lg:scroll-px-[var(--gutter)] max-lg:px-[var(--gutter)]"
              /*
               * No `touch-action` at all, which is the whole of it.
               *
               * It is a permission rather than a direction, and it is
               * inherited: `pan-x` here read as "this scrolls sideways" and
               * meant "a finger starting anywhere below may pan sideways
               * only", which left the column's own scroller unable to see a
               * finger. Naming both axes instead allowed what the browser
               * already allows, so it was a narrowing that narrowed nothing
               * — worth having only if something underneath needed
               * widening, and nothing does.
               *
               * The long press is what tells a drag from a pan now, and it
               * decides before anything is captured.
               */
            >
              {lists.map((l) => (
                <div
                  key={l.id}
                  data-list={l.id}
                  data-column={l.name}
                  /* Equal shares of the width rather than a fixed 260: four
                 columns that end before the window does read as a board that
                 did not finish loading. */
                  /*
                   * 240 is where a card stops being one, and the column carries
                   * its own padding on top of that.
                   *
                   * The minimum belongs to the card, because the card is what has
                   * to hold a title, a date and a face: a column measured at 240
                   * leaves 224 inside it once `p-2` is paid on both sides, and
                   * the fit was decided by what is in the card.
                   *
                   * It was 180 on the column, chosen so four would fit at 1280
                   * beside the tools — and then a project started with five
                   * lists, the answers panel took another 280, and five columns
                   * divided what was left into strips: a two-word title on three
                   * lines, a date and a face with nowhere to sit beside each
                   * other.
                   *
                   * Squeezing was the wrong half of that bargain. Past this the
                   * board scrolls sideways, which it is built to do, and every
                   * column on the screen is one somebody can read.
                   *
                   * And a ceiling, for the same reason read the other way.
                   * `flex-1` shares what is left, so narrowing three of four
                   * columns gave the last one the whole window: a card became a
                   * single line of title running two thousand pixels, with the
                   * id and the date adrift at the end of it. A card stops being
                   * a card well before that: 320 is the widest it is drawn, so
                   * a column is 336 with its eight each side — it was 420, and a
                   * wide window still laid cards out as short lines of title.
                   * The columns gather at the left and the board keeps the
                   * rest, which is what a board with two lists open should look
                   * like.
                   */
                  data-shut={isShut(l.id) ? '' : undefined}
                  /*
                   * A narrow column says a card is coming to it.
                   *
                   * The wide one answers with the hole itself — the gap is the
                   * shape of what will land. A narrow one has no room for a
                   * hole and no cards to part, so without this it took the drop
                   * silently: the card went in and the only sign was a count
                   * changing after the fact.
                   */
                  data-over={isShut(l.id) && drag?.spot?.column === l.id ? '' : undefined}
                  data-shut-col={isShut(l.id) ? '' : undefined}
                  /* Narrowed to its name and its count, or taking its share.
                 `min-w` and `flex-1` are what make a column a column, so a
                 narrow one has to give up both — otherwise it still claims
                 a seventh of the board while showing nothing. */
                  className={
                    isShut(l.id)
                      ? 'relative flex w-11 shrink-0 flex-col gap-2 p-2'
                      : 'relative flex min-w-[256px] max-w-[336px] flex-1 flex-col gap-2 p-2'
                  }
                  /* Still the sunken well. Lifting it was asked for and measured
                 against the cards that now sit on it: the list's ground is
                 #191919 where a card used to be #242424, so every lighter
                 column left the two within 1.07 of each other — a card with
                 no edge of its own. The darker ground is what the cards have
                 left to separate against. */
                  style={{
                    background:
                      drag?.spot?.column === l.id && (isShut(l.id) || sort !== 'manual')
                        ? 'color-mix(in oklch, var(--accent) 18%, var(--lane))'
                        : 'var(--lane)',
                    borderRadius: 'var(--r-panel)',
                    /* The accent rather than a lighter grey: this is the one
                   moment a column is answering rather than holding, and the
                   same colour the product uses everywhere else for "this
                   one". */
                    boxShadow:
                      drag?.spot?.column === l.id && (isShut(l.id) || sort !== 'manual') ? 'inset 0 0 0 1px var(--accent)' : undefined,
                    transition: 'background 120ms var(--ease-out), box-shadow 120ms var(--ease-out)',
                  }}
                >
                  {/*
                An ordered column takes the card anywhere in it.
                
                With a sort on there is no gap to aim at — the position is
                the sort's answer — so the board stops drawing a hole and
                lights the whole column instead, with the order's name on
                it. Aiming at a place that will not be honoured is the lie
                the ordering was refused over; saying so is what makes it
                honest.
              */}
                  {!isShut(l.id) && sort !== 'manual' && drag?.spot?.column === l.id && (
                    <div
                      data-drop-anywhere
                      aria-hidden
                      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                      style={{
                        /* Over the whole column, not a chip on it. The cards
                       under it are what somebody is looking past, so the
                       thing that says "anywhere in here" has to cover
                       them — a pill among forty cards is one more card. */
                        background: 'var(--veil)',
                        borderRadius: 'var(--r-panel)',
                        /* Over the header and the hole as well: everything in
                       the column is behind the answer, including the dent
                       the card left, which under an order is a place it
                       will not return to. */
                        backdropFilter: 'blur(2px)',
                        WebkitBackdropFilter: 'blur(2px)',
                      }}
                    >
                      <span className="px-4 text-center text-base font-medium text-ink">
                        {SAYS.sortedBy} {SORT_SAID[sort] ?? sort}
                      </span>
                    </div>
                  )}
                  {isShut(l.id) ? (
                    /*
                     * Narrowed: the mark, the name on its side, the count.
                     *
                     * The name is turned rather than truncated, because a
                     * column of "In re…" answers nothing — and the whole point
                     * of narrowing one is to keep knowing what it is while
                     * giving its width to the columns being read.
                     *
                     * The whole strip is the way back, for the reason the band
                     * strip in the list is: an arrow small enough to be an
                     * arrow is too small to be a target.
                     */
                    <button
                      data-widen={l.id}
                      data-no-drag
                      aria-label={W.expand(l.name)}
                      onClick={() => narrow(l.id, false)}
                      className="flex min-h-0 flex-1 flex-col items-center gap-3 pt-2 pb-2"
                      style={{ justifyContent: 'flex-start' }}
                    >
                      <Dot icon={l.icon} color={l.color} />
                      {/*
                    The name, then how many — the order the wide column
                    reads in, turned a quarter.
                    
                    `shrink` rather than `flex-1`: the name is as long as it
                    is, so the count sits under its last letter rather than
                    at the foot of a column that is mostly empty. On a board
                    too short for a long name it gives way and truncates,
                    which is why it may shrink but never grow.
                  */}
                      <span
                        className="min-h-0 shrink truncate text-base font-medium text-ink-2"
                        style={{
                          writingMode: 'vertical-rl',
                          letterSpacing: 'var(--track-body)',
                        }}
                      >
                        {l.name}
                      </span>
                      <span className="shrink-0 text-base font-medium tabular-nums text-ink-3">
                        {(byColumn.get(l.id)?.length ?? 0) + unread(l.id)}
                      </span>
                      {/* The way back, said as well as implied. The whole strip
                      is the target, so this is the sign rather than the
                      control — which is why it is not a button of its own. */}
                      <span className="shrink-0 text-ink-3">
                        <Icon name="grow" size={16} />
                      </span>
                    </button>
                  ) : (
                    <>
                      <div className="flex shrink-0 items-center gap-2 pt-1 pr-1 pb-2 pl-2">
                        {/* The list's own mark, the same one the ring on every card
                    and the status picker draw. A column is a list, and it was
                    the one place a list was named without being shown. */}
                        {/* Two down, onto the letters.
                    
                    The line-height holds the text's box to the glyph's, but
                    a cap sits a little above the middle of its own line —
                    measured, the ink's centre is 137.8 against the glyph's
                    136. Two pixels is the difference between a mark beside
                    a word and a mark floating over it. */}
                        <span className="flex shrink-0 translate-y-[1px] items-center" data-list-mark>
                          <Dot icon={l.icon} color={l.color} />
                        </span>
                        {/*
                  A line tall enough for the letters, and the mark moved to
                  meet them.
                  
                  At its default the 20px text is a 29px box whose letters
                  sit high in it, so the glyph beside them — centred on the
                  box, as flex does — rode about eight pixels above the
                  letterforms: every middle measured equal and the row still
                  read as crooked, because a box's middle is not where the
                  ink is.
                  
                  Holding the line to 20 cut the tail off a `g`: `truncate`
                  is `overflow: hidden`, and a line exactly as tall as its
                  text leaves a descender outside the box. Clipping one axis
                  is not an option either — `overflow-x: hidden` with a
                  visible `y` is not a thing CSS does, and the browser makes
                  both `auto`.
                  
                  So the line is 28: four pixels of half-leading under the
                  baseline, which is what a 20px descender wants. The glyph
                  pays the three between its own middle and the ink's.
                */}
                        <span
                          className="min-w-0 truncate text-lg leading-7 font-medium text-ink"
                          style={{ letterSpacing: 'var(--track-title)' }}
                        >
                          {l.name}
                        </span>
                        {/* And the count with it: digits have no descender, so at
                    the same baseline as the name they read a shade high
                    beside it. */}
                        <span
                          data-count
                          className="text-lg leading-7 font-medium tabular-nums text-ink-3"
                          style={{ letterSpacing: 'var(--track-title)' }}
                        >
                          {/* The cards drawn and the ones the list has not
                              read yet. */}
                          {(byColumn.get(l.id)?.length ?? 0) + unread(l.id)}
                        </span>
                        {/* The agent that takes its new tasks. */}
                        <ListTaker list={l} people={people} />
                        {/*
                  The way to add one, beside the name of the list it goes in.

                  It was the last thing in the column, under the cards, which
                  is where it stops being reachable: a column with twelve
                  cards in it hides its own add behind a scroll, and the
                  control moves down the screen every time somebody uses it.
                  The heading does not move, and it is the same mark in the
                  same place as the band strip in the list — one gesture for
                  making a task, wherever the work is being looked at.
                */}
                        <span className="ml-auto flex items-center gap-1" data-no-drag>
                          {/* Out of the way of the reading: a board is read across,
                      and a control that narrows a column belongs at the end
                      of that column's own heading rather than in a menu. */}
                          <button
                            data-narrow={l.id}
                            /* The same ground under the pointer as the plus beside
                       it: `data-control` is what draws it, and the radius it
                       inherits is the box's own — so the two have to agree
                       about their size and their corner as well. */
                            data-control
                            aria-label={W.collapse(l.name)}
                            title={W.collapse(l.name)}
                            onClick={() => narrow(l.id, true)}
                            data-col-reveal
                            className="flex size-6 shrink-0 items-center justify-center opacity-0 transition-opacity focus-visible:opacity-100 text-ink-3"
                            style={{ borderRadius: 'var(--r-field)' }}
                          >
                            <Icon name="shrink" size={16} />
                          </button>
                          {canMake && (
                            <NewButton
                              label={MAKE.addTask}
                              variant="bare"
                              testId={`add-in-column-${l.id}`}
                              what={taskWhat(l.id)}
                              onMade={load}
                            />
                          )}
                        </span>
                      </div>
                      {/* A box exactly the scroller's size, so the fade can be put
                  at its foot. The column itself is taller — it holds the
                  heading too — and positioned against that, the fade sat
                  thirty-two pixels below the cards. */}
                      <div className="relative flex min-h-0 flex-1 flex-col">
                        <div
                          data-column-scroll
                          data-fluid
                          /*
                           * Down only, said out loud.
                           *
                           * `overflow-y: auto` alone leaves the other axis `visible`,
                           * which CSS then computes to `auto` — so a column could grow
                           * a horizontal scrollbar, and it did: the vertical one takes
                           * ten pixels of width, the travelling highlight had already
                           * been measured against the ten pixels that are now gone, and
                           * a bar appeared along the bottom of a stack of cards with
                           * nothing to the left or right of them.
                           *
                           * A column is a column. There is nothing sideways in it.
                           */
                          /*
                           * And no bar at all, like the list beside it.
                           *
                           * The list hides the browser's and draws its own outside the
                           * panel, because a styled bar is not an overlay and takes
                           * real width from whatever it is in — which on a machine set
                           * to show scrollbars always left the rows inset from the
                           * panel they are painted on.
                           *
                           * A column cannot take that answer. It is 256 pixels at its
                           * narrowest with five of them on the screen, and a bar in
                           * the gutter beside each is five strips of furniture between
                           * the cards. What a bar says here — there is more below — is
                           * said instead by the fade over the last card, which costs
                           * no width at all.
                           */
                          data-own-bar
                          ref={(n) => {
                            columnPane(l.id).current = n
                          }}
                          data-foot
                          className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto"
                          /* Left to the browser. Naming an axis here would refuse
                   the other one to everything inside the column, and a
                   card is the thing a finger starts on. */
                        >
                          {/*
                  The same travelling light the lists have, over the cards
                  rather than under them: a card has a ground of its own, and
                  a highlight behind something opaque is a highlight nobody
                  sees.

                  Not while a card is being carried. What answers "where will
                  this land" during a drag is the gap left in the column, and
                  a second light following the pointer is a second answer to
                  the one question the board is being asked.
                */}
                          {!drag && <Fluid what="[data-card]" tone="over" />}
                          {(arranged.get(l.id) ?? []).map((t) =>
                            /*
                             * A hole only while the card is actually in the air.
                             *
                             * `drag` outlives the release by the 170ms the copy
                             * takes to fly home, and the hole used to outlive it
                             * too — so for those 170ms the card was nowhere in its
                             * column and everything below it had moved up a slot.
                             * Measured: absent from the DOM for 180ms, then back at
                             * its place. That is what “it swaps with another card
                             * for a second and then lands right” was: not the
                             * server disagreeing, which arrives later and agrees,
                             * but our own gap left open while nothing was in it.
                             *
                             * The card goes back the instant the finger lifts and
                             * the copy finishes its flight over the top of it. The
                             * copy is what is moving; the column is already right.
                             */
                            drag?.id === t.id && !drag.settling ? (
                              /*
                               * The gap it will leave, where it will leave it.
                               *
                               * This is the whole indicator: the card is drawn
                               * elsewhere, following the pointer, and what stays behind
                               * is the shape of the hole. Nothing moves when it is let
                               * go, because the board is already arranged the way the
                               * drop will arrange it.
                               */
                              <div
                                key={t.id}
                                data-slot={t.id}
                                data-hole
                                className="shrink-0 bg-sunken"
                                /*
                                 * A hole the card can be seen landing in, not a wash.
                                 *
                                 * It was `--hover` — six per cent, the tint a pointer
                                 * leaves passing over something. At that strength the
                                 * one place on the screen answering "where will this
                                 * go" was the faintest thing on it, and on a full
                                 * column it read as a gap rather than a destination.
                                 *
                                 * Sunk rather than tinted: the card is being carried
                                 * above the board, so what it leaves is a dent in the
                                 * surface, and the inset line is the edge of that dent
                                 * catching light. The ring is what gives it the card's
                                 * own shape at the card's own height rather than a
                                 * soft patch.
                                 */
                                /*
                                 * `shrink-0`, or there is no hole at all.
                                 *
                                 * The column is a flex column and the cards in it are
                                 * their own height; this box sets `height` and nothing
                                 * else, so on a column taller than the pane flex gave
                                 * it the shrink every other child was refusing and it
                                 * rendered at zero. The inline height said 112px and
                                 * the box measured none — which is why the thing that
                                 * answers "where will this land" could not be seen.
                                 */
                                style={{
                                  height: drag.h,
                                  borderRadius: 'var(--r-card)',
                                  boxShadow: 'inset 0 0 0 1px var(--line), inset 0 1px 3px rgb(0 0 0 / 0.12)',
                                }}
                              >
                                {/*
                                 * The hole keeps the card's own markup inside it, hidden.
                                 *
                                 * Chrome ends a touch when the element it landed on
                                 * leaves the document, and the drag dies with the
                                 * `pointercancel` that says so. This is the one place
                                 * that happened: the card comes out of the column on
                                 * the first move and the hole goes in its place, so the
                                 * button under the finger is unmounted. Measured, with
                                 * nothing else changed — `pointermove → REMOVED BUTTON
                                 * → pointermove → pointercancel`, fourteen milliseconds
                                 * between the two.
                                 *
                                 * `hidden` rather than taken out: no size, no
                                 * hit-testing, nothing to see, and React still owns the
                                 * node, so the browser goes on holding what it is
                                 * holding. The copy following the pointer is drawn in
                                 * its own layer as before.
                                 *
                                 * This stops the cancel and is not enough on its own —
                                 * one move of five still arrives, because the
                                 * compositor takes the gesture for a pan. The other
                                 * half is in `useDrag.ts`.
                                 */}
                                <div hidden>{card(t, l.id)}</div>
                              </div>
                            ) : (
                              <BoardCard
                                key={t.id}
                                t={t}
                                col={l.id}
                                taken={taken.has(t.id)}
                                look={look}
                                parts={partsSaid(t.id)}
                                fns={cardFns}
                              />
                            ),
                          )}
                          {/* The room the rest of the list will take, read
                              as it comes near. */}
                          {unread(l.id) > 0 && (
                            <Unread
                              count={unread(l.id)}
                              of={columnPane(l.id)}
                              what="[data-card]"
                              guess={96}
                              onNear={() => void more(l.id)}
                            />
                          )}
                        </div>
                        {/* Over the cards and at the foot of the scroller, which means
                  beside it rather than in it: inside, it is positioned
                  against the scrolled content and travels up out of sight
                  with it. Measured doing exactly that — its foot 777 pixels
                  above the column's once scrolled to the end. `ColumnFade`. */}
                        <ColumnFade of={columnPane(l.id)} />
                        {/* And the bar itself, floated over the cards rather than
                  given a column of its own: a board cannot spare the width
                  five times over. It says where in the column you are, and
                  is the handle for changing it — which the fade cannot be.
                  Only while the pointer is in this column. */}
                        <ListBar of={columnPane(l.id)} over />
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/*
            The card in flight, drawn outside every column.
            
            It has to live here rather than in the column it came from: inside
            one, it is the topmost thing under the pointer and the browser
            answers "that column" to every question about where the pointer
            is, so a card carried two columns over lands back where it
            started. Out here and with no pointer events, it is not an answer
            to anything — the board underneath is.
          */}
              {drag && held && (
                <div
                  ref={layer}
                  data-in-flight
                  className="pointer-events-none fixed z-50"
                  style={{ left: drag.x - drag.grabX, top: drag.y - drag.grabY, width: drag.w }}
                >
                  {/*
                A stack, when several are being carried.

                Two sheets under the card, each a step lower and a step
                narrower, so their edges show below it: the hand is on one
                card and several are moving, and the thing following the
                pointer is the only place that can be said. They were inside
                the card, under its own ground, and showed as a hairline at
                most. Drawn behind rather than beside, because they are one
                thing being carried — and the column opens one place for it,
                not one per card. `docs/specs/many-at-once.md`.
              */}
                  {/* As many sheets as there are other cards, up to two: two
                  carried showed three, which is a count the badge then had
                  to contradict. */}
                  {stack > 1 &&
                    (stack > 2 ? [2, 1] : [1]).map((n) => (
                      <span
                        key={n}
                        aria-hidden
                        data-stack-sheet
                        className="absolute inset-0 bg-surface"
                        style={{
                          transform: `translateY(${n * 8}px) scale(${1 - n * 0.04})`,
                          transformOrigin: '50% 100%',
                          borderRadius: 'var(--r-card)',
                          boxShadow: 'var(--card-shadow)',
                          opacity: n === 2 ? 0.7 : 1,
                        }}
                      />
                    ))}
                  <div
                    className="relative px-4 py-3"
                    style={{
                      /*
                       * A shade off its own ground while it is in hand, and no
                       * colour at all.
                       *
                       * The lift and the shadow say “off the board” to a mouse,
                       * which also has a cursor and a hover to say it. A finger
                       * has neither and the hold is otherwise silent, so the
                       * card answers for itself — but it answers quietly.
                       *
                       * This was the accent at fourteen per cent with a ring to
                       * match, and that is the wrong register: the accent means
                       * “chosen”, which is what a taken row in the list is, and
                       * a carried card is not being chosen — it is being moved.
                       * Said in blue it also became the loudest thing on a
                       * screen whose whole subject is the card under the thumb,
                       * and the colour arrived before the card had gone
                       * anywhere.
                       *
                       * `--ink` at four per cent is about one step of tone: it
                       * reads as the same card, picked up, which is what
                       * happened. The shadow and the scale carry the rest, and
                       * they are the part that says “in the air”.
                       */
                      background: 'color-mix(in oklch, var(--ink) 4%, var(--surface))',
                      borderRadius: 'var(--r-card)',
                      boxShadow: 'var(--glass-shadow)',
                      // Lifted, not enlarged. Enough to read as off the board and
                      // not so much that it stops being the card that was picked
                      // up.
                      transform: 'scale(1.02)',
                      transformOrigin: `${drag.grabX}px ${drag.grabY}px`,
                    }}
                  >
                    {/* The count, on the card the hand is on: the sheets behind it
                    say "several", this says how many. */}
                    {stack > 1 && (
                      <span
                        data-carrying
                        className="absolute -top-2 -right-2 z-10 flex h-5 min-w-5 items-center justify-center px-2 text-xs font-medium bg-accent"
                        style={{ borderRadius: 999, color: '#fff' }}
                      >
                        {stack}
                      </span>
                    )}
                    {card(held, held.list_id ?? '')}
                  </div>
                </div>
              )}
            </div>
            <BoardBar of={board} />
          </div>
          {wide && (
            <ViewPanel
              open={panel}
              on="board"
              group={group}
              sort={sort}
              dir={dir}
              who={who}
              labels={labels}
              people={people}
              meId={meId}
              allLabels={allLabels}
              lists={lists}
              list={list}
              shows={shows}
              onShows={setShows}
              onPick={onNavigate}
            />
          )}
        </div>
      </div>
    )
  )
}
