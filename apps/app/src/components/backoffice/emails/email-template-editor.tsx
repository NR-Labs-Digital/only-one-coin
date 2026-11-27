'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { Editor } from '@tiptap/react'
import type { EmailLocale } from '@/lib/backoffice/types'
import type { Locale } from '@/lib/format'
import {
  EMAIL_EDITOR_LOCALES,
  ITEMS_PARAGRAPH,
  cloneContent,
  type EmailCopy,
  type EmailTemplateContent,
  type EmailTemplateIssue,
  type EmailTemplateVersionView,
  type EmailTemplateView,
} from '@/lib/backoffice/email-template-text'
import { sendEmailProof } from '@/lib/backoffice/email-proof-client'
import { Card, SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { HelpHint } from '@/components/backoffice/help-hint'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { ProofSend } from '@/app/[locale]/backoffice/(panel)/(gated)/emails/proof-send'
import { LineField } from './line-field'

const ROUTE_LOCALE: Record<EmailLocale, Locale> = { 'es-PE': 'es', 'pt-BR': 'pt', en: 'en' }

/** How long the words have to stay still before the preview is rebuilt. */
const PREVIEW_DEBOUNCE_MS = 700

type Preview = { subject: string; html: string; to: string }
type ActionFailure = 'save_failed' | 'publish_failed' | 'publish_conflict'
type Notice = 'saved' | 'published' | 'unchanged' | 'reverted'
type Scope = 'top' | 'item' | 'none'

/** The one-line blocks of an e-mail, and which data each may hold. */
type SimpleField = 'subject' | 'preheader' | 'item' | 'action' | 'missing'
const F = { subject: 'subject', preheader: 'preheader', item: 'item', action: 'action', missing: 'missing' } as const
const SCOPE: Record<SimpleField, Scope> = { subject: 'top', preheader: 'top', item: 'item', action: 'none', missing: 'none' }
const PARAGRAPHS = 'paragraphs'

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(new Date(iso))
}

const same = (a: EmailTemplateContent | null, b: EmailTemplateContent | null) =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * The words of one automatic e-mail, edited in the panel (OOC-60). Each block
 * of the message — subject, preview line, paragraphs, button, list line,
 * the words for codes — is a line of text with data dropped in as chips;
 * the layout, the greeting, the signature and the button's link stay in the
 * code. Beside it, the real e-mail, rendered by the API over sample data a
 * moment after the typing stops.
 *
 * Saving keeps a draft (even a wrong one); publishing makes it what every
 * e-mail of this kind says from then on, in the three languages at once.
 * Who reads the e-mail section sees the editor read-only; only who holds the
 * edit permission saves and publishes — the API checks the same.
 */
