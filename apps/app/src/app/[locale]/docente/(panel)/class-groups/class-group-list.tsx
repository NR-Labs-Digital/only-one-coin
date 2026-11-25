import { getTranslations } from 'next-intl/server'
import { HelpHint } from '@/components/backoffice/help-hint'
import { Link } from '@/i18n/navigation'
import type { TeachingClassGroup } from '@/lib/docente/teaching'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { classGroupTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'

/** List order: what is being taught first, then what is closing, then what has not started. */
const statusOrder: Partial<Record<TeachingClassGroup['status'], number>> = {
  in_progress: 0,
  finished: 1,
  enrolling: 2,
}

/**
 * The teacher's class groups — what tells one apart from another: course,
 * week, code and status. Grouped by language once there is more than one, so
 * a teacher with three English groups and an Italian one reads two short
 * lists, not one long row. Each opens at its own address
 * (`/docente/class-groups/[id]`), the one the API checks as the teacher's.
 */
export async function ClassGroupList({ groups }: { groups: TeachingClassGroup[] }) {
  const t = await getTranslations('bo')

  const ordered = [...groups].sort(
    (a, b) =>
      (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
      (b.startsOn ?? '').localeCompare(a.startsOn ?? ''),
  )
  const languages = [
    ...new Map(ordered.map((group) => [group.language.id, group.language])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name))
  const byLanguage = languages.length > 1

  const columns = [
    t('class_list.col_class'),
    t('class_facts.schedule'),
    t('grade_report.col_status'),
    '',
  ]

  return (
    <div className="flex flex-col gap-5">
      {languages.map((language) => (
        <section key={language.id} className="flex flex-col gap-3">
          {byLanguage && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {language.name}
            </h2>
          )}
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <TableShell columns={columns}>
              <thead>
                <tr>
                  {columns.map((label, index) => (
                    <th key={label} className={thClass}>
                      {index === 2 ? (
                        <span className="inline-flex items-center gap-1.5">
                          {label}
                          <HelpHint
                            what={t('help.teach_class_status_what')}
                            how={t('help.teach_class_status_how')}
                          />
                        </span>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered
                  .filter((group) => group.language.id === language.id)
                  .map((group) => (
                    <tr key={group.id} className="transition hover:bg-sky-soft">
                      <td className={tdClass}>
                        <Link
                          href={`/docente/class-groups/${group.id}`}
                          className="flex flex-col text-left"
                        >
                          <span className="font-semibold text-ink">{group.courseName}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {/* A teacher may run two modules of one class group (OOC-156): the module tells them apart. */}
                            {group.module === null
                              ? group.code
                              : t('class_group_runs.code_with_module', { code: group.code, number: group.module })}
                          </span>
                        </Link>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                        {slotsLabel(group.slots, t)}
                      </td>
                      <td className={tdClass}>
                        <StatusBadge
                          tone={classGroupTone[group.status]}
                          label={t(`class_group_status.${group.status}`)}
                        />
                      </td>
                      <td className={`${tdClass} text-right`}>
                        <Link
                          href={`/docente/class-groups/${group.id}`}
                          aria-label={group.courseName}
                          tabIndex={-1}
                        >
                          <BoIcon
                            name="chevron-right"
                            size={16}
                            className="inline text-muted-foreground"
                          />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </TableShell>
          </div>
        </section>
      ))}
    </div>
  )
}
