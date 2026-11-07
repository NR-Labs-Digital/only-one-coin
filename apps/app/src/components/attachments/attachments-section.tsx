'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
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
} from '@/lib/attachments/types'

/** What the type list says in the rules line: brand-free, short. */
const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
}

type Notice = { tone: 'ok' | 'error'; key: string; values?: Record<string, string> }

/**
 * Files attached to a student (OOC-143) — the same list in the panel's student
 * file and in the student's own portal: sent from either side, with who sent
 * it. Never an issued document, and the notice saying so always shows.
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
}: {
  scope: AttachmentScope
  /** First list, read on the server. Null when the API failed. */
  initial: AttachmentList | null
  /** Which surface's titles and empty state. */
  variant: 'staff' | 'portal'
  canUpload: boolean
  canRemove: boolean
}) {
  const t = useTranslations('attachments')
  const locale = useLocale() as Locale
  const fileInput = useRef<HTMLInputElement>(null)

  const [list, setList] = useState<AttachmentList | null>(initial)
  const [adding, setAdding] = useState(false)
  const [category, setCategory] = useState<AttachmentCategory>('national_id')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

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
      ) : list.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm font-semibold text-ink">{t(`empty_${variant}_title`)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t(`empty_${variant}_body`)}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {list.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="text-sm font-semibold text-ink">{t(`category.${item.category}`)}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.originalName}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('meta', {
                      size: formatFileSize(item.sizeBytes, locale),
                      source: t(`source.${item.source}`),
                      date: formatDate(item.uploadedAt, locale),
                    })}
                    {item.uploadedByName && ` · ${t('by', { name: item.uploadedByName })}`}
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

      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  )
}
