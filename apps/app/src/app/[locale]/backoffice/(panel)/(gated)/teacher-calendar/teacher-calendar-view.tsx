'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AgendaClassGroup } from '@/lib/agenda'
import { Toolbar } from '@/components/backoffice/ui'
import { ClassAgenda } from '@/components/agenda/class-agenda'

const ALL = '__all__'

const selectClass =
  'min-h-tap rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 sm:min-h-0'

/**
 * The calendar plus its teacher filter (OOC-99). The teachers offered are the
 * ones with a class group on the calendar — a roster name with nothing to
 * draw would only open an empty grid. Filtering is local: the page already
 * holds every class group the calendar can draw.
 */
export function TeacherCalendarView({
  groups,
  today,
  nowMinutes,
}: {
  groups: AgendaClassGroup[]
  today: string
  nowMinutes: number
}) {
  const t = useTranslations('bo')
  const [teacherId, setTeacherId] = useState(ALL)

  const teachers = useMemo(() => {
    const byId = new Map<string, string>()
    for (const group of groups) if (group.teacherId) byId.set(group.teacherId, group.teacherName)
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [groups])

  const shown = teacherId === ALL ? groups : groups.filter((group) => group.teacherId === teacherId)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('teacher_calendar.intro')}</p>
      <Toolbar>
        <label className="flex min-w-60 flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('teacher_calendar.filter_teacher')}
          </span>
          <select
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            className={selectClass}
          >
            <option value={ALL}>{t('teacher_calendar.filter_all')}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
      </Toolbar>
      <ClassAgenda
        groups={shown}
        today={today}
        nowMinutes={nowMinutes}
        classLinks
        classGroupBasePath="/backoffice/class-groups"
        // With one teacher picked every class is theirs: naming them on each block is noise.
        showTeacher={teacherId === ALL}
        emptyText={t('teacher_calendar.empty')}
      />
    </div>
  )
}
