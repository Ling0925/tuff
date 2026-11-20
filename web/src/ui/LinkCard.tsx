import { LINK_CARD as W } from '../words/linkCard.js'

/** A link's card. */
export type Card = { url: string; title: string; description: string | null; image: string | null; site: string | null }

export function LinkCard({ card, onRemove }: { card: Card; onRemove?: () => void }) {
  return (
    <div className="py-1" data-link-card>
      {/* The picture on top at the shape Open Graph makes it — 1200 by 630 —
          and the words under it. Beside the words it was cropped to a
          square and showed a sliver of a page made to be seen whole. */}
      <a
        href={card.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex max-w-[400px] flex-col overflow-hidden transition-colors mouse:hover:bg-[var(--hover)]"
        style={{ borderRadius: 12, boxShadow: 'inset 0 0 0 1px var(--line)' }}
      >
        {card.image?.startsWith('/api/preview/image?') && (
          <img
            src={card.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            /* A picture behind the site's own sign-in — a private file's
               thumbnail — is a broken one here: the card goes without it. */
            onError={(e) => (e.currentTarget.style.display = 'none')}
            className="block aspect-[1200/630] w-full object-cover bg-sunken"
          />
        )}
        <span className="flex min-w-px flex-col gap-1 px-4 py-3">
          {card.site && <span className="truncate text-xs text-ink-3">{card.site}</span>}
          <span className="line-clamp-2 text-base font-medium text-ink">{card.title}</span>
          {card.description && <span className="line-clamp-2 text-sm text-ink-2">{card.description}</span>}
        </span>
      </a>
      {onRemove && (
        <button
          type="button"
          data-testid="remove-link-card"
          aria-label={W.removePreview}
          onClick={onRemove}
          className="mt-1 text-sm text-ink-3"
        >
          {W.removePreview}
        </button>
      )}
    </div>
  )
}
