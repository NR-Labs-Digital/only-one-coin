import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { listCatalogCourses } from '@/lib/backoffice/catalog'
import { getTeacher, toLanguage } from '@/lib/backoffice/teachers'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canEditTeachers,
  canManageTeachers,
} from '@/lib/backoffice/permissions'
import { BoIcon } from '@/components/backoffice/icons'
import { TeacherFile } from '@/components/backoffice/teachers/teacher-file'

/**
 * One teacher's file: contact, what they are cleared to teach, when they are
 * free, and the class groups already on them.
 *
 * Coordination's view. A teacher reads their own ficha in the docente portal
 * (`/docente/profile`), where the id comes from the session and never from
 * the URL — so this page has no teacher branch to guard (anti-IDOR,
 * CLAUDE.md §8).
 */
export default async function TeacherDetailPage({
  params,
}: {
  params: Promise<{ locale: string; teacherId: string }>
}) {
  const { locale, teacherId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canManageTeachers(staff.role)) notFound()

  const [teacher, courses] = await Promise.all([getTeacher(teacherId), listCatalogCourses()])
  if (!teacher) notFound()

  /* Clearing a teacher for a language means picking from the catalog — a new
     language is a course row, never a code branch (CLAUDE.md §1). */
  const catalogue = [...new Set((courses ?? []).map((course) => course.language.name))]
    .sort((a, b) => a.localeCompare(b))
    .map(toLanguage)

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/teachers"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('teacher_file.back_to_list')}
      </Link>

      {/* The identity header belongs to `TeacherFile`: the status is changed
          from it, and it is the client half that owns that state. */}

      <TeacherFile
        teacher={teacher}
        catalogue={catalogue}
        canEdit={canEditTeachers(staff.role)}
      />
    </div>
  )
}