export function EmailTemplateEditor({
  view,
  canEdit,
  canSendProof,
}: {
  view: EmailTemplateView
  canEdit: boolean
  canSendProof: boolean
}) {
  const t = useTranslations('bo')
  const tRoot = useTranslations()
  const locale = useLocale() as Locale
  const template = view.key

  const initial = view.draft?.content ?? view.published?.content ?? view.repository
  const [content, setContent] = useState<EmailTemplateContent>(() => cloneContent(initial))
  /** The last content the API accepted as the draft. */
  const [saved, setSaved] = useState<EmailTemplateContent | null>(view.draft?.content ?? null)
  const [savedAt, setSavedAt] = useState(view.draft?.updatedAt ?? null)
  const [issues, setIssues] = useState<EmailTemplateIssue[]>(view.draft?.issues ?? [])
  const [warnings, setWarnings] = useState<EmailTemplateIssue[]>(view.draft?.warnings ?? [])
  const [versions, setVersions] = useState<EmailTemplateVersionView[]>(view.versions)
  const published = versions[0] ?? null

  const [shown, setShown] = useState<EmailLocale>(
    EMAIL_EDITOR_LOCALES.find((item) => ROUTE_LOCALE[item] === locale) ?? 'es-PE',
  )
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewIssues, setPreviewIssues] = useState<EmailTemplateIssue[]>([])
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewPending, setPreviewPending] = useState(true)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [actionError, setActionError] = useState<ActionFailure | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const dirty = !same(content, saved ?? initial)
  const draftDiffersFromPublished = saved !== null && !same(saved, published?.content ?? null)
  const copy = content[shown]
  const repositoryCopy = view.repository[shown]

  /* The editor last focused, and which data it may hold — where a click on
     the data list drops the chip. */
  const focused = useRef<{ editor: Editor; scope: Scope } | null>(null)
  const [focusedScope, setFocusedScope] = useState<Scope>('top')

  const labelOf = useCallback(
    (name: string) => (t.has(`email_editor.placeholder.${name}`) ? t(`email_editor.placeholder.${name}`) : t('email_editor.placeholder_unknown')),
    [t],
  )
  const knownIn = useCallback(
    (scope: Scope) => (name: string) =>
      scope === 'top' ? view.placeholders.names.includes(name) : scope === 'item' ? view.placeholders.itemNames.includes(name) : false,
    [view.placeholders],
  )

  /* The preview follows the words on screen in the language on screen. A
     newer request cancels the one still running. */
  useEffect(() => {
    const controller = new AbortController()
    setPreviewPending(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/v1/emails/templates/${template}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale: shown, content }),
            signal: controller.signal,
          })
          if (response.status === 422) {
            const body = (await response.json()) as { issues: EmailTemplateIssue[] }
            setPreviewIssues(body.issues)
            setPreviewFailed(false)
          } else if (response.ok) {
            setPreview((await response.json()) as Preview)
            setPreviewIssues([])
            setPreviewFailed(false)
          } else {
            setPreviewFailed(true)
          }
        } catch {
          if (controller.signal.aborted) return
          setPreviewFailed(true)
        }
        setPreviewPending(false)
      })()
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [content, shown, template])

  /* Leaving with unsaved words asks first — the browser's own prompt. */
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirtyRef.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  function update(change: (draft: EmailCopy) => void) {
    setContent((current) => {
      const next = cloneContent(current)
      const target = next[shown] ?? cloneContent({ [shown]: view.repository[shown] })[shown]!
      change(target)
      next[shown] = target
      return next
    })
    setNotice(null)
  }

  function moveParagraph(index: number, by: -1 | 1) {
    update((draft) => {
      const to = index + by
      if (to < 0 || to >= draft.paragraphs.length) return
      const [moved] = draft.paragraphs.splice(index, 1)
      draft.paragraphs.splice(to, 0, moved!)
    })
  }

  async function save(): Promise<EmailTemplateIssue[] | null> {
    setSaving(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/emails/templates/${template}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!response.ok) {
        setActionError('save_failed')
        return null
      }
      const draft = (await response.json()) as {
        updatedAt: string
        issues: EmailTemplateIssue[]
        warnings: EmailTemplateIssue[]
      }
      setSaved(cloneContent(content))
      setSavedAt(draft.updatedAt)
      setIssues(draft.issues)
      setWarnings(draft.warnings)
      setNotice('saved')
      return draft.issues
    } catch {
      setActionError('save_failed')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setConfirmPublish(false)
    // Publishing reads the saved draft, so the words on screen are saved first.
    const found = dirty || saved === null ? await save() : issues
    if (found === null || found.length > 0) return

    setPublishing(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/emails/templates/${template}/publish`, { method: 'POST' })
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { reason?: string } | null
        setActionError(failure?.reason === 'email_template.publish_conflict' ? 'publish_conflict' : 'publish_failed')
        return
      }
      const result = (await response.json()) as { version: number; publishedAt: string; published: boolean }
      setNotice(result.published ? 'published' : 'unchanged')
      if (result.published) {
        setVersions((current) => [
          {
            id: `local-${result.version}`,
            version: result.version,
            content: cloneContent(saved ?? content),
            publishedAt: result.publishedAt,
            publishedByName: null,
            repositoryChanged: false,
          },
          ...current,
        ])
      }
    } catch {
      setActionError('publish_failed')
    } finally {
      setPublishing(false)
    }
  }

  function revertToRepository() {
    setContent(cloneContent(view.repository))
    setNotice('reverted')
  }

  const busy = saving || publishing
  const shownIssues = useMemo(
    () => (dirty ? previewIssues : [...issues.filter((issue) => issue.locale === shown || !issue.locale)]),
    [dirty, previewIssues, issues, shown],
  )
  const issuesElsewhere = dirty
    ? []
    : issues.filter((issue) => issue.locale && issue.locale !== shown)
  const invalid = (field: string, index?: number) =>
    shownIssues.some((issue) => issue.field === field && (index === undefined || issue.index === index))

  const fieldLabel = (issue: EmailTemplateIssue): string => {
    if (!issue.field) return ''
    if (issue.field.startsWith('values.')) {
      const [, name = '', code = ''] = issue.field.split('.')
      return t('email_editor.field.value', { data: labelOf(name), code: codeLabel(code) })
    }
    if (issue.field === 'paragraphs' && issue.index !== undefined) {
      return t('email_editor.field.paragraph', { n: issue.index + 1 })
    }
    return t(`email_editor.field.${issue.field}`)
  }
  const codeLabel = (code: string) =>
    t.has(`email_editor.code.${code}`) ? t(`email_editor.code.${code}`) : t('email_editor.placeholder_unknown')
  const issueText = (issue: EmailTemplateIssue) =>
    t(`email_editor.issue.${t.has(`email_editor.issue.${issue.code}`) ? issue.code : 'other'}`, {
      field: fieldLabel(issue),
      data: issue.placeholder ? labelOf(issue.placeholder) : '',
      language: issue.locale ? tRoot(`language.${ROUTE_LOCALE[issue.locale]}`) : '',
    })

  const readOnly = !canEdit
  const dataList = focusedScope === 'item' ? view.placeholders.itemNames : view.placeholders.names
  const fieldWarnings = warnings.filter((warning) => warning.locale === shown)

  const line = (
    id: string,
    value: string,
    onChange: (value: string) => void,
    scope: Scope,
    isInvalid: boolean,
  ) => (
    <LineField
      key={`${shown}-${id}`}
      id={`${shown}-${id}`}
      value={value}
      onChange={onChange}
      label={labelOf}
      known={knownIn(scope)}
      readOnly={readOnly}
      invalid={isInvalid}
      onFocusEditor={(editor) => {
        focused.current = { editor, scope }
        setFocusedScope(scope)
      }}
    />
  )

  const simpleLine = (field: SimpleField) =>
    line(
      field,
      copy?.[field] ?? '',
      (value) => update((draft) => void (draft[field] = value)),
      SCOPE[field],
      invalid(field),
    )

  const repositoryChanged = published?.repositoryChanged ?? false

  return (
    <div className="flex flex-col gap-4">
      {/* State and actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {published
              ? t('email_editor.published_version', {
                  version: published.version,
                  date: formatDateTime(published.publishedAt, locale),
                })
              : t('email_editor.repository_in_force')}
            <HelpHint what={t('help.email_editor_state_what')} how={t('help.email_editor_state_how')} />
          </span>
          <span className="text-xs text-muted-foreground">
            {dirty
              ? t('email_editor.unsaved_changes')
              : savedAt
                ? t('email_editor.draft_saved', { date: formatDateTime(savedAt, locale) })
                : null}
            {!dirty && draftDiffersFromPublished ? ` · ${t('email_editor.draft_not_published')}` : null}
          </span>
          {readOnly && <span className="text-xs font-semibold text-muted-foreground">{t('email_editor.read_only')}</span>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || same(content, view.repository)}
              onClick={revertToRepository}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <BoIcon name="refresh" size={16} />
              {t('email_editor.revert')}
            </button>
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void save()}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <BoIcon name={saving ? 'spinner' : 'check'} size={16} className={saving ? 'animate-spin' : undefined} />
              {t('email_editor.save_draft')}
            </button>
            <button
              type="button"
              disabled={busy || (!dirty && !draftDiffersFromPublished)}
              onClick={() => setConfirmPublish(true)}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
            >
              <BoIcon name={publishing ? 'spinner' : 'external'} size={16} className={publishing ? 'animate-spin' : undefined} />
              {t('email_editor.publish')}
            </button>
          </div>
        )}
      </div>

      {confirmPublish && (
        <div
          role="alertdialog"
          aria-label={t('email_editor.publish_confirm_title')}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-blue/30 bg-sky-soft px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-sm text-ink">{t('email_editor.publish_confirm_body')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirmPublish(false)}
              className="min-h-tap rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('email_editor.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              className="min-h-tap rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
            >
              {t('email_editor.publish_confirm')}
            </button>
          </div>
        </div>
      )}

      {(notice || actionError) && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            actionError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionError ? t(`email_editor.error_${actionError}`) : t(`email_editor.notice_${notice}`)}
        </p>
      )}

      {repositoryChanged && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
          {t('email_editor.repository_changed')}
        </p>
      )}

      {/* Languages */}
      <div role="tablist" aria-label={t('emails.preview_locale_label')} className="flex flex-wrap items-center gap-1.5">
        {EMAIL_EDITOR_LOCALES.map((item) => {
          const on = item === shown
          const flagged = !dirty && issues.some((issue) => issue.locale === item)
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setShown(item)}
              className={`inline-flex min-h-tap items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
                on
                  ? 'border-brand-blue bg-brand-blue text-white'
                  : 'border-line bg-white text-muted-foreground hover:border-brand-yellow hover:bg-cream hover:text-ink'
              }`}
            >
              {tRoot(`language.${ROUTE_LOCALE[item]}`)}
              {flagged && <BoIcon name="alert" size={14} className={on ? 'text-white' : 'text-red-600'} />}
            </button>
          )
        })}
        <HelpHint what={t('help.email_editor_languages_what')} how={t('help.email_editor_languages_how')} />
      </div>

      {(shownIssues.length > 0 || issuesElsewhere.length > 0) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">{t('email_editor.issues_title')}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
            {[...shownIssues, ...issuesElsewhere].map((issue, index) => (
              <li key={index}>{issueText(issue)}</li>
            ))}
          </ul>
        </div>
      )}

      {fieldWarnings.length > 0 && !dirty && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            {t('email_editor.warnings_title')}
            <HelpHint what={t('help.email_editor_dropped_what')} how={t('help.email_editor_dropped_how')} />
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
            {fieldWarnings.map((warning, index) => (
              <li key={index}>{t('email_editor.warning_dropped', { data: labelOf(warning.placeholder ?? '') })}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 @4xl/page:grid-cols-2">
        {/* The words */}
        <section className="flex min-w-0 flex-col gap-4" aria-label={t('email_editor.words_label')}>
          {copy ? (
            <>
              <Block label={t('email_editor.field.subject')} help={t('help.email_editor_subject_what')}>
                {simpleLine(F.subject)}
              </Block>
              <Block label={t('email_editor.field.preheader')} help={t('help.email_editor_preheader_what')}>
                {simpleLine(F.preheader)}
              </Block>

              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  {t('email_editor.field.paragraphs')}
                  <HelpHint what={t('help.email_editor_paragraphs_what')} how={t('help.email_editor_paragraphs_how')} />
                </span>
                <p className="text-xs text-muted-foreground">{t('email_editor.greeting_note')}</p>
                {copy.paragraphs.map((paragraph, index) => (
                  <div key={`${shown}-p-${index}-${copy.paragraphs.length}`} className="flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      {paragraph.trim() === ITEMS_PARAGRAPH ? (
                        <p className="rounded-lg border border-dashed border-brand-blue/40 bg-sky-soft px-3 py-2 text-sm text-brand-blue-deep">
                          {t('email_editor.list_paragraph')}
                        </p>
                      ) : (
                        line(
                          `p-${index}-${copy.paragraphs.length}`,
                          paragraph,
                          (value) => update((draft) => void (draft.paragraphs[index] = value)),
                          'top',
                          invalid(PARAGRAPHS, index),
                        )
                      )}
                    </div>
                    {canEdit && (
                      <span className="flex shrink-0 items-center">
                        <IconButton
                          icon="chevron-down"
                          flip
                          label={t('email_editor.move_up')}
                          disabled={index === 0}
                          onClick={() => moveParagraph(index, -1)}
                        />
                        <IconButton
                          icon="chevron-down"
                          label={t('email_editor.move_down')}
                          disabled={index === copy.paragraphs.length - 1}
                          onClick={() => moveParagraph(index, 1)}
                        />
                        {paragraph.trim() !== ITEMS_PARAGRAPH && (
                          <IconButton
                            icon="trash"
                            label={t('email_editor.remove_paragraph')}
                            disabled={copy.paragraphs.length === 1}
                            onClick={() => update((draft) => void draft.paragraphs.splice(index, 1))}
                          />
                        )}
                      </span>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => update((draft) => void draft.paragraphs.push(''))}
                    className="inline-flex min-h-tap w-fit items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-brand-blue hover:text-ink"
                  >
                    <BoIcon name="plus" size={16} />
                    {t('email_editor.add_paragraph')}
                  </button>
                )}
              </div>

              {repositoryCopy.item !== undefined && (
                <Block label={t('email_editor.field.item')} help={t('help.email_editor_item_what')}>
                  {simpleLine(F.item)}
                </Block>
              )}
              {repositoryCopy.action !== undefined && (
                <Block label={t('email_editor.field.action')} help={t('help.email_editor_action_what')}>
                  {simpleLine(F.action)}
                </Block>
              )}
              {repositoryCopy.missing !== undefined && (
                <Block label={t('email_editor.field.missing')} help={t('help.email_editor_missing_what')}>
                  {simpleLine(F.missing)}
                </Block>
              )}
              {repositoryCopy.values && (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    {t('email_editor.values_title')}
                    <HelpHint what={t('help.email_editor_values_what')} />
                  </span>
                  {Object.entries(repositoryCopy.values).flatMap(([name, labels]) =>
                    Object.keys(labels).map((code) => (
                      <Block key={`${name}.${code}`} label={t('email_editor.field.value', { data: labelOf(name), code: codeLabel(code) })}>
                        {line(
                          `v-${name}-${code}`,
                          copy.values?.[name]?.[code] ?? '',
                          (value) =>
                            update((draft) => {
                              draft.values = { ...draft.values, [name]: { ...draft.values?.[name], [code]: value } }
                            }),
                          'none',
                          invalid(`values.${name}.${code}`),
                        )}
                      </Block>
                    )),
                  )}
                </div>
              )}

              {canEdit && focusedScope !== 'none' && dataList.length > 0 && (
                <Card className="sticky bottom-3 flex flex-col gap-2 p-3 shadow-md">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(focusedScope === 'item' ? 'email_editor.data_item_title' : 'email_editor.data_title')}
                    <HelpHint what={t('help.email_editor_data_what')} how={t('help.email_editor_data_how')} />
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {dataList.map((name) => (
                      <button
                        key={name}
                        type="button"
                        // Keep the focus in the line, so the chip lands at the caret.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => focused.current?.editor.chain().focus().insertPlaceholder(name).run()}
                        className="doc-chip min-h-tap cursor-pointer text-sm"
                      >
                        {labelOf(name)}
                      </button>
                    ))}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Card className="flex flex-col gap-3 p-5">
              <p className="text-sm text-muted-foreground">{t('email_editor.locale_missing')}</p>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => update(() => undefined)}
                  className="min-h-tap w-fit rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink"
                >
                  {t('email_editor.start_from_repository')}
                </button>
              )}
            </Card>
          )}
        </section>

        {/* The e-mail */}
        <section className="flex min-w-0 flex-col gap-3" aria-label={t('emails.preview_title')} aria-busy={previewPending}>
          <SectionTitle icon="doc">{t('emails.preview_title')}</SectionTitle>
          <Card className="overflow-hidden">
            {preview && previewIssues.length === 0 && !previewFailed ? (
              <div className={previewPending ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                <div className="flex flex-col gap-2 border-b border-line bg-sky-soft px-5 py-4">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">{t('emails.preview_to')}</span>
                    <span className="break-all text-ink">{preview.to}</span>
                  </p>
                  <p className="text-base font-semibold text-ink">{preview.subject}</p>
                </div>
                <iframe
                  title={t('emails.preview_frame_title', { language: tRoot(`language.${ROUTE_LOCALE[shown]}`) })}
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-[34rem] w-full bg-white"
                />
              </div>
            ) : (
              <p className="flex items-start gap-2 p-5 text-sm text-muted-foreground">
                <BoIcon
                  name={previewPending ? 'spinner' : 'alert'}
                  size={16}
                  className={`mt-0.5 shrink-0 ${previewPending ? 'animate-spin' : ''}`}
                />
                {previewPending
                  ? t('email_editor.preview_pending')
                  : previewFailed
                    ? t('emails.preview_load_error')
                    : t('email_editor.preview_has_issues')}
              </p>
            )}
          </Card>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t('email_editor.preview_note')}
          </p>

          {canSendProof && (
            <section className="flex flex-col gap-3">
              <span className="flex items-center gap-1.5">
                <SectionTitle icon="email">{t('email_editor.proof_title')}</SectionTitle>
                <HelpHint what={t('help.email_editor_proof_what')} />
              </span>
              {saved === null || dirty || issues.length > 0 ? (
                <p className="text-sm text-muted-foreground">{t('email_editor.proof_needs_saved')}</p>
              ) : (
                <ProofSend
                  send={(recipients) => sendEmailProof(template, shown, recipients, { draft: true })}
                  onSent={(count) => setToast(t('emails.test_toast', { count }))}
                />
              )}
            </section>
          )}

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="flex items-center gap-1.5">
              <SectionTitle icon="clock">{t('email_editor.versions_title')}</SectionTitle>
              <HelpHint what={t('help.email_editor_versions_what')} />
            </span>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('email_editor.versions_empty')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {versions.map((version, index) => (
                  <li key={version.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    <StatusBadge
                      tone={index === 0 ? 'success' : 'neutral'}
                      dot={false}
                      label={t('email_editor.version_number', { version: version.version })}
                    />
                    <span className="text-muted-foreground">
                      {version.publishedByName
                        ? t('email_editor.version_by', {
                            date: formatDateTime(version.publishedAt, locale),
                            name: version.publishedByName,
                          })
                        : formatDateTime(version.publishedAt, locale)}
                    </span>
                    {index === 0 && <span className="text-xs font-semibold text-emerald-700">{t('email_editor.version_in_force')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      </div>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

function Block({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {label}
        {help && <HelpHint what={help} />}
      </span>
      {children}
    </div>
  )
}

function IconButton({
  icon,
  label,
  disabled,
  onClick,
  flip,
}: {
  icon: 'chevron-down' | 'trash'
  flip?: boolean
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg text-muted-foreground transition hover:bg-sky-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
    >
      <BoIcon name={icon} size={16} className={flip ? 'rotate-180' : undefined} />
    </button>
  )
}
