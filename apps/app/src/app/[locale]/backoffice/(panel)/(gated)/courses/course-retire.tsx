'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { CatalogErrorKey } from '@/lib/backoffice/types'
import { setCatalogEntryOnOffer } from '@/lib/backoffice/catalog-client'
import { Card, SectionTitle } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { CatalogConfirmation, RetireConfirmation } from '@/components/backoffice/retire-confirmation'

const dangerButtonClass =
  'inline-flex min-h-tap w-fit items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40'

const secondaryButtonClass =
  'inline-flex min-h-tap w-fit items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Taking a course off the catalog, or putting it back. Never a physical
 * delete (CLAUDE.md §1, "Catálogo sai do ar, não some"): the enrollments made
 * on it keep pointing at it. Its plans and class groups leave the checkout
 * with it, and come back with it. The confirmation says how many enrollments
 * are still standing — it warns, it never blocks.
 */
export function CourseRetire({ courseId, active }: { courseId: string; active: boolean }) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function setOnCatalog(verb: 'retire' | 'restore') {
    setPending(true)
    setError(null)
    const result = await setCatalogEntryOnOffer('course', courseId, verb)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirming(false)
    setToast(
      verb === 'retire'
        ? t('courses.retired_notice', { count: result.data.liveEnrollments })
        : t('courses.restored'),
    )
    router.refresh()
  }

  return (
    <Card as="section" className="flex flex-col gap-3 p-5">
      <SectionTitle icon={active ? 'close' : 'check'}>
        {t(active ? 'courses.retire_title' : 'courses.restore_title')}
      </SectionTitle>
      <p className="text-sm text-muted-foreground">
        {t(active ? 'courses.retire_body' : 'courses.restore_body')}
      </p>

      {!confirming ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            setConfirming(true)
          }}
          className={active ? dangerButtonClass : secondaryButtonClass}
        >
          <BoIcon name={active ? 'close' : 'check'} size={16} />
          {t(active ? 'courses.retire' : 'courses.restore')}
        </button>
      ) : active ? (
        <RetireConfirmation
          kind="course"
          id={courseId}
          text={t('courses.confirm_retire')}
          pending={pending}
          onConfirm={() => void setOnCatalog('retire')}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <CatalogConfirmation
          text={t('courses.confirm_restore')}
          pending={pending}
          onConfirm={() => void setOnCatalog('restore')}
          onCancel={() => setConfirming(false)}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`catalog_errors.${error}`)}
        </p>
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Card>
  )
}
