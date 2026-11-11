import { getTranslations } from 'next-intl/server'
import type { ClassroomLink } from '@/lib/backoffice/class-links'
import { Icon } from '@/components/portal/icons'

/**
 * The student's quick links to class (OOC-144): one Google Classroom per
 * module the class group teaches, where the Meet lives. External links only —
 * nothing is embedded or integrated (CLAUDE.md §2) — and already re-checked
 * against the Google host by `lib/portal/overview.ts` before reaching here.
 *
 * One link is the class door, labelled as such; several (a full-course class
 * group) are one door per module, labelled by module. The API sends none for
 * a seat that is not confirmed (OOC-98), and the page shows its padlock or
 * "coming soon" instead of calling this.
 */
export async function ClassroomQuickLinks({ links }: { links: readonly ClassroomLink[] }) {
  const t = await getTranslations('portal')
  const several = links.length > 1

  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((link) => (
        <li key={link.module ?? 'legacy'}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-tap items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-card transition ${
              several
                ? 'border border-brand-blue/30 bg-white text-brand-blue-deep hover:border-brand-blue hover:bg-sky'
                : 'bg-brand-blue text-white hover:bg-brand-yellow hover:text-ink'
            }`}
          >
            <Icon name="video" size={18} />
            {several && link.module !== null
              ? t('course_detail.classroom_module', { module: link.module })
              : t('course_detail.join_class')}
          </a>
        </li>
      ))}
    </ul>
  )
}
