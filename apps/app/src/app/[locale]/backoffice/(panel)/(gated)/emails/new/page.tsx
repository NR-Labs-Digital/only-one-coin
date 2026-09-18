import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import {
  countEmailRecipients,
  listClassGroups,
  listCourses,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import type { EnrollmentStatus } from '@/lib/backoffice/types'
import { canManageEmail } from '@/lib/backoffice/permissions'
import { PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { NewEmailForm } from './new-email-form'

/**
 * A send written by hand — the notice that is nobody's automatic consequence:
 * a class group changing time, a period opening (`docs/ROADMAP.md` fase 5).
 *
 * Four steps, in the order the mistakes happen: who it reaches, what it says,
 * a proof to a real inbox, and only then the approval. The proof stops counting
 * the moment the text changes, so nobody approves a message that was edited
 * after being checked.
 *
 * The segment is a question, never a list: it is resolved against the register
 * at send time and never handed to the provider to keep.
 */
export default async function NewEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageEmail(staff.role)) notFound()

  /* Catalog data, so the picker offers what exists rather than free text —
     a segment typed by hand is a segment that matches nobody. Each option
     carries the count it resolves to, resolved here: the segment is a question
     for the database, and the browser is not the one holding the register. */
  const courses = [...new Set(listCourses().map((course) => course.name))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      count: countEmailRecipients({ kind: 'course', courseName: name }),
    }))

  const classGroups = listClassGroups().map((group) => ({
    id: group.id,
    label: `${group.courseName} · ${group.code}`,
    count: countEmailRecipients({ kind: 'class_group', classGroupId: group.id, classGroupName: group.code }),
  }))

  const statuses = (
    ['under_review', 'active', 'completed', 'rejected'] satisfies EnrollmentStatus[]
  ).map((status) => ({
    status,
    count: countEmailRecipients({ kind: 'enrollment_status', status }),
  }))

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/emails"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('new_email.back')}
      </Link>

      <PageHeader title={t('new_email.title')} />

      <NewEmailForm
        allCount={countEmailRecipients({ kind: 'all' })}
        courses={courses}
        classGroups={classGroups}
        statuses={statuses}
      />
    </div>
  )
}
