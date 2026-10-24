import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getOwnClassGroup, listOwnClassGroupStudents } from '@/lib/docente/teaching'
import { getTeacherSession } from '@/lib/backoffice/session'
import { getPlatformSettings } from '@/lib/backoffice/platform-settings'
import { getFeatureFlags } from '@/lib/feature-flags/server'
import { EmptyState } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassGroupWorkspace } from './class-group-workspace'

/**
 * One of the teacher's class groups, from `GET /teaching/class-groups/:id` and
 * its students. Somebody else's answers exactly like one that does not exist
 * — the API's usecase compares the session's teacher with the class group, so
 * guessing the id in the URL gets a 404 (anti-IDOR, CLAUDE.md §8). A closed
 * one is gone from the portal by URL too.
 */
export default async function TeacherClassGroupPage({
  params,
}: {
  params: Promise<{ locale: string; classGroupId: string }>
}) {
  const { locale, classGroupId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const [staff, group, flags] = await Promise.all([
    getTeacherSession(),
    getOwnClassGroup(classGroupId),
    getFeatureFlags('teacher'),
  ])
  if (group === 'not_found') notFound()

  /* The pass mark is the backoffice's (OOC-41), and only the grade sheet
     needs it — asked for only when that sheet is on the air. */
  const [students, settings] = await Promise.all([
    group ? listOwnClassGroupStudents(group.id) : Promise.resolve(null),
    flags['teacher.grades'] ? getPlatformSettings() : Promise.resolve(null),
  ])

  if (!group || !students) {
    return (
      <div className="flex flex-col gap-5">
        <Link
          href="/docente/class-groups"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          <BoIcon name="arrow-left" size={16} />
          {t('class_list.back')}
        </Link>
        <EmptyState
          icon="alert"
          title={t('teacher_home.load_error_title')}
          body={t('teacher_home.load_error_body')}
        />
      </div>
    )
  }

  return (
    <ClassGroupWorkspace
      key={group.id}
      group={group}
      students={students}
      teacherName={`${staff.firstName} ${staff.lastName}`}
      tools={{
        grades: flags['teacher.grades'],
        classLinks: flags['teacher.class_links'],
        notices: flags['teacher.notices'],
      }}
      passingGrade={settings?.passingGrade ?? null}
    />
  )
}
