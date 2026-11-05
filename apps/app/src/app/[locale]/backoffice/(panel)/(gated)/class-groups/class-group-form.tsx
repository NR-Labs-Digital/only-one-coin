'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type {
  AcademicPeriodItem,
  CatalogErrorKey,
  ClassGroupItem,
  ClassGroupStatus,
  CourseRow,
  TeacherOption,
  Weekday,
} from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { classroomUrlOf } from '@/lib/backoffice/class-links'
import { allocationWarnings, teachersForLanguage } from '@/lib/backoffice/teacher-allocation'
import {
  isoToLimaDate,
  isoToLimaDateTime,
  limaDateTimeToIso,
  limaDateToIso,
} from '@/lib/backoffice/lima-date'
import { formatDateRange, formatDateTime, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpField } from '@/components/backoffice/help-hint'
import { Stepper } from '@/components/backoffice/stepper'
import { AutoGrid, fullRowClass } from '@/components/layout/auto-grid'

/** The period select's last option: name and dates typed right here, created on save. */
const NEW_PERIOD = 'new'

/** The module select's option for a class group that teaches every module (OOC-130). */
const FULL_COURSE = 'full'

/** How many class groups open at once — a limit on a typo, not a business rule (OOC-132). */
const MAX_CLASS_GROUPS = 20

type CapacityMode = 'same' | 'each'
const CAPACITY_MODES: CapacityMode[] = ['same', 'each']

/** A new class group, one step at a time (OOC-129); the edit stays on one card. */
const CREATE_STEPS = ['course', 'schedule', 'dates', 'teacher', 'review'] as const
type CreateStep = (typeof CREATE_STEPS)[number]

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Quarter-hour steps from 06:00 to 23:45 cover the real timetable. */
const HOURS = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15 disabled:bg-slate-50 disabled:text-muted-foreground'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/** What the caller learns from a save — enough to show it and say what happened. */
export interface ClassGroupFormOutcome {
  status: ClassGroupStatus
  academicPeriodId: string
  courseId: string
  /** How many class groups this save opened; 1 on an edit. */
  count: number
}

/** The inputs as the form holds them — strings, exactly as the fields show them. */
interface FormInputs {
  weekdays: Weekday[]
  startTime: string
  endTime: string
  startsOn: string
  endsOn: string
  opensAt: string
  closesAt: string
}

function inputsOf(initial: ClassGroupItem | undefined): FormInputs {
  return {
    weekdays: WEEKDAYS.filter((day) => initial?.slots.some((slot) => slot.weekday === day)),
    startTime: initial?.slots[0]?.startTime ?? '18:00',
    endTime: initial?.slots[0]?.endTime ?? '19:30',
    startsOn: initial?.startsOn ? isoToLimaDate(initial.startsOn) : '',
    endsOn: initial?.endsOn ? isoToLimaDate(initial.endsOn) : '',
    opensAt: initial?.enrollmentOpensAt ? isoToLimaDateTime(initial.enrollmentOpensAt) : '',
    closesAt: initial?.enrollmentClosesAt ? isoToLimaDateTime(initial.enrollmentClosesAt) : '',
  }
}

/** Empty input → null; never hands an empty string to the Lima helpers. */
const dateOrNull = (value: string) => (value ? limaDateToIso(value) : null)
const dateTimeOrNull = (value: string) => (value ? limaDateTimeToIso(value) : null)

/**
 * Opens a class group (`mode="create"`) or edits one (`mode="edit"`).
 *
 * Opening one is a guided path (OOC-129): course, schedule, dates, teacher,
 * then a review that saves a draft or opens enrollment. Editing touches a
 * field or two at a time, so it keeps every field on one card.
 *
 * The schedule is edited as "these days, at this time": one start and one end
 * applied to every chosen day, which is how the Asociación sells a class group.
 * A class group whose days run at different hours shows the first slot's hours,
 * and is rewritten with the chosen hours only if days or hours are touched —
 * an edit to the capacity alone never flattens its timetable.
 *
 * Dates are calendar days in Lima (midnight `-05:00`) and the enrollment window
 * is a Lima date-time; an emptied field is sent as `null`, which the API reads
 * as "clear it". The edit sends only what changed against what was loaded.
 *
 * The module is one of the course's (OOC-100): it picks the material the
 * teacher opens. Optional, like the Classroom — a class group without it only
 * goes without the material button. Changing the course drops a module the
 * new course does not have. "Full course" (OOC-130) is the select's other
 * answer: every module, not one of them.
 *
 * A new class group can be several at once (OOC-132): same course, schedule and
 * dates, with one number of seats for all or one for each. Each is one POST,
 * like opening them by hand, so a failure halfway keeps what was created and a
 * retry creates only what is missing. Teacher and Classroom belong to one class
 * group, so they are not asked for then — the same person cannot teach two
 * groups at the same hour.
 *
 * The teacher comes from the roster (OOC-80): only active teachers who teach
 * the course's language are offered, and the API repeats that check. A
 * schedule outside the teacher's declared week, or on top of another of their
 * class groups in the same period, is warned about — never refused.
 *
 * A new class group for a period that does not exist yet does not send anyone
 * back to the period bar: "+ new period" in the period select takes its name
 * and dates here, and saving creates the period first, then the class group.
 * Two writes, like the period bar's copy — if the class group fails after the
 * period exists, the period is reloaded and selected, so a retry never creates
 * it twice.
 *
 * Every write goes through `apps/api` — the browser never decides (CLAUDE.md §8).
 */
