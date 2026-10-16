import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getStudent, getStudentActivity } from '@/lib/backoffice/students'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseStudents,
  canEditStudent,
  canIssuePortalAccess,
  canViewPayments,
} from '@/lib/backoffice/permissions'
import { initials } from '@/lib/format'
import { Card, StatusBadge } from '@/components/backoffice/ui'
import { studentTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { StudentFile } from './student-file'
import { PortalAccessControl } from './portal-access-control'

/**
 * One student's file. The status shown here is derived from the enrollments
 * (see `StudentStatus`); changing it is a business action we have not defined
 * yet, so this screen reads it, never writes it.
 */
export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; studentId: string }>
}) {
  const { locale, studentId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  /* One wave of calls, not two: the file is fetched alongside the session.
     A cargo that may not browse is refused by the API too (403 → null), and
     its answer is never shown. */
  const [staff, student, activity] = await Promise.all([
    getStaffSession(),
    getStudent(studentId),
    getStudentActivity(studentId),
  ])
  if (!canBrowseStudents(staff.role)) notFound()
  if (!student) notFound()

  const fullName = `${student.firstName} ${student.lastName}`

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/students"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('student_file.back_to_list')}
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky text-base font-semibold text-brand-blue-deep">
              {initials(student.firstName, student.lastName)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
                {fullName}
              </h1>
              {/* Document and city are two lines below in "Datos personales";
                  repeating them here only competed with the one fact that
                  changes what staff may do next. */}
              {student.isMinor && (
                <p className="mt-0.5 text-xs font-semibold text-amber-700">
                  {t('students.minor')}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={studentTone[student.status]}
              label={t(`student_status.${student.status}`)}
            />
            <PortalAccessControl
              studentId={student.id}
              state={student.portalAccess}
              canIssue={canIssuePortalAccess(staff.role)}
            />
          </div>
        </div>
      </Card>

      <StudentFile
        student={student}
        canViewPayments={canViewPayments(staff.role)}
        canEdit={canEditStudent(staff.role)}
        activity={activity}
      />
    </div>
  )
}
