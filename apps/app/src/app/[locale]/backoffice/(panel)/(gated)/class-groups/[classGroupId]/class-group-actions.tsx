'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type {
  CatalogErrorKey,
  ClassGroupItem,
  ClassGroupStatus,
  CourseRow,
  TeacherOption,
} from '@/lib/backoffice/types'
import { catalogWrite, setCatalogEntryOnOffer } from '@/lib/backoffice/catalog-client'
import { NEXT_CLASS_GROUP_STATUS } from '@/lib/backoffice/class-group-status'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { RetireConfirmation } from '@/components/backoffice/retire-confirmation'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ClassGroupForm } from '../class-group-form'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const dangerButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

/**
 * What the edit form reads from the class group. The form captures its
 * baseline once, on mount — so it is re-mounted whenever this changes (the
 * refresh after a save), and never diffs against values the server no longer
 * holds.
 */
function editBaseline(group: ClassGroupItem): string {
  return JSON.stringify([
    group.courseId,
    group.code,
    group.teacherId,
    group.slots,
    group.capacity,
    group.seatsTaken,
    group.status,
    group.startsOn,
    group.endsOn,
    group.enrollmentOpensAt,
    group.enrollmentClosesAt,
  ])
}

/** Which inline confirmation is open, if any. */
type Confirming = 'advance' | 'retire' | 'restore' | null

/**
 * What coordination does to a class group from its page: move it one step
 * forward, edit it, and take it off the catalog or put it back.
 *
 * Status only moves forward, one step, after an inline confirmation that says
 * what the step means — there is no way back, a class group opened by mistake
 * is retired from the catalog instead (CLAUDE.md §1, "Catálogo sai do ar, não
 * some"). Retiring is never blocked by live enrollments: the confirmation
 * says how many are still standing before the click (OOC-70), and the toast
 * repeats it after. A retired class group only offers to come back.
 * Every write goes through `apps/api`, which is what actually decides
 * (CLAUDE.md §8); this re-reads the page afterwards.
 */
export function ClassGroupActions({
  group,
  courses,
  teachers,
  canManage,
}: {
  group: ClassGroupItem
  courses: CourseRow[]
  /** The roster for the edit form's teacher picker; null when unreadable. */
  teachers: TeacherOption[] | null
  canManage: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  if (!canManage) return null

  const next = NEXT_CLASS_GROUP_STATUS[group.status]
  // Publishing needs both dates (API: `catalog.class_group_incomplete`); the
  // button says why it is off instead of failing on click.
  const missingDates = group.status === 'draft' && (!group.startsOn || !group.endsOn)

  async function advance(to: ClassGroupStatus) {
    setPending(true)
    setError(null)
    const result = await catalogWrite<{ id: string; status: ClassGroupStatus }>(
      `/class-groups/${encodeURIComponent(group.id)}/status`,
      'POST',
      { to },
    )
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirming(null)
    setToast(t('class_group_actions.status_changed'))
    router.refresh()
  }

  async function setOnCatalog(verb: 'retire' | 'restore') {
    setPending(true)
    setError(null)
    const result = await setCatalogEntryOnOffer('class_group', group.id, verb)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirming(null)
    setToast(
      verb === 'retire'
        ? t('class_group_actions.retired_notice', { count: result.data.liveEnrollments })
        : t('class_group_actions.restored'),
    )
    router.refresh()
  }

  const errorLine = error && (
    <p role="alert" className="mt-3 text-sm text-red-700">
      {t(`catalog_errors.${error}`)}
    </p>
  )

  if (!group.active) {
    return (
      <Card className="p-5">
        {confirming === 'restore' ? (
          <Confirmation
            text={t('class_group_actions.confirm_restore')}
            pending={pending}
            onConfirm={() => void setOnCatalog('restore')}
            onCancel={() => setConfirming(null)}
          />
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null)
              setConfirming('restore')
            }}
            className={secondaryButtonClass}
          >
            <BoIcon name="check" size={16} />
            {t('class_group_actions.restore')}
          </button>
        )}
        {errorLine}
        <Toast message={toast} onDismiss={() => setToast(null)} />
      </Card>
    )
  }

  function saved() {
    setEditing(false)
    setToast(t('class_group_actions.saved'))
    router.refresh()
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        {next && confirming !== 'advance' && (
          <button
            type="button"
            disabled={missingDates || pending}
            onClick={() => {
              setError(null)
              setConfirming('advance')
            }}
            className={primaryButtonClass}
          >
            <BoIcon name="check" size={16} />
            {t(`class_group_actions.advance_${next}`)}
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={secondaryButtonClass}
        >
          <BoIcon name="edit" size={16} />
          {t('class_group_actions.edit')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            setConfirming('retire')
          }}
          className={dangerButtonClass}
        >
          <BoIcon name="close" size={16} />
          {t('class_group_actions.retire')}
        </button>
      </div>

      {next && confirming === 'advance' && (
        <Confirmation
          text={t(`class_group_actions.confirm_${next}`)}
          pending={pending}
          onConfirm={() => void advance(next)}
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming === 'retire' && (
        <div className="mt-3">
          <RetireConfirmation
            kind="class_group"
            id={group.id}
            text={t('class_group_actions.confirm_retire')}
            pending={pending}
            onConfirm={() => void setOnCatalog('retire')}
            onCancel={() => setConfirming(null)}
          />
        </div>
      )}

      {next && missingDates && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          {t('class_groups.missing_to_publish')}
        </p>
      )}

      {errorLine}

      <p className="mt-3 text-xs text-muted-foreground">{t('class_group_actions.forward_only')}</p>

      <Sheet
        open={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(false)
        }}
      >
        <SheetContent
          side="right"
          closeLabel={t('class_group_actions.close')}
          className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-xl"
        >
          {/* The form carries its own visible title; this one names the
              dialog for assistive technology. */}
          <SheetHeader className="sr-only">
            <SheetTitle>{t('class_group_actions.edit')}</SheetTitle>
            <SheetDescription>{`${group.courseName} · ${group.code}`}</SheetDescription>
          </SheetHeader>
          <div className="p-4 pt-14">
            {/* The sheet unmounts its content when closed, so every opening
                starts from the props on screen; the key covers a refresh that
                lands while it is open. Edit mode never shows the period
                picker, so it needs no periods. */}
            <ClassGroupForm
              key={editBaseline(group)}
              mode="edit"
              courses={courses}
              periods={[]}
              teachers={teachers}
              initial={group}
              onDone={saved}
              onCancel={() => setEditing(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Card>
  )
}

/** The inline "are you sure" every action on this card goes through. */
function Confirmation({
  text,
  pending,
  onConfirm,
  onCancel,
}: {
  text: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('bo')
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-sky-soft px-4 py-3">
      <p className="text-sm text-ink">{text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={onConfirm} className={primaryButtonClass}>
          {t('class_group_actions.confirm')}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={secondaryButtonClass}>
          {t('class_group_actions.cancel')}
        </button>
      </div>
    </div>
  )
}