export function ClassGroupForm({
  mode,
  courses,
  periods,
  teachers,
  initial,
  defaultPeriodId,
  onDone,
  onCancel,
}: {
  mode: 'create' | 'edit'
  courses: CourseRow[]
  periods: AcademicPeriodItem[]
  /** The roster for the picker; null when it could not be read. */
  teachers: TeacherOption[] | null
  initial?: ClassGroupItem
  /** The period on screen — what a new class group belongs to unless changed. */
  defaultPeriodId?: string | null
  onDone: (id: string, outcome: ClassGroupFormOutcome) => void
  onCancel: () => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()

  /** Off-catalog courses are not offered — except the one an edited group already runs. */
  const catalog = courses.filter((course) => course.active || course.id === initial?.courseId)
  const [loaded] = useState(() => inputsOf(initial))

  const [courseId, setCourseId] = useState(initial?.courseId ?? catalog[0]?.id ?? '')
  const [periodId, setPeriodId] = useState(
    initial?.academicPeriodId ??
      (periods.some((period) => period.id === defaultPeriodId) ? defaultPeriodId : null) ??
      periods[0]?.id ??
      NEW_PERIOD,
  )
  const [newPeriodName, setNewPeriodName] = useState('')
  const [newPeriodStartsOn, setNewPeriodStartsOn] = useState('')
  const [newPeriodEndsOn, setNewPeriodEndsOn] = useState('')
  const newPeriod = mode === 'create' && periodId === NEW_PERIOD
  /** '' = nobody allocated yet. */
  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? '')
  /** '' = no module set yet; FULL_COURSE = every module. */
  const [moduleText, setModuleText] = useState(
    initial?.fullCourse ? FULL_COURSE : initial?.module ? String(initial.module) : '',
  )
  const fullCourse = moduleText === FULL_COURSE
  const moduleNumber = moduleText === '' || fullCourse ? null : Number(moduleText)
  /** Pasted with the teacher, never required to allocate one (OOC-98). */
  const [classroomDraft, setClassroomDraft] = useState(initial?.classroomUrl ?? '')
  const classroomUrl = classroomUrlOf(classroomDraft)
  const classroomInvalid = classroomUrl === 'invalid'
  const [weekdays, setWeekdays] = useState<Weekday[]>(loaded.weekdays)
  const [startTime, setStartTime] = useState(loaded.startTime)
  const [endTime, setEndTime] = useState(loaded.endTime)
  const [startsOn, setStartsOn] = useState(loaded.startsOn)
  const [endsOn, setEndsOn] = useState(loaded.endsOn)
  const [opensAt, setOpensAt] = useState(loaded.opensAt)
  const [closesAt, setClosesAt] = useState(loaded.closesAt)
  const [capacityText, setCapacityText] = useState(String(initial?.capacity ?? 30))
  const [groupCountText, setGroupCountText] = useState('1')
  const [capacityMode, setCapacityMode] = useState<CapacityMode>('same')
  /** The per-group seats as typed; a group nobody typed for starts at the shared number. */
  const [eachCapacity, setEachCapacity] = useState<string[]>([])
  /** How many of this batch already exist: a retry never creates them twice. */
  const [createdCount, setCreatedCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [step, setStep] = useState<CreateStep>('course')
  /** Somebody tried to leave this step: from then on it says what it still lacks. */
  const [stepAttempted, setStepAttempted] = useState(false)

  /** The course of a running or already-sold class group is fixed (API: `class_group_course_locked`). */
  const courseLocked =
    mode === 'edit' && initial !== undefined && (initial.status !== 'draft' || initial.seatsTaken > 0)

  const capacity = Number(capacityText)
  const minCapacity = Math.max(1, initial?.seatsTaken ?? 0)
  const groupCount = Number(groupCountText)
  const groupCountValid =
    Number.isInteger(groupCount) && groupCount >= 1 && groupCount <= MAX_CLASS_GROUPS
  const severalGroups = mode === 'create' && groupCountValid && groupCount > 1
  const eachMode = severalGroups && capacityMode === 'each'
  const eachTexts = Array.from(
    { length: groupCountValid ? groupCount : 1 },
    (_, index) => eachCapacity[index] ?? capacityText,
  )
  /** The seats of each class group this save opens. */
  const capacities = eachMode ? eachTexts.map(Number) : eachTexts.map(() => capacity)
  const capacityValid =
    groupCountValid && capacities.every((seats) => Number.isInteger(seats) && seats >= minCapacity)
  const timeInvalid = startTime >= endTime
  const slots = WEEKDAYS.filter((day) => weekdays.includes(day)).map((weekday) => ({
    weekday,
    startTime,
    endTime,
  }))

  const scheduleTouched =
    startTime !== loaded.startTime ||
    endTime !== loaded.endTime ||
    weekdays.length !== loaded.weekdays.length ||
    weekdays.some((day) => !loaded.weekdays.includes(day))

  /* A legacy class group (seeded: no slots) can be edited without retyping what
     it never had — the days are required on create, and on edit only if the
     group already had them or the schedule is being rewritten. Whatever is not
     touched is not sent (`changes()`). The code is not here at all: the API
     draws it from a sequence and nobody edits it. */
  const weekdaysRequired =
    mode === 'create' || scheduleTouched || (initial?.slots.length ?? 0) > 0

  const ready =
    courseId !== '' &&
    (mode === 'edit' ||
      (newPeriod
        ? newPeriodName.trim() !== '' && newPeriodStartsOn !== '' && newPeriodEndsOn !== ''
        : periodId !== '')) &&
    (!weekdaysRequired || weekdays.length > 0) &&
    !timeInvalid &&
    !classroomInvalid &&
    capacityValid
  const hasDates = startsOn !== '' && endsOn !== ''

  function toggleDay(day: Weekday) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    )
  }

  /** Only what moved against what was loaded — the API refuses an empty patch. */
  function changes(): Record<string, unknown> {
    if (!initial) return {}
    const patch: Record<string, unknown> = {}
    if (courseId !== initial.courseId) patch.courseId = courseId
    if (teacherId !== (initial.teacherId ?? '')) patch.teacherId = teacherId || null
    if (fullCourse !== initial.fullCourse) patch.fullCourse = fullCourse
    if (moduleNumber !== initial.module) patch.module = moduleNumber
    if (!classroomInvalid && classroomUrl !== (initial.classroomUrl ?? null)) patch.classroomUrl = classroomUrl
    if (scheduleTouched) patch.slots = slots
    if (capacity !== initial.capacity) patch.capacity = capacity
    if (startsOn !== loaded.startsOn) patch.startsOn = dateOrNull(startsOn)
    if (endsOn !== loaded.endsOn) patch.endsOn = dateOrNull(endsOn)
    if (opensAt !== loaded.opensAt) patch.enrollmentOpensAt = dateTimeOrNull(opensAt)
    if (closesAt !== loaded.closesAt) patch.enrollmentClosesAt = dateTimeOrNull(closesAt)
    return patch
  }

  const patch = mode === 'edit' ? changes() : {}
  const dirty = Object.keys(patch).length > 0

  async function create(publish: boolean) {
    if (!ready || (publish && !hasDates)) return
    setSaving(true)
    setError(null)
    let academicPeriodId = periodId
    if (newPeriod) {
      const period = await catalogWrite('/periods', 'POST', {
        name: newPeriodName.trim(),
        startsOn: limaDateToIso(newPeriodStartsOn),
        endsOn: limaDateToIso(newPeriodEndsOn),
      })
      if (!period.ok) {
        setSaving(false)
        setError(period.error)
        return
      }
      academicPeriodId = period.data.id
    }
    let created: { id: string; status: ClassGroupStatus } | null = null
    for (let index = createdCount; index < capacities.length; index += 1) {
      const result = await catalogWrite<{ id: string; status: ClassGroupStatus }>(
        '/class-groups',
        'POST',
        {
          courseId,
          academicPeriodId,
          teacherId: severalGroups ? null : teacherId || null,
          module: moduleNumber,
          fullCourse,
          classroomUrl: severalGroups || classroomInvalid ? null : classroomUrl,
          slots,
          capacity: capacities[index],
          startsOn: dateOrNull(startsOn),
          endsOn: dateOrNull(endsOn),
          enrollmentOpensAt: dateTimeOrNull(opensAt),
          enrollmentClosesAt: dateTimeOrNull(closesAt),
          publish,
        },
      )
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        setCreatedCount(index)
        if (academicPeriodId !== periodId || index > 0) {
          // What exists now must show up: the new period, the groups already opened.
          setPeriodId(academicPeriodId)
          router.refresh()
        }
        return
      }
      created = result.data
    }
    setSaving(false)
    if (created) {
      onDone(created.id, {
        status: created.status,
        academicPeriodId,
        courseId,
        count: capacities.length,
      })
    }
  }

  async function save() {
    if (!initial || !ready || !dirty) return
    setSaving(true)
    setError(null)
    const result = await catalogWrite(
      `/class-groups/${encodeURIComponent(initial.id)}`,
      'PATCH',
      patch,
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDone(initial.id, {
      status: initial.status,
      academicPeriodId: initial.academicPeriodId,
      courseId,
      count: 1,
    })
  }

  /** Two selects instead of `type="time"`: the native picker hands back minutes nobody teaches at. */
  function timeSelect(value: string, onChange: (next: string) => void, label: string) {
    const hour = value.slice(0, 2)
    const minute = value.slice(3, 5)
    // A loaded time off the quarter-hour grid stays selectable instead of
    // silently snapping to the first option.
    const hours = HOURS.includes(hour) ? HOURS : [...HOURS, hour].sort()
    const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort()
    return (
      <span className="flex items-center gap-1.5">
        <select
          value={hour}
          onChange={(event) => onChange(`${event.target.value}:${minute}`)}
          aria-label={`${label} · ${t('class_groups.field_time_hour')}`}
          className={`${fieldClass} flex-1 tabular-nums`}
        >
          {hours.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="text-sm font-semibold text-muted-foreground">:</span>
        <select
          value={minute}
          onChange={(event) => onChange(`${hour}:${event.target.value}`)}
          aria-label={`${label} · ${t('class_groups.field_time_minute')}`}
          className={`${fieldClass} flex-1 tabular-nums`}
        >
          {minutes.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </span>
    )
  }

  const courseLanguage = catalog.find((item) => item.id === courseId)?.language.name ?? ''
  const offered = teachers ? teachersForLanguage(teachers, courseLanguage) : []
  /** The one already on the class group stays visible even if they left the roster or the language. */
  const currentOffRoster =
    initial?.teacherId && !offered.some((teacher) => teacher.id === initial.teacherId)
      ? initial
      : null
  const chosen = offered.find((teacher) => teacher.id === teacherId)
  const warnings = chosen
    ? allocationWarnings(chosen, slots, {
        academicPeriodId: initial?.academicPeriodId ?? periodId,
        classGroupId: initial?.id,
      })
    : null

  const courseModules = catalog.find((item) => item.id === courseId)?.modules ?? 0
  /** One option per module of the course — plus a stored one past it, so an edit never hides what is there. */
  const moduleOptions = Array.from({ length: courseModules }, (_, index) => index + 1)
  if (moduleNumber !== null && moduleNumber > courseModules) moduleOptions.push(moduleNumber)

  function changeCourse(next: string) {
    setCourseId(next)
    // A module the new course does not have is not carried over.
    const modules = catalog.find((item) => item.id === next)?.modules ?? 0
    if (moduleNumber !== null && moduleNumber > modules) setModuleText('')
    // A teacher who does not teach the new course's language is not carried over.
    const language = catalog.find((item) => item.id === next)?.language.name ?? ''
    if (teachers && teacherId && !teachersForLanguage(teachers, language).some((item) => item.id === teacherId)) {
      setTeacherId('')
    }
  }

  const languages = [...new Map(catalog.map((item) => [item.language.id, item.language])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  )

  /* The fields, built once and laid out twice: all on one card to edit, one
     step at a time to create (OOC-129). */
  const courseField = (
    <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
      <span className={labelClass}>{t('class_groups.field_course')}</span>
      {/* Grouped by language: the course already carries it, so the
          language is a heading here, not a second field to fill in. */}
      <select
        value={courseId}
        onChange={(event) => changeCourse(event.target.value)}
        disabled={courseLocked}
        className={fieldClass}
      >
        {languages.map((language) => (
          <optgroup key={language.id} label={language.name}>
            {catalog
              .filter((item) => item.language.id === language.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  )

  const moduleField = (
    <HelpField
      label={t('class_groups.field_module')}
      what={t('help.module_what')}
      how={t('help.module_how')}
    >
      {(id) => (
        <select
          id={id}
          value={moduleText}
          onChange={(event) => setModuleText(event.target.value)}
          className={`${fieldClass} tabular-nums`}
        >
          <option value="">{t('class_groups.module_none')}</option>
          {moduleOptions.map((number) => (
            <option key={number} value={String(number)}>
              {t('class_groups.module_option', { number })}
            </option>
          ))}
          <option value={FULL_COURSE}>{t('class_groups.module_full_course_option')}</option>
        </select>
      )}
    </HelpField>
  )

  const pickedPeriod = periods.find((item) => item.id === periodId)

  const periodFields = mode === 'create' && (
    <>
      {/* Full width: name plus date range never fit half a row, and a native
          select cuts its text with no way to read the rest. On a phone even
          the full row can cut it, so the dates repeat underneath. */}
      <HelpField
        label={t('class_groups.field_period')}
        what={t('periods.hint')}
        how={t('help.period_form_how')}
        className={fullRowClass}
      >
        {(id) => (
          <>
            <select
              id={id}
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
              className={fieldClass}
            >
              {periods.map((item) => (
                <option key={item.id} value={item.id}>
                  {`${item.name} · ${formatDateRange(item.startsOn, item.endsOn, locale)}`}
                </option>
              ))}
              <option value={NEW_PERIOD}>{t('class_groups.period_new_option')}</option>
            </select>
            {!newPeriod && pickedPeriod && (
              <span className="text-xs text-muted-foreground">
                {formatDateRange(pickedPeriod.startsOn, pickedPeriod.endsOn, locale)}
              </span>
            )}
          </>
        )}
      </HelpField>

      {newPeriod && (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t('class_groups.new_period_name')}</span>
            <input
              value={newPeriodName}
              onChange={(event) => setNewPeriodName(event.target.value)}
              placeholder={t('periods.name_placeholder')}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t('class_groups.new_period_starts')}</span>
            <input
              type="date"
              value={newPeriodStartsOn}
              onChange={(event) => setNewPeriodStartsOn(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t('class_groups.new_period_ends')}</span>
            <input
              type="date"
              value={newPeriodEndsOn}
              onChange={(event) => setNewPeriodEndsOn(event.target.value)}
              className={fieldClass}
            />
          </label>
        </>
      )}
    </>
  )

  const teacherField = (
    <HelpField
      label={t('class_groups.field_teacher')}
      what={t('help.teacher_what')}
      how={t('help.teacher_how')}
    >
      {(id) => (
        <>
          <select
            id={id}
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            disabled={teachers === null}
            className={fieldClass}
          >
            <option value="">{t('class_groups.teacher_none')}</option>
            {currentOffRoster && (
              <option value={currentOffRoster.teacherId ?? ''}>
                {t('class_groups.teacher_off_roster', { name: currentOffRoster.teacherName })}
              </option>
            )}
            {offered.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {`${teacher.firstName} ${teacher.lastName}`}
              </option>
            ))}
          </select>
          {teachers === null ? (
            <span className="text-xs text-red-700">{t('class_groups.teacher_load_error')}</span>
          ) : offered.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('class_groups.teacher_none_for_language', { language: courseLanguage })}
            </span>
          ) : null}
          {!teacherId && initial?.legacyTeacherName && (
            <span className="text-xs text-muted-foreground">
              {t('class_groups.teacher_legacy_hint', { name: initial.legacyTeacherName })}
            </span>
          )}
        </>
      )}
    </HelpField>
  )

  /* Right under the teacher: allocating and handing over the class's
     Classroom are one step for coordination (OOC-98) — optional, so a
     teacher can still be allocated before the Classroom exists. */
  const classroomField = (
    <HelpField
      label={t('class_groups.field_classroom')}
      what={t('help.classroom_what')}
      how={t('help.classroom_how')}
    >
      {(id) => (
        <>
          <input
            id={id}
            type="url"
            inputMode="url"
            value={classroomDraft}
            onChange={(event) => setClassroomDraft(event.target.value)}
            placeholder={t('class_groups.classroom_placeholder')}
            aria-invalid={classroomInvalid}
            className={fieldClass}
          />
          {classroomInvalid && (
            <span className="text-xs text-red-700">{t('class_groups.classroom_invalid')}</span>
          )}
        </>
      )}
    </HelpField>
  )

  const capacityField = (
    <HelpField
      label={t('class_groups.field_capacity_per_group')}
      what={t('help.capacity_what')}
      how={t(mode === 'create' ? 'help.capacity_how_create' : 'help.capacity_how_edit')}
    >
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={minCapacity}
          step={1}
          value={capacityText}
          onChange={(event) => setCapacityText(event.target.value)}
          className={fieldClass}
        />
      )}
    </HelpField>
  )

  const groupCountField = (
    <HelpField
      label={t('class_groups.field_group_count')}
      what={t('help.group_count_what')}
      how={t('help.group_count_how')}
    >
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_CLASS_GROUPS}
          step={1}
          disabled={createdCount > 0}
          value={groupCountText}
          onChange={(event) => setGroupCountText(event.target.value)}
          className={fieldClass}
        />
      )}
    </HelpField>
  )

  const totalSeats = capacities.reduce((sum, seats) => sum + (Number.isFinite(seats) ? seats : 0), 0)

  const capacitySection = (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <AutoGrid min="12rem" gap="gap-3">
        {groupCountField}
        {!eachMode && capacityField}
      </AutoGrid>

      {severalGroups && (
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className={`mb-1.5 ${labelClass}`}>{t('class_groups.capacity_mode')}</legend>
          {CAPACITY_MODES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCapacityMode(item)}
              aria-pressed={capacityMode === item}
              className={`min-h-tap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                capacityMode === item
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:text-ink'
              }`}
            >
              {t(`class_groups.capacity_mode_${item}`)}
            </button>
          ))}
        </fieldset>
      )}

      {eachMode && (
        <AutoGrid min="8rem" gap="gap-3">
          {eachTexts.map((text, index) => (
            <label key={index} className="flex flex-col gap-1">
              <span className={labelClass}>{t('class_groups.capacity_of_group', { n: index + 1 })}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={text}
                onChange={(event) => {
                  const next = [...eachTexts]
                  next[index] = event.target.value
                  setEachCapacity(next)
                }}
                className={fieldClass}
              />
            </label>
          ))}
        </AutoGrid>
      )}

      {capacityValid && (
        <p className="text-xs font-medium text-ink">
          {t('class_groups.capacity_total', { groups: capacities.length, seats: totalSeats })}
        </p>
      )}
    </div>
  )

  const timeFields = (
    <>
      <div className="flex flex-col gap-1">
        <span className={labelClass}>{t('class_groups.field_time')}</span>
        {timeSelect(startTime, setStartTime, t('class_groups.field_time'))}
      </div>

      <div className="flex flex-col gap-1">
        <span className={labelClass}>{t('class_groups.field_end_time')}</span>
        {timeSelect(endTime, setEndTime, t('class_groups.field_end_time'))}
      </div>
    </>
  )

  const dateFields = (
    <>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('class_groups.field_start')}</span>
        <input
          type="date"
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('class_groups.field_end')}</span>
        <input
          type="date"
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
          className={fieldClass}
        />
      </label>
    </>
  )

  const windowFields = (
    <>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('class_groups.field_window_opens')}</span>
        <input
          type="datetime-local"
          value={opensAt}
          onChange={(event) => setOpensAt(event.target.value)}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('class_groups.field_window_closes')}</span>
        <input
          type="datetime-local"
          value={closesAt}
          onChange={(event) => setClosesAt(event.target.value)}
          className={fieldClass}
        />
      </label>
    </>
  )

  const daysField = (
    <fieldset>
      <legend className={`mb-1.5 ${labelClass}`}>{t('class_groups.field_days')}</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((day) => {
          const on = weekdays.includes(day)
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={on}
              className={`min-h-tap min-w-tap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                on
                  ? 'bg-brand-blue text-white'
                  : 'border border-line bg-white text-muted-foreground hover:text-ink'
              }`}
            >
              {t(`weekday.${day}`)}
            </button>
          )
        })}
      </div>
    </fieldset>
  )

  const teacherWarnings = (
    <>
      {warnings?.outsideAvailability && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-700">
          <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          {t('class_groups.teacher_outside_availability')}
        </p>
      )}
      {warnings && warnings.clashes.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-700">
          <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          {t('class_groups.teacher_schedule_clash', { codes: warnings.clashes.join(', ') })}
        </p>
      )}
    </>
  )

  const timeError = timeInvalid && (
    <p className="mt-3 text-xs text-red-700">{t('class_groups.invalid_time_range')}</p>
  )

  const missingDatesNote = !hasDates && (
    <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
      <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
      {t('class_groups.missing_to_publish')}
    </p>
  )

  const cancelButton = (
    <button type="button" onClick={onCancel} className={secondaryButtonClass}>
      {t('class_groups.cancel')}
    </button>
  )

  const errorLine = error && (
    <p role="alert" className="mt-3 text-sm text-red-700">
      {t(`catalog_errors.${error}`)}
    </p>
  )

  if (mode === 'edit') {
    return (
      <Card className="p-5">
        <p className="mb-4 text-sm font-semibold text-ink">{t('class_groups.edit_title')}</p>

        <AutoGrid min="15rem" gap="gap-3">
          {courseField}
          {moduleField}
          {teacherField}
          {classroomField}
          {capacityField}
          {timeFields}
          {dateFields}
          {windowFields}
        </AutoGrid>

        <p className="mt-2 text-xs text-muted-foreground">{t('class_groups.window_hint')}</p>

        <div className="mt-3">{daysField}</div>

        {teacherWarnings}
        {timeError}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!ready || !dirty || saving}
            onClick={() => void save()}
            className={primaryButtonClass}
          >
            <BoIcon name="check" size={16} />
            {t('class_groups.save_changes')}
          </button>
          {cancelButton}
        </div>

        {errorLine}
      </Card>
    )
  }

  /* Create, one step at a time. Each step is left only with what it needs;
     everything optional (module, dates, window, teacher, Classroom) stays
     optional — without dates the last step only saves a draft. */
  /* Several class groups at once have nothing to fill on the teacher step:
     teacher and Classroom belong to one group each (OOC-132), so the step leaves
     the flow instead of showing an empty page (OOC-137). The group count only
     changes on the schedule step, so `step` is never 'teacher' here. */
  const steps: readonly CreateStep[] = severalGroups
    ? CREATE_STEPS.filter((item) => item !== 'teacher')
    : CREATE_STEPS
  const current = steps.indexOf(step)

  function missingHere(): string | null {
    if (step === 'course') {
      if (courseId === '') return t('class_groups.step_error_course')
      const periodReady = newPeriod
        ? newPeriodName.trim() !== '' && newPeriodStartsOn !== '' && newPeriodEndsOn !== ''
        : periodId !== ''
      return periodReady ? null : t('class_groups.step_error_period')
    }
    if (step === 'schedule') {
      if (weekdays.length === 0) return t('class_groups.step_error_days')
      if (timeInvalid) return t('class_groups.invalid_time_range')
      if (!groupCountValid) return t('class_groups.step_error_group_count', { max: MAX_CLASS_GROUPS })
      return capacityValid ? null : t('class_groups.step_error_capacity')
    }
    if (step === 'dates') {
      // Same order the API checks; said here instead of failing on the last click.
      if (startsOn && endsOn && startsOn >= endsOn) return t('class_groups.step_error_dates')
      if (opensAt && closesAt && opensAt >= closesAt) return t('class_groups.step_error_window')
      return null
    }
    if (step === 'teacher') {
      return classroomInvalid ? t('class_groups.classroom_invalid') : null
    }
    return null
  }

  // Read live, so the message and the red step go away the moment it is fixed.
  const stepError = stepAttempted ? missingHere() : null

  function go(next: CreateStep) {
    setStepAttempted(false)
    setStep(next)
  }

  function advance() {
    if (missingHere()) {
      setStepAttempted(true)
      return
    }
    go(steps[current + 1])
  }

  const course = catalog.find((item) => item.id === courseId)
  const noLimit = t('class_groups.review_no_limit')
  const review: [string, string][] = [
    [t('class_groups.field_course'), course ? `${course.name} · ${course.language.name}` : ''],
    [
      t('class_groups.field_module'),
      fullCourse
        ? t('class_groups.module_full_course_option')
        : moduleNumber === null
          ? t('class_groups.module_none')
          : t('class_groups.module_option', { number: moduleNumber }),
    ],
    [
      t('class_groups.field_period'),
      newPeriod
        ? `${newPeriodName.trim()} · ${formatDateRange(limaDateToIso(newPeriodStartsOn), limaDateToIso(newPeriodEndsOn), locale)}`
        : (pickedPeriod?.name ?? ''),
    ],
    [
      t('class_groups.col_schedule'),
      `${slots.map((slot) => t(`weekday.${slot.weekday}`)).join(', ')} · ${t('class_groups.time_range', { start: startTime, end: endTime })}`,
    ],
    ...(severalGroups
      ? ([[t('class_groups.field_group_count'), String(groupCount)]] as [string, string][])
      : []),
    [t('class_groups.field_capacity_per_group'), capacities.join(' · ')],
    [
      t('class_groups.review_dates'),
      hasDates
        ? formatDateRange(limaDateToIso(startsOn), limaDateToIso(endsOn), locale)
        : t('class_groups.no_dates'),
    ],
    [
      t('class_groups.review_window'),
      t('class_groups.review_window_value', {
        opens: opensAt ? formatDateTime(limaDateTimeToIso(opensAt), locale) : noLimit,
        closes: closesAt ? formatDateTime(limaDateTimeToIso(closesAt), locale) : noLimit,
      }),
    ],
    [
      t('class_groups.field_teacher'),
      severalGroups
        ? t('class_groups.review_assigned_later')
        : chosen
          ? `${chosen.firstName} ${chosen.lastName}`
          : t('class_groups.teacher_none'),
    ],
    [
      t('class_groups.field_classroom'),
      severalGroups
        ? t('class_groups.review_assigned_later')
        : classroomUrl && classroomUrl !== 'invalid'
          ? classroomUrl
          : t('class_groups.classroom_missing'),
    ],
  ]

  return (
    <Card className="p-5">
      <p className="mb-4 text-sm font-semibold text-ink">{t('class_groups.new_title')}</p>

      <Stepper
        steps={[...steps]}
        current={current}
        labelOf={(key) => t(`class_groups.step_${key as CreateStep}`)}
        onPick={(key) => go(key as CreateStep)}
        invalid={stepError !== null}
        optional={['teacher']}
        optionalLabel={t('class_groups.step_optional')}
      />

      <div className="mt-5 rounded-lg bg-sky-soft px-3 py-2.5">
        <p className="text-sm font-semibold text-ink">
          {t('class_groups.step_of', { step: current + 1, total: steps.length })}
          {' · '}
          {t(`class_groups.step_${step}`)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(`class_groups.step_intro_${step}`)}</p>
      </div>

      <div className="mt-5">
        {step === 'course' && (
          <AutoGrid min="15rem" gap="gap-3">
            {courseField}
            <div className={fullRowClass}>{moduleField}</div>
            {periodFields}
          </AutoGrid>
        )}

        {step === 'schedule' && (
          <div className="flex flex-col gap-4">
            {daysField}
            <AutoGrid min="12rem" gap="gap-3">
              {timeFields}
            </AutoGrid>
            {timeError}
            {capacitySection}
          </div>
        )}

        {step === 'dates' && (
          <div className="flex flex-col gap-3">
            <AutoGrid min="15rem" gap="gap-3">
              {dateFields}
              {windowFields}
            </AutoGrid>
            <p className="text-xs text-muted-foreground">{t('class_groups.window_hint')}</p>
            {missingDatesNote}
          </div>
        )}

        {step === 'teacher' && (
          <div className="flex flex-col gap-3">
            {/* The one thing a first-time reader must not miss here: nothing on
                this step stops the class group from opening (OOC-135). */}
            <div className="flex items-start gap-3 rounded-lg border border-brand-blue/30 bg-sky-soft p-3.5">
              <BoIcon name="help" size={18} className="mt-0.5 shrink-0 text-brand-blue" />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-ink">{t('class_groups.teacher_optional_title')}</p>
                <p className="text-sm text-ink">{t('class_groups.teacher_optional_hint')}</p>
              </div>
            </div>
            <AutoGrid min="15rem" gap="gap-3">
              {teacherField}
              {classroomField}
            </AutoGrid>
            {teacherWarnings}
          </div>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-3">
            <dl className="divide-y divide-line rounded-lg border border-line">
              {review.map(([label, value]) => (
                <div key={label} className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 py-2.5">
                  <dt className={`w-40 shrink-0 ${labelClass}`}>{label}</dt>
                  <dd className="min-w-0 flex-1 break-words text-sm text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {severalGroups && (
              <p className="flex items-start gap-2 rounded-lg border border-brand-blue/30 bg-sky-soft p-3.5 text-sm text-ink">
                <BoIcon name="help" size={18} className="mt-0.5 shrink-0 text-brand-blue" />
                {t('class_groups.teacher_many_hint', { count: groupCount })}
              </p>
            )}
            {missingDatesNote}
          </div>
        )}
      </div>

      {stepError && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
        >
          <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          {stepError}
        </p>
      )}
      {errorLine}
      {error && createdCount > 0 && (
        <p className="mt-1 text-sm text-red-700">
          {t('class_groups.created_partial', { created: createdCount, total: capacities.length })}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {current > 0 && (
          <button
            type="button"
            onClick={() => go(steps[current - 1])}
            className={secondaryButtonClass}
          >
            <BoIcon name="arrow-left" size={16} />
            {t('class_groups.step_prev')}
          </button>
        )}
        {step === 'review' ? (
          <>
            <button
              type="button"
              disabled={!ready || !hasDates || saving}
              onClick={() => void create(true)}
              className={primaryButtonClass}
            >
              <BoIcon name="check" size={16} />
              {t('class_groups.open_enrollment')}
            </button>
            <button
              type="button"
              disabled={!ready || saving}
              onClick={() => void create(false)}
              className={secondaryButtonClass}
            >
              {t('class_groups.save_draft')}
            </button>
          </>
        ) : (
          <button type="button" onClick={advance} className={primaryButtonClass}>
            {step === 'teacher' && teacherId === ''
              ? t('class_groups.step_skip_teacher')
              : t('class_groups.step_next')}
            <BoIcon name="chevron-right" size={16} />
          </button>
        )}
        {cancelButton}
      </div>
    </Card>
  )
}
