import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getTeacher } from '@/lib/backoffice/teachers'
import { getTeacherSession } from '@/lib/backoffice/session'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeacherFile } from '@/components/backoffice/teachers/teacher-file'

/**
 * The teacher's own ficha, read-only: contact, languages, availability and the
 * class groups on them. The id comes from the session, never from the URL —
 * there is no id in this address to guess (anti-IDOR, CLAUDE.md §8). Editing
 * the ficha is coordination's, in the backoffice.
 *
 * Read from `GET /teachers/:id`, which admits a teacher for the file linked to
 * their own account and nobody else's (OOC-79).
 */
export default async function TeacherProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const staff = await getTeacherSession()
  const teacher = staff.teacherId ? await getTeacher(staff.teacherId) : null

  /* An account with the teacher role but no ficha linked to it — opened before
     the invite named the file (OOC-79), or a read that failed. Saying so beats
     a 404 on the reader's own page. */
  if (!teacher) {
    const t = await getTranslations('bo')
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('nav.my_profile')} />
        <EmptyState
          icon="teachers"
          title={t('teacher_portal.no_file_title')}
          body={t('teacher_portal.no_file_body')}
        />
      </div>
    )
  }

  /* Read-only, so no catalog to pick languages from — the teacher does not
     read the catalog (`CATALOG_READ_ROLES`), and the file lists the languages
     they already hold on its own. */
  return (
    <div className="flex flex-col gap-5">
      <TeacherFile
        teacher={teacher}
        catalogue={[]}
        canEdit={false}
        classGroupBase="/docente/class-groups"
      />
    </div>
  )
}
