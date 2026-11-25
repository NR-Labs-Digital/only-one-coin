'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { HelpHint } from '@/components/backoffice/help-hint'
import { formatDate, formatFileSize, type Locale } from '@/lib/format'
import {
  attachmentDownloadUrl,
  checkFile,
  fetchAttachments,
  removeAttachment,
  uploadAttachment,
  type AttachmentScope,
} from '@/lib/attachments/client'
import {
  ATTACHMENT_CATEGORIES,
  type AttachmentCategory,
  type AttachmentFailure,
  type AttachmentItem,
  type AttachmentList,
  type AttachmentSource,
} from '@/lib/attachments/types'
import { downloadIssuedDocument, revokeIssuedDocument } from '@/lib/issued-documents/client'
import type { IssuedDocumentItem, IssuedDocumentScope } from '@/lib/issued-documents/types'

/** What the type list says in the rules line: brand-free, short. */
const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
}

type Notice = { tone: 'ok' | 'error'; key: string; values?: Record<string, string> }

/** Which origin the list shows. `all` is the default; `issued` is what the
 * institution issued (OOC-33); the other two are the two sides that send
 * files (OOC-148). */
type OriginFilter = 'all' | 'issued' | AttachmentSource

const ORIGIN_FILTERS: readonly OriginFilter[] = ['all', 'issued', 'backoffice', 'portal']

/**
 * The student's documents (OOC-143, unified in OOC-148) — one list, the same in
 * the panel's student file and in the student's own portal. Every row carries a
 * label saying who sent it: the team (from the panel) or the student (from the
 * portal), worded for whoever is reading. A filter narrows the list to one side.
 * The constancia and the certificate the institution issued (OOC-33) join the
 * same list with their own label and their verification code; they are never
 * removed. The notice under the list says the attached files carry no code.
 *
 * Presentation only on top of `lib/attachments/client`: every write goes
 * through the API, and the file straight to the bucket.
 */
