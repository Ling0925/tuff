import { createPortal } from 'react-dom'
import { BAR } from '../../data/words.js'
import { warm, projectSettingsReads } from '../../data/ahead.js'
import { ProjectMark, markOf } from '../icons.jsx'
import { Resizer, Fluid, Row, Badge, COLUMN_MS } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { tabs, TOOL_ICON, LABEL } from '../../data/tools.js'
import { roomCount } from '../Sidebar.jsx'
import { type ProjectProps } from '../Project.jsx'
import { type ProjectFrame } from './useProjectFrame.js'
import { fold } from './fold.js'

/** One curve for everything that moves when the column folds. */
const travel = (props: string[]) => props.map((p) => `${p} ${COLUMN_MS}ms var(--ease-out)`).join(', ')

/** `visibility` waits out the travel when going, and is immediate when coming. */
const hide = (going: boolean) => `visibility 0s linear ${going ? COLUMN_MS : 0}ms`

/**
 * The project's tools down the side, on a wide window.
 */
export function toolsNav({
  project,
  canReadActivity,
  rooms,
  can,
  canSettings,
  onNavigate,
  toolsWidth,
  setToolsWidth,
  toolsInitial,
  wide,
  shown,
  waiting,
  warmRooms,
  folded,
  moving,
  slot,
}: Pick<ProjectProps, 'project' | 'canReadActivity' | 'rooms' | 'can'> & {
  /** Folded into the sidebar. */
  folded: boolean
  /** Travelling between the two, so it eases; a key's change does not. */
  moving: boolean
  /** The place under the project's row in the sidebar, while there is one. */
  slot: HTMLElement | null
} & Pick<
    ProjectFrame,
    'canSettings' | 'onNavigate' | 'toolsWidth' | 'setToolsWidth' | 'toolsInitial' | 'wide' | 'shown' | 'waiting' | 'warmRooms'
  >): React.ReactNode {
  const list = tabs(project.tools, canReadActivity, canSettings)
  const urgent = rooms.some((r) => r.project_id === project.id && roomCount(r).urgent)
  return (
    wide && (
      <>
        {/*
        The column and the gap after it, as one box that can close.

        Folding takes the width to nothing and the sheet inside slides left
        under the sidebar as it goes, fading — so it reads as going into the
        sidebar, where its rows are arriving on the same curve. The box
        clips only while it travels and while it is shut: open, the resize
        handle hangs half outside it and a clip would cut that half off.
      */}
        <div
          data-tools-column
          data-folded={folded ? '' : undefined}
          inert={folded || undefined}
          className="relative flex shrink-0"
          style={{
            width: folded ? 0 : `calc(${toolsWidth}px + var(--lift))`,
            overflow: folded || moving ? 'hidden' : undefined,
            transition: moving ? travel(['width']) : 'none',
          }}
        >
          <nav
            data-panel
            className="relative flex shrink-0 flex-col"
            /* Scrolling one level in, so the resize handle is not clipped: an
           `overflow` cuts absolutely positioned children off at the edge. */
            style={{
              width: toolsWidth,
              /* The second column is a sheet too, not a strip of the ground. */
              background: 'var(--chrome)',
              borderRadius: 'var(--r-lift)',
              transform: folded ? 'translateX(-100%)' : undefined,
              opacity: folded ? 0 : 1,
              /* Hidden once it has gone, as the drawer is: slid away it was
                 still there for Tab and for a reader. After the travel on the
                 way out, at once on the way in. */
              visibility: folded ? 'hidden' : 'visible',
              transition: moving ? `${travel(['transform', 'opacity'])}, ${hide(folded)}` : 'none',
            }}
          >
            <Resizer
              label={BAR.toolsWidth}
              width={toolsWidth}
              /* Dragged past where its names fit, it folds into the sidebar —
             the same gesture that shuts the sidebar to its glyphs. An arrow
             key stops at the narrowest width instead: folding is a press. */
              onChange={(n, key) => (!key && n < 120 && slot ? fold(true) : setToolsWidth(n))}
              onReset={() => setToolsWidth(toolsInitial)}
              min={168}
              max={320}
            />
            {/* The same travelling highlight as the sidebar beside it: one
            navigation, so one behaviour — `Fluid`. */}
            <div
              data-fluid
              /* The same head as the sidebar's, because the three headings line
             up across the three columns and raising one of them alone is
             what breaks that. */
              /*
               * A head inside the card, where the sidebar needs none.
               *
               * That column is on the ground: its first row's edge is the only
               * edge it has, so it begins at the top. This one is a sheet, and
               * a name pressed against a corner reads as content that did not
               * fit. The eight is the same as the padding down its sides.
               */
              /*
               * Twenty at the head, so the two names sit on one line.
               *
               * The head was eight and the project's name came out twelve above
               * the screen's name beside it — the right-hand title is 24px in a
               * sixteen head and this one 20px in an eight, so the heads were
               * equal-ish and the type was not. Measured on the baselines
               * rather than the boxes, because the boxes are different heights
               * and cannot both be centred: 81 here against 93 there.
               *
               * The twelve comes off the gap below the name, so the first tool
               * row stays at the top of the work area beside it. That is the
               * alignment that was already right and the one worth keeping —
               * the heading is a heading, but the row and the sheet are where
               * the two columns actually start.
               */
              /* Twelve at the sides, where the sidebar runs at four.
             
             The two columns do not have to match here: that one is on the
             ground and its rows are the whole of it, while this is a sheet
             and its rows want the card's own margin around them. What has
             to agree is where the first row starts, which is the head
             above. */
              className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-5 pb-4"
            >
              <Fluid />
              {/* One column down the whole sidebar. The mark is the size of the
            glyphs below it and the gap is set so the name starts exactly
            where the tools' names do — it was ten pixels further right,
            which reads as the heading belonging to something else. */}
              {/* The same band the sidebar's top row and the tool's bar use, so
            the three headings line up across the three columns. */}
              {/* A row's height, not a band of its own: the column beside this one
            starts with a row, and a head eight pixels taller puts the two
            columns' first lines apart by four. */}
              <div
                /* A gap under the name, where two pixels separate one tab from
             the next. The column's own gap is the spacing between rows in a
             list, and the heading is not one of them — with it the name sat
             on the tabs as though it were the first of them. */
                className="mb-2 flex items-center gap-2 pl-3"
                style={{ height: 'var(--row-h)' }}
              >
                <ProjectMark {...markOf(project)} size={20} />
                {/*
            The name and nothing behind it. It opened a menu that held one
            thing, the way off the project, and that was a press away from
            the work and too easy to make by accident — leaving is on the
            Projects index now, beside archiving.
          */}
                <h1 className="min-w-0 flex-1 truncate text-xl font-medium text-ink" style={{ letterSpacing: 'var(--track-title)' }}>
                  {project.name}
                </h1>
              </div>

              {/* Only for somebody who may read it: a tab that answers 403 is a
            door painted on a wall. */}
              {list.map((t) => {
                const on = shown === t
                return (
                  /* The same row as the sidebar's, not a lookalike: `Row` is what
               carries the hover, the press and the timing, and a hand-built
               button beside it was a row that did not light under the pointer
               and shrank when it was clicked. */
                  <Row
                    key={t}
                    selected={on}
                    onClick={() => onNavigate({ tool: t, objectId: null })}
                    onPointerEnter={
                      t === 'messages'
                        ? warmRooms
                        : /* Its reads asked while the pointer is on it, so it opens
                       whole — `data/ahead.ts`. */
                          t === 'settings'
                          ? () => warm(projectSettingsReads(project.id, can))
                          : undefined
                    }
                    data-testid={`tool-${t}`}
                    data-tool={t}
                    className="group relative flex w-full shrink-0 items-center gap-3 px-3 text-left text-base"
                    style={{
                      height: 'var(--nav-h)',
                      borderRadius: 'var(--r-row)',
                      /* All six at full strength; the ground under one of them
                   is what says which tab is open. */
                      color: 'var(--ink)',
                      letterSpacing: 'var(--track-body)',
                      background: on ? 'var(--hover)' : undefined,
                    }}
                  >
                    <Icon name={TOOL_ICON[t] ?? 'doc'} size={18} style={{ color: on ? 'var(--accent)' : 'var(--ink-3)' }} />
                    {/* Quieter unless open or waiting, as the side column's
                        places are — `--side-ink`, `ui/Sidebar.tsx`. */}
                    <span
                      data-side-name={on || (waiting[t] ?? 0) > 0 ? undefined : ''}
                      className="min-w-px flex-1 truncate"
                      style={on || (waiting[t] ?? 0) > 0 ? undefined : { color: 'var(--side-ink)' }}
                    >
                      {LABEL[t]}
                    </span>
                    {/*
                What is waiting behind a tab, said on the tab.
                
                The sidebar has carried this on a room since rooms existed,
                and a project's own column — the thing somebody is looking
                at while deciding where to go next — said nothing. Chat
                counts the rooms of this project; announcements counts what
                is addressed to you and unread here.
                
                The same badge the sidebar draws, because two drawings of
                one number is one of them going stale.
              */}
                    <Badge
                      count={waiting[t] ?? 0}
                      /* Red when somebody named you in one of this project's rooms. */
                      urgent={t === 'messages' && urgent}
                    />
                  </Row>
                )
              })}
            </div>
          </nav>
        </div>
        {slot &&
          createPortal(
            <>
              {/*
              The tools, under the project, opening as the column closes.

              A grid row going from nothing to its content's height, so the
              rows under it move down with it instead of jumping — on the
              column's own curve and length, so the two are one movement.
              Only while it travels: moving to another project swaps the
              rows at once, because a list easing under the pointer that
              just pressed it is the thing "Nothing jerks" forbids.
            */}
              <div
                data-fold-tools
                data-open={folded ? '' : undefined}
                inert={!folded || undefined}
                style={{
                  display: 'grid',
                  gridTemplateRows: folded ? '1fr' : '0fr',
                  opacity: folded ? 1 : 0,
                  pointerEvents: folded ? undefined : 'none',
                  visibility: folded ? 'visible' : 'hidden',
                  transition: moving ? `${travel(['grid-template-rows', 'opacity'])}, ${hide(!folded)}` : 'none',
                }}
              >
                {/* Cut top and bottom only. An `overflow` cut the sides too,
                    and shut to glyphs the scroller's content box is 28 wide
                    under its 40px tiles — every tile there overhangs it. */}
                <div className="flex min-h-0 flex-col gap-1" style={{ clipPath: 'inset(0 -16px)' }}>
                  {/* The four between the project's row and its first tool,
                    as a gap rather than a padding: a padding cannot fold
                    to nothing, a gap after an empty box can. */}
                  <span aria-hidden className="block h-0 shrink-0" />
                  {list.map((t) => {
                    const on = shown === t
                    return (
                      <Row
                        key={t}
                        selected={on}
                        onClick={() => onNavigate({ tool: t, objectId: null })}
                        onPointerEnter={
                          t === 'messages' ? warmRooms : t === 'settings' ? () => warm(projectSettingsReads(project.id, can)) : undefined
                        }
                        data-testid={`side-tool-${t}`}
                        data-side-tool={t}
                        title={LABEL[t]}
                        /* Indented under the project, the way Linear keeps a
                         team's views under the team: the row and its light
                         start twenty-four in, and the icon eight inside it —
                         a little before the project's name, not under it.
                         Started full width with the icon forty in, the tools
                         read as a second list beside the project rather than
                         as its own. Shut to glyphs, a smaller tile than the
                         places above it — thirty-two in forty — so the
                         project's tools read as the project's. */
                        className="group relative ml-6 flex shrink-0 items-center gap-3 pr-2 pl-2 text-left text-base group-data-[shut]/sidebar:ml-1 group-data-[shut]/sidebar:size-8 group-data-[shut]/sidebar:justify-center group-data-[shut]/sidebar:gap-0 group-data-[shut]/sidebar:p-0"
                        style={{
                          height: 'var(--nav-h)',
                          borderRadius: 'var(--r-row)',
                          color: 'var(--ink)',
                          letterSpacing: 'var(--track-body)',
                          background: on ? 'var(--hover)' : undefined,
                        }}
                      >
                        <Icon name={TOOL_ICON[t] ?? 'doc'} size={16} style={{ color: on ? 'var(--accent)' : 'var(--ink-3)' }} />
                        <span
                          data-side-name={on || (waiting[t] ?? 0) > 0 ? undefined : ''}
                          className="min-w-px flex-1 truncate group-data-[shut]/sidebar:hidden"
                          style={on || (waiting[t] ?? 0) > 0 ? undefined : { color: 'var(--side-ink)' }}
                        >
                          {LABEL[t]}
                        </span>
                        <span className="group-data-[shut]/sidebar:hidden">
                          <Badge count={waiting[t] ?? 0} urgent={t === 'messages' && urgent} />
                        </span>
                      </Row>
                    )
                  })}
                </div>
              </div>
            </>,
            slot,
          )}
      </>
    )
  )
}
