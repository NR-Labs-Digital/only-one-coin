'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { downloadGradeRecord } from '@/lib/grade-records/client'
import type { GradeRecordFailure, GradeRecordScope } from '@/lib/grade-records/types'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The "Descargar acta" button of an official grade register (OOC-176). The
 * PDF is printed by the API on the click — the first download records the
 * acta — and a refusal is said under the button, never swallowed.
 */
export function GradeRecordDownload({ scope, registerId }: { scope: GradeRecordScope; registerId: string }) {
  const t = useTranslations('bo')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<GradeRecordFailure | null>(null)

  async function download() {
    setBusy(true)
    setFailure(null)
    const outcome = await downloadGradeRecord(scope, registerId)
    setBusy(false)
    if (!outcome.ok) setFailure(outcome.failure)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-wait disabled:opacity-60 sm:min-h-0"
      >
        <BoIcon name="download" size={14} />
        {busy ? t('grade_record.downloading') : t('grade_record.download')}
      </button>
      {failure && (
        <p role="alert" className="max-w-[16rem] text-xs text-red-700">
          {t(`grade_record.failure_${failure}`)}
        </p>
      )}
    </div>
  )
}
