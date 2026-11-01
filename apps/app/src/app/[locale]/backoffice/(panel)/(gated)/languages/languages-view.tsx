'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { CatalogErrorKey, LanguageItem } from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import {
  Card,
  EmptyState,
  TableShell,
  tdClass,
  thClass,
  Toolbar,
  toolbarSearchClass,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { CatalogConfirmation } from '@/components/backoffice/retire-confirmation'

const fieldClass =
  'w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

const dangerButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40'

/**
 * One list, one line per language: its name and what hangs on it. A course
 * picks its language from here instead of typing it (OOC-128). Renaming fixes
 * the spelling on every course and teacher at once; retiring waits until no
 * course is left on the language — the courses move first, from their own
 * settings.
 */
export function LanguagesView({ languages, canManage }: { languages: LanguageItem[]; canManage: boolean }) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function create() {
    setCreating(true)
    setError(null)
    const result = await catalogWrite('/languages', 'POST', { name: name.trim() })
    setCreating(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setName('')
    setToast(t('languages.created'))
    router.refresh()
  }

  function changed(message: string) {
    setToast(message)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {canManage && (
        <Toolbar>
          <form
            className="flex w-full flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <label className={toolbarSearchClass}>
              <span className="sr-only">{t('languages.new_label')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('languages.new_placeholder')}
                maxLength={60}
                className={fieldClass}
              />
            </label>
            <button type="submit" disabled={creating || name.trim() === ''} className={primaryButtonClass}>
              <BoIcon name="plus" size={16} />
              {t('languages.create')}
            </button>
            {error && (
              <p role="alert" className="basis-full text-sm text-red-700">
                {t(`catalog_errors.${error}`)}
              </p>
            )}
          </form>
        </Toolbar>
      )}

      {languages.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon="courses" title={t('languages.empty_title')} body={t('languages.empty_body')} />
        </Card>
      ) : (
        <Card>
          <TableShell
            fixed
            columns={[
              t('languages.col_language'),
              t('languages.col_courses'),
              t('languages.col_teachers'),
              ...(canManage ? [t('languages.col_actions')] : []),
            ]}
          >
            <colgroup>
              <col className={canManage ? 'w-[40%]' : 'w-[60%]'} />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              {canManage && <col className="w-[30%]" />}
            </colgroup>
            <thead>
              <tr>
                <th className={thClass}>{t('languages.col_language')}</th>
                <th className={thClass}>{t('languages.col_courses')}</th>
                <th className={thClass}>{t('languages.col_teachers')}</th>
                {canManage && (
                  <th className={thClass}>
                    <span className="sr-only">{t('languages.col_actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            {languages.map((language) => (
              <LanguageRow key={language.id} language={language} canManage={canManage} onChanged={changed} />
            ))}
          </TableShell>
        </Card>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function LanguageRow({
  language,
  canManage,
  onChanged,
}: {
  language: LanguageItem
  canManage: boolean
  onChanged: (message: string) => void
}) {
  const t = useTranslations('bo')
  const [mode, setMode] = useState<'view' | 'rename' | 'retire'>('view')
  const [name, setName] = useState(language.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)

  async function rename() {
    setBusy(true)
    setError(null)
    const result = await catalogWrite(`/languages/${language.id}`, 'PATCH', { name: name.trim() })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMode('view')
    onChanged(t('languages.renamed'))
  }

  async function retire() {
    setBusy(true)
    setError(null)
    const result = await catalogWrite(`/languages/${language.id}/retire`, 'POST')
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged(t('languages.retired'))
  }

  const inUse = language.courseCount > 0
  const columns = canManage ? 4 : 3

  return (
    <tbody className="border-b border-line last:border-b-0">
      <tr>
        <td className={tdClass}>
          {mode === 'rename' ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void rename()
              }}
            >
              <label className="sr-only" htmlFor={`rename-${language.id}`}>
                {t('languages.rename_label')}
              </label>
              <input
                id={`rename-${language.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                autoFocus
                className={`${fieldClass} max-w-xs`}
              />
              <button type="submit" disabled={busy || name.trim() === ''} className={primaryButtonClass}>
                <BoIcon name="check" size={16} />
                {t('languages.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('view')
                  setName(language.name)
                  setError(null)
                }}
                className={secondaryButtonClass}
              >
                {t('languages.cancel')}
              </button>
            </form>
          ) : (
            <span className="font-semibold text-ink">{language.name}</span>
          )}
        </td>
        <td className={`${tdClass} text-sm tabular-nums text-muted-foreground`}>{language.courseCount}</td>
        <td className={`${tdClass} text-sm tabular-nums text-muted-foreground`}>{language.teacherCount}</td>
        {canManage && (
          <td className={tdClass}>
            {mode === 'view' && (
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setMode('rename')} className={secondaryButtonClass}>
                  <BoIcon name="edit" size={16} />
                  {t('languages.rename')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setMode('retire')
                  }}
                  className={dangerButtonClass}
                >
                  <BoIcon name="close" size={16} />
                  {t('languages.retire')}
                </button>
              </div>
            )}
          </td>
        )}
      </tr>

      {(mode === 'retire' || error) && (
        <tr>
          <td colSpan={columns} className="px-4 pb-4">
            {mode === 'retire' &&
              (inUse ? (
                /* Not a confirmation: the language still has courses, and the
                   API would refuse. Say what to do instead of offering a button
                   that fails. */
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p>{t('languages.retire_blocked', { count: language.courseCount })}</p>
                  <button type="button" onClick={() => setMode('view')} className={`${secondaryButtonClass} w-fit`}>
                    {t('languages.cancel')}
                  </button>
                </div>
              ) : (
                <CatalogConfirmation
                  text={t('languages.confirm_retire', { teachers: language.teacherCount })}
                  pending={busy}
                  onConfirm={() => void retire()}
                  onCancel={() => setMode('view')}
                />
              ))}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {t(`catalog_errors.${error}`)}
              </p>
            )}
          </td>
        </tr>
      )}
    </tbody>
  )
}
