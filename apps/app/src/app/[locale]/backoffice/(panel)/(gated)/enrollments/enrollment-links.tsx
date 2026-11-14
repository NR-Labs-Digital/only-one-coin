'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FiltersDropdown } from '@/components/backoffice/filters-dropdown'
import { BoIcon } from '@/components/backoffice/icons'
import { enrollmentLinks, type EnrollmentLinkKind } from '@/lib/enrollment/links'

const KINDS: readonly EnrollmentLinkKind[] = ['web', 'whatsapp_ai']

/**
 * The checkout links, ready to copy (OOC-139): the plain form, and the short
 * link the WhatsApp AI assistant sends — each records its own channel on the
 * enrollment, which is what the "Por canal" figures count.
 *
 * Built from the browser's origin after mount: on the backoffice domain the
 * checkout lives on the student domain (`lib/hosts.ts`), and the server
 * render does not know which domain the reader came in by.
 */
export function EnrollmentLinks() {
  const t = useTranslations('bo')
  const [links, setLinks] = useState<Record<EnrollmentLinkKind, string> | null>(null)
  const [copied, setCopied] = useState<EnrollmentLinkKind | null>(null)

  useEffect(() => {
    setLinks(enrollmentLinks(window.location.origin))
  }, [])

  async function copy(kind: EnrollmentLinkKind) {
    if (!links) return
    try {
      await navigator.clipboard.writeText(links[kind])
      setCopied(kind)
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000)
    } catch {
      // Clipboard permission denied or unavailable — the link stays on
      // screen, selectable, so copying by hand still works.
    }
  }

  return (
    <FiltersDropdown
      label={t('enrollments.links_button')}
      count={0}
      icon="link"
      panelClassName="flex-col gap-3"
    >
      {KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`enrollments.links_${kind}`)}
          </span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all truncate rounded-lg border border-line bg-cream px-2.5 py-2 text-xs text-ink">
              {links?.[kind] ?? ''}
            </code>
            <button
              type="button"
              onClick={() => void copy(kind)}
              disabled={!links}
              className="inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-muted-foreground transition hover:text-ink disabled:opacity-50"
            >
              <BoIcon name={copied === kind ? 'check' : 'copy'} size={14} />
              {t(copied === kind ? 'enrollments.links_copied' : 'enrollments.links_copy')}
            </button>
          </div>
          <span className="text-xs text-muted-foreground">{t(`enrollments.links_${kind}_hint`)}</span>
        </div>
      ))}
    </FiltersDropdown>
  )
}
