import { MAKE } from '../../data/words.js'
import { NewButton } from '../New.jsx'
import { EmptyState, Fluid, Hairline } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { EMPTY_TASKS, ViewPanel } from './view.jsx'
import { ListBar } from './listBar.jsx'
import { Unread } from './unread.jsx'
import { type TasksProps } from '../Tasks.jsx'
import { type TaskData } from './useTaskData.js'
import { type ListShape } from './useListShape.js'
import { type RowRenderer } from './rowRenderer.jsx'
import { type TaskKeys } from './useTaskKeys.js'
import { type ColumnPanes } from './useColumnPanes.js'

/**
 * The tasks as a list.
 */
export function listView({
  canWrite,
  canMake,
  group,
  sort,
  dir,
  who,
  list,
  onNavigate,
  meId,
  labels,
  tasks,
  view,
  wide,
  panel,
  shows,
  setShows,
  people,
  lists,
  load,
  more,
  unread,
  taskWhat,
  partsShown,
  allLabels,
  shut,
  bands,
  indexOf,
  at,
  setAt,
  row,
  fold,
  paneNode,
  paneReady,
  pane,
}: Pick<TasksProps, 'canWrite' | 'canMake' | 'group' | 'sort' | 'dir' | 'who' | 'list' | 'onNavigate' | 'meId'> &
  Required<Pick<TasksProps, 'labels'>> &
  Pick<
    TaskData,
    'tasks' | 'view' | 'wide' | 'panel' | 'shows' | 'setShows' | 'people' | 'lists' | 'load' | 'more' | 'unread' | 'taskWhat'
  > &
  Pick<ListShape, 'partsShown' | 'allLabels' | 'shut' | 'bands' | 'indexOf' | 'at' | 'setAt'> &
  Pick<RowRenderer, 'row'> &
  Pick<TaskKeys, 'fold'> &
  Pick<ColumnPanes, 'paneNode' | 'paneReady' | 'pane'>): React.ReactNode {
  return (
    view === 'list' && (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {/* The work and how it is being looked at, side by side and starting
              on the same line. No gap: the panel carries it, so that when the
              panel is nothing there is nothing — see `ViewPanel`. */}
        <div className="flex min-h-0 flex-1">
          {/*
            The highlight goes out with the pointer.
            
            Hovering moves the cursor, which is right — Down after the hand
            has been on a row carries on from that row. But it stayed lit
            once the hand left, so a list somebody had run the mouse across
            kept a bright row in the middle of it that nothing was pointing
            at any more. Leaving the list is leaving it.
          */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" onPointerLeave={() => setAt(-1)}>
            {/* Empty means nothing in it, not nothing showing: a person who
                has folded every band away has not emptied the project, and a
                screen telling them so is a screen that has lost their work.
                
                The full state rather than a line of grey text, because this
                is the whole screen — a screen with one sentence in its top
                corner reads as something that failed to load. */}
            {tasks && bands.length === 0 && (
              <EmptyState
                art="board"
                title={EMPTY_TASKS.title}
                /* The same button as the one in the corner, not a second
                   way in: it opens the same dialog and lands the task in
                   the same place. */
                /* Its own name, not the corner button's: with both on the
                   screen a test asking for `create-new-task` finds two, and
                   two things answering to one name is the fault whichever
                   one it picks. */
                action={canWrite ? <NewButton label={MAKE.newTask} testId="empty-new-task" what={taskWhat()} onMade={load} /> : undefined}
              >
                {EMPTY_TASKS.body}
              </EmptyState>
            )}

            {/*
              One panel with hairlines in it, not a stack of loose rows.
              
              The rows were floating on the page and told apart by their hover
              state alone, which is a list that only has edges while the
              pointer is in it. The ground holds them together and the
              hairlines — inset to where the titles start — separate them.
            */}
            {/*
              Not until the tasks are known.
              
              The panel drew itself the moment the screen mounted — empty,
              with an "Add Task" row at the top of it — and the rows then
              pushed that row two hundred and seventy pixels down. The
              largest movement in the product, and the one a person means by
              "it jumps when it loads": something they could already reach
              for went somewhere else while they were reaching. That row is
              gone, and the rule it taught is not: nothing is drawn here
              until there is something to draw.
            */}
            {tasks && bands.length > 0 && (
              /*
               * The panel is what scrolls, not the space around it.
               *
               * It used to sit inside a scroller that filled the screen, so a
               * list longer than the window ran off the bottom of it — no
               * lower edge, no bottom corners, and the bar down the side
               * belonged to the page rather than to the panel it was
               * scrolling. A sheet of paper with a cut-off bottom.
               *
               * Scrolling itself, it ends where the work area ends, with its
               * corners on, and the bar is inside it against its own right
               * edge. `min-h-0` and no grow: it takes the height its rows
               * want up to the room there is, so four tasks are a short panel
               * and forty are a full one.
               */
              <div
                /* `relative`, so the bar floated beside the pane is
                   positioned against this and lands in the tool body's own
                   margin, rather than against whatever the next positioned
                   ancestor happens to be — which put it off the screen. */
                /* Down into the tool body's own foot (`pb-6`, the gutter on
                   a phone): rows run on to the panel's edge while there are
                   more below, which is how a list says it goes on, and the
                   room under the last one is the spacer at the end of the
                   scroll — there only when the end is reached. */
                className="relative -mb-6 flex min-h-0 flex-1 max-sm:-mb-[var(--gutter)]"
              >
                <div
                  ref={pane}
                  data-fluid
                  data-reads-down
                  data-own-bar
                  data-foot
                  className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
                  /*
                   * The corners are on the scroller as well, and this is the
                   * pair that matters.
                   *
                   * The sheet inside has had `--r-card` and `overflow: hidden`
                   * all along, so it was never missing corners — it was missing
                   * them *where they can be seen*. Measured on a full list the
                   * sheet is 2647px tall inside a 576px pane: its own bottom
                   * edge, rounded, is two thousand pixels below the window, and
                   * what the eye gets at the bottom of the work area is the
                   * straight cut the scroller makes through the middle of it.
                   *
                   * So the scroller is rounded too. It is the element that
                   * actually ends where the work area ends, so its radius is
                   * the one the bottom edge takes, whether the list is four
                   * rows or four hundred.
                   *
                   * Both, not one instead of the other. The sheet keeps its own
                   * because it is what the rows are painted on and what the
                   * highlight is clipped by — and because on a short list the
                   * sheet ends above the scroller, and then the corners that
                   * show are the sheet's.
                   *
                   * No ground here, only the shape.
                   *
                   * The scroller was painted `--panel` for a while, to carry
                   * the ground the last twelve pixels out to the rounded
                   * corner — the sheet being inset from the reserved gutter
                   * and so stopping short of its own panel's edge.
                   *
                   * The gutter is gone and the sheet now shares every edge
                   * with this, so there is nothing left for a second coat of
                   * the same colour to reach. What it did instead was fill
                   * the whole height whether or not there was anything on it:
                   * fold every band away and the panel went on below the last
                   * one, a field of ground with nothing standing in it.
                   *
                   * The sheet is `shrink-0`, so it is exactly as tall as what
                   * it holds. Leaving the ground to it alone is what makes a
                   * folded list end where its names end.
                   */
                  style={{ borderRadius: 'var(--r-card)' }}
                >
                  {/* One highlight for the sheet, travelling between the rows
                    and the strips — `Fluid`. `also` is the keyboard's
                    cursor: where it goes when the pointer is elsewhere. */}
                  {/*
                  The sheet is inside the gutter, not around it.
                  
                  The ground and the corners were on the scroller, which
                  reserves ten pixels down its right for the bar —
                  `scrollbar-gutter: stable`, and the reason is in
                  `theme.css`. Its rows fill the content box and the gutter
                  is outside that, so every row, and the highlight that
                  takes a row's shape, stopped ten pixels short of a panel
                  that went on without them. A sheet of paper with a strip
                  of itself nobody can touch.
                  
                  Painted one level in, the sheet is exactly as wide as the
                  rows on it and the bar rides in the strip beside it.
                */}
                  {/*
                  The highlight lives inside the sheet and is clipped by it.
                  
                  It was a sibling, drawn over the sheet from the scroller,
                  so it kept its own square corners over the sheet's round
                  ones: the first band and the last row had the top and
                  bottom of the panel cut off behind them. A highlight takes
                  the shape of the row it is on — and at the edges the shape
                  of the row is the shape of the sheet.
                */}
                  {/*
                  All four corners, now that nothing is inset.

                  This was square at the foot for a while, and the reason is
                  worth keeping because it is the reason the gutter went.
                  The scroller used to reserve twelve pixels for the bar, so
                  the sheet sat inside them: rounded at the bottom its curve
                  began twelve pixels early and left a notch before the
                  scroller's own, and squaring it let the scroller's radius
                  do the shaping.

                  Both of those were answers to the inset, and the inset is
                  gone — `scrollbar-gutter` in `theme.css`, dropped because a
                  bar that is transparent until the pointer arrives has
                  nothing to reserve against. The sheet and the scroller now
                  share every edge, so the radius can simply be on the sheet,
                  where the ground it shapes is.
                */}
                  {/*
                  Each list a block of its own, its tasks a white sheet
                  nested in it — the board's column, laid down as a row:
                  the list's ground (`--lane`) round its heading and its
                  tasks, and the tasks on the card's white (`--card`). One
                  grey field with the rows on it read as one long list with
                  stripes, not as lists.
                */}
                  <div data-sheet className="relative flex shrink-0 flex-col gap-3">
                    {bands.map((band, bi) => (
                      <div
                        key={band.key}
                        data-band-block
                        className="relative flex flex-col p-1"
                        style={{ background: band.said !== null ? 'var(--lane)' : undefined, borderRadius: 'var(--r-card)' }}
                      >
                        {/*
                      Nothing between the bands but the band itself — except
                      between two that are shut.
                      
                      There was a hairline here always, from when a band was
                      bare and needed something to say a group had ended. It
                      has its own shade now — `--band`, a strip the rows do
                      not have — and where rows follow, that strip already is
                      the boundary: drawn as well, the line sat on the edge
                      of a block that was visibly a block, so every heading
                      carried a rule saying what the shade beneath it had
                      already said.
                      
                      That argument holds only while something separates one
                      strip from the next. Folded, it does not: the rows are
                      gone and the shade is continuous, so four shut bands
                      are four names on one unbroken field with nothing to
                      say where one ends. The strip cannot be its own
                      boundary when the strip never stops.
                      
                      So the line is drawn whenever the band *above* is shut,
                      which is exactly when two strips meet with nothing
                      between them. Both shut is the obvious case; a shut one
                      above an open one is the same meeting and wants the
                      same line, which asking about both missed. What it is
                      not is a line under an open band — there the rows below
                      it are the separation, and the rule would be the
                      heading saying twice what the shade said once.
                      
                      The rows inside a band keep their hairline, inset to
                      where the titles start. That is the weaker boundary and
                      it is the one that still needs drawing.
                    */}
                        {band.said !== null && (
                          <div
                            data-band
                            data-shut={shut(band.key) ? '' : undefined}
                            /* Even above and below, not tucked under its rows.
                           It was 14 above and 6 below, which reads as a
                           heading leaning on what follows it — and a band
                           that is shut has nothing to lean on, so four shut
                           bands were four names sitting high in their own
                           strips. The strip is the same height either way.
                           
                           The whole strip lights under the pointer, because
                           the whole strip is the switch. A band folded by a
                           name-sized target in a full-width heading is a
                           control you have to aim at. */
                            /* The row's own right edge, so the plus on a band
                           and the face on a row below it stop at one line. */
                            className="relative flex items-center gap-1 pr-4"
                            /* The cursor comes off the rows when the pointer
                           reaches a strip: one thing at a time is pointed
                           at, and with one highlight between them that is
                           not a rule to keep but the shape of the thing. */
                            onPointerEnter={() => setAt(-1)}
                            data-no-drag
                            /* The block's own ground: the block is the group now. */
                          >
                            {/*
                          The strip is the switch.
                          
                          An arrow small enough to be an arrow is too small to
                          be a target, and the heading beside it is the thing
                          the hand is already going for — so the button is
                          the strip, from the arrow to the plus, and carries
                          the padding that used to be on the strip itself. A
                          heading with a name-sized hit area in it is a
                          control you have to aim at.
                        */}
                            <button
                              data-band-fold
                              aria-expanded={!shut(band.key)}
                              onClick={() => fold(band.key, !shut(band.key))}
                              /* The chevron where the ring below it is, and the
                             name where the title is: a heading whose parts
                             stand in the row's own two columns rather than
                             in columns of its own. `pl-4` is the row's
                             padding, and the gap is the ring's width plus
                             the row's gap after it — 16 and 16, which puts
                             the name at the same 556 the titles start at. */
                              className="flex min-w-0 flex-1 items-center gap-4 py-3 pl-4 text-left text-base font-medium text-ink-2"
                              style={{ letterSpacing: 'var(--track-body)' }}
                            >
                              {/* Two pixels right, onto the ring below it.
                              The chevron is a 14 glyph in a 16 box and the
                              status ring under it is 18 wide, so centring
                              each in its own column left their middles at
                              532 and 534 — the heading's mark hanging a
                              fraction left of the column of marks it is
                              supposed to head. The box keeps its width so
                              the name after it does not move. */}
                              <span className="flex size-4 items-center justify-center translate-x-[2px]">
                                <Icon
                                  name="chevR"
                                  size={14}
                                  tone="quiet"
                                  style={{
                                    transform: shut(band.key) ? undefined : 'rotate(90deg)',
                                    transition: 'transform 140ms var(--ease-out)',
                                  }}
                                />
                              </span>
                              <span className="truncate">{band.said}</span>
                              {/* How many, against the name rather than adrift
                              between it and the rest of the strip. It carried
                              four of its own on top of the button's sixteen,
                              so the number sat twenty out — further from the
                              word it counts than the word is from the mark
                              beside it. The gap is the strip's own now. */}
                              <span className="-ml-2 tabular-nums text-ink-3">
                                {band.rows.length + (group === 'list' ? unread(band.key) : 0)}
                              </span>
                            </button>
                            {/*
                          Making one where it belongs. The band already says
                          which list, and whose, so the dialog opens with that
                          answered.
                        */}
                            {canMake && (
                              <NewButton
                                label={MAKE.addTask}
                                variant="bare"
                                testId={`add-in-band-${bi}`}
                                what={taskWhat(
                                  group === 'list' && band.key !== '~' ? band.key : undefined,
                                  group === 'who' && band.key !== '~' ? band.key : undefined,
                                )}
                                onMade={load}
                              />
                            )}
                          </div>
                        )}
                        {!shut(band.key) && band.rows.length > 0 && (
                          <div
                            data-band-rows
                            className="relative flex flex-col overflow-hidden"
                            style={{ background: 'var(--card)', borderRadius: 'calc(var(--r-card) - 4px)' }}
                          >
                            {/* The rows' own highlight, inside the white sheet
                              so its corners are the sheet's at the first row
                              and the last. */}
                            <Fluid what="[data-task]" also="[data-lit]" />
                            {band.rows.map((t, j) => (
                              <div key={t.id} className="contents">
                                {/* Not beside the row the pointer is on: the line
                              above it and the line below it both belong to a
                              boundary that row does not have while it is lit.
                              The index is the one the keyboard walks, so the
                              two agree about which row is which. */}
                                {(indexOf.get(t.id) ?? 0) > 0 && j > 0 && (
                                  <Hairline away={at === (indexOf.get(t.id) ?? 0) || at === (indexOf.get(t.id) ?? 0) - 1} />
                                )}
                                {row(t, 0)}
                                {/* Its parts, under it and indented to it. Never rows
                              of their own, in any grouping or ordering: a part
                              that floats away from the task it belongs to is a
                              line nobody can read. */}
                                {/* Parted like any other rows, with the line inset to
                              where a part's title starts rather than a task's:
                              the line says these are rows of their own, and
                              where it starts says whose. */}
                                {partsShown(t).map((c) => {
                                  const i = indexOf.get(c.id) ?? 0
                                  return (
                                    <div key={c.id} className="contents">
                                      <Hairline inset={46 + 32} away={at === i || at === i - 1} />
                                      {row(c, 1)}
                                    </div>
                                  )
                                })}
                              </div>
                            ))}
                            {/* The room the rest of the list will take, read
                              as it comes near. */}
                            {group === 'list' && unread(band.key) > 0 && (
                              <Unread
                                count={unread(band.key)}
                                of={paneNode}
                                what="[data-band-rows] > .contents > [data-task]"
                                guess={44}
                                onNear={() => void more(band.key)}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div aria-hidden data-list-end className="h-6 shrink-0 max-sm:h-[var(--gutter)]" />
                </div>
                {/*
                Outside the panel, and taking no width from it.

                Standing beside the pane as a flex child, this took twelve
                pixels plus its margin out of the row — so the sheet ended
                sixteen short of the toolbar above it, which is the same
                fault as the reserved gutter wearing different clothes. A
                test that measures the bar against the work's right edge
                caught it at exactly sixteen.

                Floated instead, in the twenty-four the tool body already
                pads with: the sheet runs the full width, the toolbar lines
                up with it, and the bar rides in the margin beside them
                both rather than between them.
              */}
                <ListBar of={paneNode} key={paneReady} over outside />
              </div>
            )}
          </div>
          {wide && (
            <ViewPanel
              open={panel}
              on="list"
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
