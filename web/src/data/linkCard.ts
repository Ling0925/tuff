import { useEffect, useState } from 'react'
import { api } from './api.js'
import type { Card } from '../ui/LinkCard.jsx'

const FIRST = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/

/**
 * The card for the first address in a line being written, read by the
 * server a moment after the address stops changing; and the way to take it
 * off.
 */
export function useLinkCard(text: string): { card: Card | null; remove: () => void; reset: () => void } {
  const url = FIRST.exec(text)?.[0] ?? null
  const [card, setCard] = useState<Card | null>(null)
  const [removed, setRemoved] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a card already in hand for this address is not asked for again, and a new card must not ask again either
  useEffect(() => {
    if (!url || url === removed) return setCard(null)
    if (card?.url === url) return
    let live = true
    const wait = setTimeout(() => {
      void api<Card>(`/preview?url=${encodeURIComponent(url)}`)
        .then((c) => live && setCard(c))
        .catch(() => live && setCard(null))
    }, 400)
    return () => {
      live = false
      clearTimeout(wait)
    }
  }, [url, removed])
  return {
    card: url && url !== removed && card?.url === url ? card : null,
    remove: () => setRemoved(url),
    reset: () => {
      setCard(null)
      setRemoved(null)
    },
  }
}