export function AttachmentsSection({
  scope,
  initial,
  variant,
  canUpload,
  canRemove,
  issued,
  issuedScope,
  canRevokeIssued = false,
}: {
  scope: AttachmentScope
  /** The documents the institution issued about the student (OOC-33); null when unreadable. */
  issued: IssuedDocumentItem[] | null
  issuedScope: IssuedDocumentScope
  /** First list, read on the server. Null when the API failed. */
  initial: AttachmentList | null
  /** Which surface's titles and empty state. */
  variant: 'staff' | 'portal'
  canUpload: boolean
  canRemove: boolean
  /** Staff only: revoke an issued document, with a reason (OOC-59). */
  canRevokeIssued?: boolean
}) {
  const t = useTranslations('attachments')
  const tb = useTranslations('bo')
  const locale = useLocale() as Locale
  const fileInput = useRef<HTMLInputElement>(null)

  const [list, setList] = useState<AttachmentList | null>(initial)
  const [adding, setAdding] = useState(false)
  const [category, setCategory] = useState<AttachmentCategory>('national_id')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  // Revoked here, before the server list catches up: the row changes the
  // moment the API answers, whatever the refresh does.
  const [revokedHere, setRevokedHere] = useState<ReadonlySet<string>>(new Set())
  const router = useRouter()

  const limits = list?.limits ?? null
  const failureNotice = (failure: AttachmentFailure): Notice => ({
    tone: 'error',
    key: `error.${failure}`,
    values: limits ? { size: formatFileSize(limits.maxBytes, locale) } : {},
  })

  async function refresh() {
    const next = await fetchAttachments(scope)
    if (next) setList(next)
  }

  function pick(selected: File | null) {
    setNotice(null)
    setFile(selected)
    if (selected && limits) {
      const failure = checkFile(selected, limits)
      if (failure) setNotice(failureNotice(failure))
    }
  }

  async function send() {
    if (!file || !limits) return
    const failure = checkFile(file, limits)
    if (failure) {
      setNotice(failureNotice(failure))
      return
    }
    setBusy(true)
    setNotice(null)
    const outcome = await uploadAttachment({ scope, category, file })
    setBusy(false)
    if (!outcome.ok) {
      setNotice(failureNotice(outcome.failure))
      return
    }
    setAdding(false)
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
    setNotice({ tone: 'ok', key: 'sent', values: { name: file.name } })
    await refresh()
  }

  async function download(item: AttachmentItem) {
    setNotice(null)
    const url = await attachmentDownloadUrl(scope, item.id)
    if (!url) {
      setNotice({ tone: 'error', key: 'download_failed' })
      return
    }
    window.location.assign(url)
  }

  async function downloadIssued(item: IssuedDocumentItem) {
    setNotice(null)
    if (!(await downloadIssuedDocument(issuedScope, item.id, item.code))) {
      setNotice({ tone: 'error', key: 'download_failed' })
    }
  }

  async function revoke(item: IssuedDocumentItem) {
    setBusy(true)
    setNotice(null)
    const outcome = await revokeIssuedDocument(item.id, revokeReason)
    setBusy(false)
    if (!outcome.ok) {
      setNotice({ tone: 'error', key: `revoke_error.${outcome.failure}` })
      return
    }
    setRevoking(null)
    setRevokeReason('')
    setRevokedHere((current) => new Set(current).add(item.id))
    setNotice({ tone: 'ok', key: 'revoked', values: { code: item.code } })
    // The list is read on the server: read it again with the new status.
    router.refresh()
  }

  async function remove(item: AttachmentItem) {
    setBusy(true)
    const ok = await removeAttachment(item.id)
    setBusy(false)
    setConfirmingRemove(null)
    if (!ok) {
      setNotice({ tone: 'error', key: 'remove_failed' })
      return
    }
    setNotice({ tone: 'ok', key: 'removed', values: { name: item.originalName } })
    await refresh()
  }

  const items = list?.items ?? []
  const issuedItems = (issued ?? []).map((item) =>
    item.status === 'valid' && revokedHere.has(item.id) ? { ...item, status: 'revoked' as const } : item,
  )
  const countOf = (filter: OriginFilter) =>
    filter === 'all'
      ? items.length + issuedItems.length
      : filter === 'issued'
        ? issuedItems.length
        : items.filter((item) => item.source === filter).length
  const shownIssued = origin === 'all' || origin === 'issued' ? issuedItems : []
  const shown =
    origin === 'all' ? items : origin === 'issued' ? [] : items.filter((item) => item.source === origin)

  const rules = limits
    ? t('rules', {
        types: [...new Set(limits.contentTypes.map((type) => TYPE_LABELS[type] ?? type))].join(', '),
        size: formatFileSize(limits.maxBytes, locale),
      })
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t(`title_${variant}`)}</h2>
        {canUpload && list && !adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true)
              setNotice(null)
            }}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
          >
            {t('attach')}
          </button>
        )}
      </div>

      {adding && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-sky-soft p-4">
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('category_label')}
              </span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as AttachmentCategory)}
                className="min-h-tap rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
              >
                {ATTACHMENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`category.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('file_label')}
              </span>
              <input
                ref={fileInput}
                type="file"
                accept={limits?.contentTypes.join(',')}
                onChange={(event) => pick(event.target.files?.[0] ?? null)}
                className="min-h-tap rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-sky file:px-2 file:py-1 file:text-xs file:font-semibold file:text-brand-blue"
              />
            </label>
          </div>
          {rules && <p className="text-xs text-muted-foreground">{rules}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void send()}
              disabled={!file || busy}
              className="inline-flex min-h-tap items-center rounded-lg bg-brand-blue px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t('sending') : t('send')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setFile(null)
                setNotice(null)
              }}
              disabled={busy}
              className="min-h-tap rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={
            notice.tone === 'error'
              ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800'
              : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800'
          }
        >
          {t(notice.key, notice.values)}
        </p>
      )}

      {list === null ? (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('load_error')}
        </p>
      ) : items.length === 0 && issuedItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm font-semibold text-ink">{t(`empty_${variant}_title`)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t(`empty_${variant}_body`)}</p>
        </div>
      ) : (
        <>
          <div role="group" aria-label={t('filter.label')} className="flex flex-wrap gap-2">
            {ORIGIN_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={origin === filter}
                onClick={() => setOrigin(filter)}
                className={
                  origin === filter
                    ? 'inline-flex min-h-tap items-center gap-1.5 rounded-full bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white'
                    : 'inline-flex min-h-tap items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-sky hover:text-brand-blue'
                }
              >
                {t(`filter.${variant}.${filter}`)}
                <span className="tabular-nums opacity-80">{countOf(filter)}</span>
              </button>
            ))}
            <span className="inline-flex min-h-tap items-center">
              <HelpHint
                what={tb(`help.attach_origin_${variant}_what`)}
                how={tb(`help.attach_origin_${variant}_how`)}
              />
            </span>
          </div>

          {issued === null && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('issued_load_error')}
            </p>
          )}
          {shown.length === 0 && shownIssued.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted-foreground">
              {t(`empty_filtered.${variant}.${origin}`)}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {shownIssued.map((item) => (
                <li key={`issued-${item.id}`} className="flex flex-col gap-2 py-3 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      aria-hidden
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[0.625rem] font-bold tracking-wide text-emerald-800"
                    >
                      PDF
                    </span>
                    <span className="flex min-w-0 flex-col gap-1 leading-tight">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{t(`issued_kind.${item.kind}`)}</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-emerald-800">
                          {t(`origin.${variant}.issued`)}
                        </span>
                        {item.status !== 'valid' && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-red-800">
                            {t(`issued_status.${item.status}`)}
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{item.courseName}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('issued_meta', { code: item.code, date: formatDate(item.issuedAt, locale) })}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {/* A revoked or replaced document is the record's, not a paper
                        to hand out again: the portal does not print it (the API
                        refuses too); staff still does. */}
                    {(variant === 'staff' || item.status === 'valid') && (
                      <button
                        type="button"
                        onClick={() => void downloadIssued(item)}
                        className="inline-flex min-h-tap items-center rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                      >
                        {t('download')}
                      </button>
                    )}
                    {canRevokeIssued && item.status === 'valid' && revoking !== item.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setRevoking(item.id)
                          setRevokeReason('')
                          setNotice(null)
                        }}
                        className="inline-flex min-h-tap items-center rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-red-200 hover:text-red-700"
                      >
                        {t('revoke')}
                      </button>
                    )}
                  </span>
                  </div>
                  {revoking === item.id && (
                    <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                      <p className="text-xs text-red-800">{t('revoke_question', { code: item.code })}</p>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-red-900">{t('revoke_reason_label')}</span>
                        <textarea
                          value={revokeReason}
                          onChange={(event) => setRevokeReason(event.target.value)}
                          maxLength={500}
                          rows={2}
                          className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                        />
                      </label>
                      <span className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void revoke(item)}
                          disabled={busy || revokeReason.trim().length === 0}
                          className="min-h-tap rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                          {t('revoke_confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRevoking(null)}
                          className="min-h-tap rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                        >
                          {t('cancel')}
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
              {shown.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        aria-hidden
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky text-[0.625rem] font-bold tracking-wide text-brand-blue"
                      >
                        {TYPE_LABELS[item.mimeType] ?? '—'}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1 leading-tight">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{t(`category.${item.category}`)}</span>
                          <span
                            className={
                              item.source === 'backoffice'
                                ? 'rounded-full bg-sky px-2 py-0.5 text-[0.6875rem] font-semibold text-brand-blue-deep'
                                : 'rounded-full bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-800'
                            }
                          >
                            {t(`origin.${variant}.${item.source}`)}
                          </span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{item.originalName}</span>
                        <span className="text-xs text-muted-foreground">
                          {t('meta', {
                            size: formatFileSize(item.sizeBytes, locale),
                            date: formatDate(item.uploadedAt, locale),
                          })}
                          {item.uploadedByName && ` · ${t('by', { name: item.uploadedByName })}`}
                        </span>
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void download(item)}
                        className="inline-flex min-h-tap items-center rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                      >
                        {t('download')}
                      </button>
                      {canRemove && confirmingRemove !== item.id && (
                        <button
                          type="button"
                          onClick={() => setConfirmingRemove(item.id)}
                          className="inline-flex min-h-tap items-center rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-red-200 hover:text-red-700"
                        >
                          {t('remove')}
                        </button>
                      )}
                    </span>
                  </div>
                  {confirmingRemove === item.id && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                      <span className="text-xs text-red-800">{t('remove_question', { name: item.originalName })}</span>
                      <span className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => void remove(item)}
                          disabled={busy}
                          className="min-h-tap rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                        >
                          {t('remove_confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemove(null)}
                          className="min-h-tap rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                        >
                          {t('cancel')}
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  )
}
