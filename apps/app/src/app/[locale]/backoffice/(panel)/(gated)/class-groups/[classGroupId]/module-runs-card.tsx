'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { formatDate, type Locale } from '@/lib/format'
import type {
  CatalogErrorKey,
  ClassGroupItem,
  ClassGroupModuleItem,
  CourseRow,
  TeacherOption,
} from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { Card, StatusBadge } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { HelpHint } from '@/components/backoffice/help-hint'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ClassGroupForm, classGroupAsRun } from '../class-group-form'
import { ProgressionPanel } from '@/components/progression/progression-panel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

const dangerButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40'

/** Null = closed; `null` id = a new run. */
type Editing = { runId: string | null } | null

/**
 * The module runs of a class group — the "sub-turmas" (OOC-156): what each
 * one teaches, who teaches it, when it meets and whether its Classroom is in.
 * They go on at the same time; the seats are the class group's, counted
 * across all of them, and a new student starts in the first one.
 *
 * Who edits a class group opens another run, edits one or retires one. The
 * form is the class group form in its run mode — the same fields, the same
 * warnings. Retiring is refused by the API while a seat is in the run; the
 * button is off already when the screen knows of one, and the error says it
 * when the screen did not (a reserved seat is not counted here).
 */
export function ModuleRunsCard({
  group,
  courses,
  teachers,
  canManage,
  canProgress,
}: {
  group: ClassGroupItem
  courses: CourseRow[]
  teachers: TeacherOption[] | null
  canManage: boolean
  /** Moves students on to the next module (OOC-156) — coordination, below the pass mark too. */
  canProgress: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [editing, setEditing] = useState<Editing>(null)
  const [retiring, setRetiring] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [progressing, setProgressing] = useState<ClassGroupModuleItem | null>(null)
  /* Students move on once the class group runs — the grades come after the last class. */
  const progressionOpen = group.active && (group.status === 'in_progress' || group.status === 'finished')

  const runs = group.modules
  const courseModules = courses.find((course) => course.id === group.courseId)?.modules ?? 0
  const numbered = runs.filter((run) => run.module !== null).map((run) => run.module!)
  /* A full course or an unset module is alone (the API's rule): another run
     needs the current one's module set first. */
  const blockedByUnnumbered = runs.some((run) => run.module === null)
  const modulesLeft = Array.from({ length: courseModules }, (_, index) => index + 1).filter(
    (number) => !numbered.includes(number),
  )
  const canAdd = canManage && group.active && !blockedByUnnumbered && modulesLeft.length > 0
  const editingRun = editing?.runId ? (runs.find((run) => run.id === editing.runId) ?? null) : null

  async function retire(run: ClassGroupModuleItem) {
    setPending(true)
    setError(null)
    const result = await catalogWrite(
      `/class-groups/${encodeURIComponent(group.id)}/modules/${encodeURIComponent(run.id)}/retire`,
      'POST',
      {},
    )
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRetiring(null)
    setToast(t('class_group_runs.retired'))
    router.refresh()
  }

  function saved() {
    setToast(t(editing?.runId === null ? 'class_group_runs.created' : 'class_group_runs.saved'))
    setEditing(null)
    router.refresh()
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-ink">{t('class_group_runs.title')}</h2>
            {/* One (?) for the warnings every run card carries, not one per badge. */}
            <HelpHint what={t('help.cg_runs_badges_what')} how={t('help.cg_runs_badges_how')} />
          </span>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{t('class_group_runs.subtitle')}</p>
        </div>
        {canManage && group.active && (
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              setError(null)
              setEditing({ runId: null })
            }}
            className={primaryButtonClass}
          >
            <BoIcon name="plus" size={16} />
            {t('class_group_runs.add')}
          </button>
        )}
      </div>

      {canManage && group.active && !canAdd && (
        <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <BoIcon name="help" size={14} className="mt-0.5 shrink-0" />
          {t(blockedByUnnumbered ? 'class_group_runs.add_needs_module' : 'class_group_runs.add_no_modules_left')}
        </p>
      )}

      <ul className="mt-4 flex flex-col divide-y divide-line rounded-lg border border-line">
        {runs.map((run, index) => (
          <li key={run.id} className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-ink">
                  {run.fullCourse
                    ? t('class_group_runs.full_course')
                    : run.module === null
                      ? t('class_group_runs.no_module')
                      : t('class_group_runs.module_label', { number: run.module })}
                </span>
                {index === 0 && (
                  <span title={t('class_group_runs.entry_hint')}>
                    <StatusBadge tone="info" label={t('class_group_runs.entry')} />
                  </span>
                )}
                <StatusBadge
                  tone={run.classroomMissing ? 'warning' : 'success'}
                  label={t(run.classroomMissing ? 'class_group_runs.classroom_missing' : 'class_group_runs.classroom_ok')}
                />
                {/* The module group's Meet (OOC-159): warns, never blocks. */}
                <StatusBadge
                  tone={run.meetUrl ? 'success' : 'warning'}
                  label={t(run.meetUrl ? 'class_group_runs.meet_ok' : 'class_group_runs.meet_missing')}
                />
                {/* The module's end date (OOC-180): the grade register's deadline runs from it. */}
                <StatusBadge
                  tone={run.moduleEndsOn ? 'neutral' : 'warning'}
                  label={
                    run.moduleEndsOn
                      ? t('grade_register.ends_on', { date: formatDate(run.moduleEndsOn, locale) })
                      : t('grade_register.no_end_date')
                  }
                />
              </span>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {t('class_group_runs.students', { count: run.students })}
              </span>
            </div>

            <dl className="grid gap-x-4 gap-y-1 text-sm text-ink sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="sr-only">{t('class_group.field_teacher')}</dt>
                <dd className="truncate">
                  {run.teacherName ||
                    (run.legacyTeacherName ? (
                      <span className="text-muted-foreground">
                        {t('class_groups.teacher_legacy_hint', { name: run.legacyTeacherName })}
                      </span>
                    ) : (
                      <span className="text-amber-700">{t('class_group_runs.no_teacher')}</span>
                    ))}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="sr-only">{t('class_group.field_schedule')}</dt>
                <dd className="tabular-nums">
                  {run.slots.length > 0 ? slotsLabel(run.slots, t) : t('class_group_runs.no_schedule')}
                </dd>
              </div>
            </dl>

            {((canManage && group.active) || (canProgress && progressionOpen && run.students > 0)) && (
              <div className="flex flex-wrap gap-2">
                {canProgress && progressionOpen && run.students > 0 && (
                  <button
                    type="button"
                    onClick={() => setProgressing(run)}
                    className={secondaryButtonClass}
                  >
                    <BoIcon name="trend-up" size={16} />
                    {t('progression.open')}
                  </button>
                )}
                {canManage && group.active && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setEditing({ runId: run.id })
                    }}
                    className={secondaryButtonClass}
                  >
                    <BoIcon name="edit" size={16} />
                    {t('class_group_runs.edit')}
                  </button>
                )}
                {canManage && group.active && runs.length > 1 && (
                  <button
                    type="button"
                    disabled={pending || run.students > 0}
                    onClick={() => {
                      setError(null)
                      setRetiring(run.id)
                    }}
                    className={dangerButtonClass}
                  >
                    <BoIcon name="close" size={16} />
                    {t('class_group_runs.retire')}
                  </button>
                )}
              </div>
            )}

            {retiring === run.id && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-sky-soft px-4 py-3">
                <p className="text-sm text-ink">{t('class_group_runs.confirm_retire')}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void retire(run)}
                    className={primaryButtonClass}
                  >
                    {t('class_group_actions.confirm')}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setRetiring(null)}
                    className={secondaryButtonClass}
                  >
                    {t('class_group_actions.cancel')}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t(`catalog_errors.${error}`)}
        </p>
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <SheetContent
          side="right"
          closeLabel={t('class_group_runs.close')}
          className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-xl"
        >
          <SheetHeader className="px-4 pt-6">
            <SheetTitle>
              {t(editing?.runId === null ? 'class_group_runs.add_title' : 'class_group_runs.edit_title')}
            </SheetTitle>
            <SheetDescription>{`${group.courseName} · ${group.code}`}</SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {editing && (
              <ClassGroupForm
                key={editing.runId ?? 'new'}
                mode="run"
                run={{
                  moduleId: editing.runId,
                  takenModules: runs
                    .filter((other) => other.id !== editing.runId && other.module !== null)
                    .map((other) => other.module!),
                  hasOthers: runs.some((other) => other.id !== editing.runId),
                }}
                courses={courses}
                periods={[]}
                teachers={teachers}
                initial={classGroupAsRun(group, editingRun)}
                onDone={saved}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={progressing !== null}
        onOpenChange={(open) => {
          if (!open) setProgressing(null)
        }}
      >
        <DialogContent closeLabel={t('class_group_runs.close')} className="bg-white">
          {progressing && (
            <>
              <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
                <span className="flex items-center gap-1.5">
                  <DialogTitle className="text-base font-semibold text-ink">{t('progression.title')}</DialogTitle>
                  <HelpHint what={t('help.cg_progression_what')} how={t('help.cg_progression_how')} />
                </span>
                <DialogDescription>
                  {progressing.module === null
                    ? group.code
                    : t('class_group_runs.code_with_module', { code: group.code, number: progressing.module })}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto p-5">
                <ProgressionPanel
                  endpoint={`/api/v1/catalog/class-groups/${encodeURIComponent(group.id)}/modules/${encodeURIComponent(progressing.id)}/progression`}
                  canForce
                  onDone={(result) => {
                    setProgressing(null)
                    setToast(t('progression.done', { advance: result.advanced, repeat: result.repeated }))
                    router.refresh()
                  }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Card>
  )
}
