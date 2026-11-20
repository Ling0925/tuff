import { DocTemplate } from '@tracker/shared-schema'
import { useSavedTemplates } from '../../data/docTemplates.js'
import { DOC_TEMPLATE as W } from '../../words/docTemplates.js'
import { Icon } from '../glyphs.jsx'

/**
 * What a new document can start from, under "New document" in Docs' plus:
 * the four built in, then the workspace's
 * own, newest first, each with the project it lives in. Read when Docs
 * opened (`readTemplates`), so the menu is drawn with them in it.
 */
export function TemplateRows({ onPick }: { onPick: (template: string) => void }) {
  const saved = useSavedTemplates()
  return (
    <div data-template-rows role="group" aria-label={W.templates}>
      <div className="mx-3 my-1 h-px bg-line" />
      <p className="px-3 pt-1 pb-1 text-sm text-ink-3">{W.templates}</p>
      {DocTemplate.options.map((key) => (
        <button
          key={key}
          role="menuitem"
          data-row
          data-testid={`template-${key}`}
          onClick={() => onPick(key)}
          className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
          style={{ height: 'var(--row-h)' }}
        >
          <Icon name="doc" size={16} className="text-ink-3" />
          <span className="min-w-px flex-1 truncate">{W[key]}</span>
        </button>
      ))}
      {saved.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto">
          {saved.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              data-row
              data-saved-template={t.id}
              title={W.inProject(t.project_name)}
              onClick={() => onPick(t.id)}
              className="flex w-full items-center gap-3 px-3 text-left text-base text-ink"
              style={{ height: 'var(--row-h)' }}
            >
              <Icon name="copy" size={16} className="text-ink-3" />
              <span className="min-w-px flex-1 truncate">{t.name}</span>
              <span className="max-w-[96px] shrink-0 truncate text-sm text-ink-3">{t.project_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
