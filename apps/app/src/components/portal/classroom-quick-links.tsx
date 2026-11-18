import { getTranslations } from 'next-intl/server'
import type { ClassroomLink } from '@/lib/backoffice/class-links'
import { Icon } from '@/components/portal/icons'

const PRIMARY = 'bg-brand-blue text-white hover:bg-brand-yellow hover:text-ink'
const SECONDARY = 'border border-brand-blue/30 bg-white text-brand-blue-deep hover:border-brand-blue hover:bg-sky'

/**
 * The student's quick links to class (OOC-144): one Google Classroom per
 * module the class group teaches, and the module group's Google Meet when
 * coordination pasted one (OOC-159). External links only — nothing is
 * embedded or integrated (CLAUDE.md §2) — and already re-checked against the
 * Google host by `lib/portal/overview.ts` before reaching here.
 *
 * With a Meet, the Meet is the call, so it leads and each Classroom is named
 * as such. Without one, a single Classroom is the class door, labelled as
 * such; several (a full-course class group) are one door per module. The API
 * sends nothing for a seat that is not confirmed (OOC-98), and the page shows
 * its padlock or "coming soon" instead of calling this.
 */
export async function ClassroomQuickLinks({
  links,
  meetUrl,
}: {
  links: readonly ClassroomLink[]
  meetUrl: string | null
}) {
  const t = await getTranslations('portal')
  const several = links.length > 1
  const classroomLabel = (link: ClassroomLink) =>
    several && link.module !== null
      ? t('course_detail.classroom_module', { module: link.module })
      : meetUrl
        ? t('course_detail.classroom')
        : t('course_detail.join_class')

  return (
    <ul className="flex flex-wrap gap-2">
      {meetUrl && (
        <li>
          <QuickLink href={meetUrl} tone={PRIMARY} label={t('course_detail.join_meet')} />
        </li>
      )}
      {links.map((link) => (
        <li key={link.module ?? 'legacy'}>
          <QuickLink
            href={link.url}
            tone={several || meetUrl ? SECONDARY : PRIMARY}
            label={classroomLabel(link)}
          />
        </li>
      ))}
    </ul>
  )
}

function QuickLink({ href, tone, label }: { href: string; tone: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-tap items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-card transition ${tone}`}
    >
      <Icon name="video" size={18} />
      {label}
    </a>
  )
}
