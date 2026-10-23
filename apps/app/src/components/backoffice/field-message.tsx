'use client'

import { useTranslations } from 'next-intl'
import type { FieldErrorCode } from '@ooc/domain/fields'

/** One field's problem, under it, in the panel's words. */
export function FieldMessage({ code }: { code: FieldErrorCode | undefined }) {
  const t = useTranslations('bo')
  if (!code) return null
  return (
    <span className="text-xs font-medium normal-case tracking-normal text-red-600">
      {t(`new_student.error.${code}`)}
    </span>
  )
}
