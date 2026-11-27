'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { ClassroomCredentialsCard } from '@/components/backoffice/teachers/classroom-credentials'
import {
  revealOwnClassroomAccess,
  type ClassroomCredentials,
} from '@/lib/backoffice/classroom-accounts-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type State =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'shown'; credentials: ClassroomCredentials }
  | { kind: 'none' }
  | { kind: 'error' }

/**
 * "Ver mis accesos de Classroom" (OOC-196): the shared Google account the
 * teacher's own file points at, e-mail and password, without asking the team.
 * Fetched on the click — the API answers from the session, never from an id,
 * and every reveal is an audit line.
 */
export function OwnClassroomAccess() {
  const t = useTranslations('bo')
  const [state, setState] = useState<State>({ kind: 'closed' })

  async function open() {
    setState({ kind: 'loading' })
    const result = await revealOwnClassroomAccess()
    if (!result.ok) setState({ kind: 'error' })
    else if (result.value.access === null) setState({ kind: 'none' })
    else setState({ kind: 'shown', credentials: result.value.access })
  }

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void open()}
          disabled={state.kind === 'loading'}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-60"
        >
          <BoIcon name={state.kind === 'loading' ? 'spinner' : 'key'} size={16} />
          {t('classroom_access.open')}
        </button>
        <HelpHint what={t('help.own_classroom_access_what')} how={t('help.own_classroom_access_how')} />
      </span>

      <Dialog
        open={state.kind === 'shown' || state.kind === 'none' || state.kind === 'error'}
        onOpenChange={(next) => !next && setState({ kind: 'closed' })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('classroom_access.title')}</DialogTitle>
            <DialogDescription>
              {state.kind === 'shown'
                ? t('classroom_access.shared_note')
                : state.kind === 'none'
                  ? t('classroom_access.none')
                  : t('classroom_access.error')}
            </DialogDescription>
          </DialogHeader>
          {state.kind === 'shown' && <ClassroomCredentialsCard credentials={state.credentials} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
