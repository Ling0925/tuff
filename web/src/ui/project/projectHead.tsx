import { PROJECT_SAID as W } from '../../words/project.js'
import { type IconName, ProjectMark, markOf } from '../icons.jsx'
import { Popover } from '../kit.jsx'
import { Icon } from '../glyphs.jsx'
import { TOOL_ICON, LABEL, tabs } from '../../data/tools.js'
import { type ProjectProps } from '../Project.jsx'
import { type ProjectFrame } from './useProjectFrame.js'

/**
 * The head over the open tool: its name and its controls.
 */
export function projectHead({
  project,
  canReadActivity,
  canSettings,
  onNavigate,
  setSlot,
  wide,
  phone,
  shown,
  objectHead,
  barHeld,
}: Pick<ProjectProps, 'project' | 'canReadActivity'> &
  Pick<ProjectFrame, 'canSettings' | 'onNavigate' | 'setSlot' | 'wide' | 'phone' | 'shown' | 'objectHead' | 'barHeld'>): React.ReactNode {
  return (
    <div
      /* Over an open task the head is padded the same on every side —
             eight, the room above and below its row. */
      className={`flex shrink-0 items-center ${objectHead ? 'border-b p-2' : wide ? 'pt-4' : 'gap-2 px-[var(--gutter)] pt-3'}`}
      style={objectHead ? { borderColor: 'var(--line)' } : undefined}
    >
      {/*
            On a phone the tabs are a menu at the head of this bar.

            They were a strip of their own under a strip with the project's
            name, under the top bar — three bands of chrome before any work,
            on the screen with the least room for it. The name went up into
            the top bar, and the tabs became this: the tab that is open,
            named, and the rest behind it.
          */}
      {/* Not over an open task: its way back is the round button, and a
              menu of tabs beside it was a second way out of one screen. */}
      {!wide && !objectHead && (
        <Popover
          testId="tool-menu"
          said={W.switchTab}
          width={240}
          shape="bare"
          /* The height and the rounding of the controls beside it — the
                 view switch and the view button are thirty-six and round, and
                 this stood at twenty-eight with square-ish corners, the odd
                 one in a row of three. */
          label={
            <span data-control className="flex h-9 items-center gap-2 rounded-full pr-3 pl-3 text-md font-medium text-ink bg-track">
              <Icon name={(TOOL_ICON[shown] ?? 'doc') as IconName} size={16} className="text-ink-2" />
              {LABEL[shown]}
              <Icon name="updown" size={12} className="text-ink-3" />
            </span>
          }
        >
          {(close) => (
            <div className="py-1">
              {/* Whose tabs these are — and the room a phone's sheet
                      keeps at its top for its own way out. */}
              <div className="flex h-8 items-center gap-2 px-3 pb-1 text-sm text-ink-3">
                <ProjectMark {...markOf(project)} size={16} />
                <span className="min-w-px truncate">{project.name}</span>
              </div>
              {/* On a phone, tiles two to a row: a thumb's target, not
                      a mouse's row. */}
              {phone ? (
                <div className="grid grid-cols-2 gap-2 px-3 pt-1 pb-3">
                  {tabs(project.tools, canReadActivity, canSettings).map((t) => (
                    <button
                      key={t}
                      data-tool={t}
                      data-testid={`tool-${t}`}
                      aria-current={t === shown ? 'page' : undefined}
                      onClick={() => {
                        close()
                        onNavigate({ tool: t, objectId: null })
                      }}
                      className="flex h-20 flex-col items-start justify-between rounded-[16px] p-4 text-left text-md font-medium transition-transform active:scale-[0.97]"
                      style={{
                        background: t === shown ? 'var(--accent-soft)' : 'var(--hover)',
                        color: t === shown ? 'var(--accent)' : 'var(--ink)',
                      }}
                    >
                      <Icon
                        name={(TOOL_ICON[t] ?? 'doc') as IconName}
                        size={20}
                        style={{ color: t === shown ? 'var(--accent)' : 'var(--ink-2)' }}
                      />
                      <span className="w-full truncate">{LABEL[t]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                tabs(project.tools, canReadActivity, canSettings).map((t) => (
                  <button
                    key={t}
                    data-row
                    data-tool={t}
                    data-testid={`tool-${t}`}
                    onClick={() => {
                      close()
                      onNavigate({ tool: t, objectId: null })
                    }}
                    className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
                    style={{ height: 'var(--row-h)' }}
                  >
                    <Icon name={(TOOL_ICON[t] ?? 'doc') as IconName} size={16} className="text-ink-2" />
                    <span className="min-w-px flex-1 truncate">{LABEL[t]}</span>
                    {t === shown && <Icon name="tasks" size={14} className="text-ink-2" />}
                  </button>
                ))
              )}
            </div>
          )}
        </Popover>
      )}
      <div
        ref={setSlot}
        data-tool-bar
        className={`mx-auto flex w-full min-w-px items-center justify-end gap-3 ${
          objectHead ? 'px-0' : wide ? 'px-[var(--gutter)]' : 'px-0'
        } ${barHeld}`}
        /* A row's height plus the four a row's own padding gives it, so
               the work under this bar starts where the first tool in the
               column beside it does. Forty left the sheet four low. */
        style={{ height: 36 }}
      />
    </div>
  )
}
