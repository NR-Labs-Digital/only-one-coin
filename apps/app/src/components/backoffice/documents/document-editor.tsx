'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { BoIcon, type BoIconName } from '@/components/backoffice/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  bodyToEditorHtml,
  editorHtmlToBody,
  type DocumentTemplateIssue,
} from '@/lib/backoffice/document-body'
import { DOCUMENT_FIELDS, fieldOfExpression } from '@/lib/backoffice/document-fields'
import type { DocumentKind, DocumentTemplateView } from '@/lib/backoffice/document-templates'
import { PlaceholderNode } from './placeholder-node'
import { PdfPages } from './pdf-pages'

/** How long the text has to stay still before the preview is rebuilt. */
const PREVIEW_DEBOUNCE_MS = 900

type Pane = 'edit' | 'preview'
const PANES: readonly Pane[] = ['edit', 'preview']

type PreviewFailure = 'has_issues' | 'missing_value' | 'unavailable' | 'failed'
type ActionFailure = 'save_failed' | 'publish_failed' | 'publish_conflict'

/** The API's `reason` on a preview, reduced to what the pane says (CLAUDE.md §4). */
function previewFailureOf(status: number, reason: string | undefined): PreviewFailure {
  if (reason === 'document_template.has_issues') return 'has_issues'
  if (reason === 'document_template.missing_value') return 'missing_value'
  if (status === 503) return 'unavailable'
  return 'failed'
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Lima',
  }).format(new Date(iso))
}

/**
 * The visual editor of a document template (OOC-123). Whoever edits writes
 * text — bold, headings, lists, alignment — and drops data in as chips picked
 * from a list; no HTML, CSS or Liquid on screen. Beside it, the real PDF,
 * rebuilt a moment after the typing stops by the same pipeline that prints the
 * document. Saving keeps a draft (even a wrong one); publishing makes it the
 * text every new document comes from.
 *
 * Management only — the page checks the role, and the API refuses anyone else.
 */
export function DocumentEditor({ kind, view }: { kind: DocumentKind; view: DocumentTemplateView }) {
  const t = useTranslations('bo')
  const locale = useLocale()

  const initialBody = view.draft?.body ?? view.published?.body ?? view.starterBody
  const [body, setBody] = useState(initialBody)
  /** The last body the API accepted as the draft — what "unsaved changes" compares against. */
  const [savedBody, setSavedBody] = useState(view.draft?.body ?? null)
  const [savedAt, setSavedAt] = useState(view.draft?.updatedAt ?? null)
  const [issues, setIssues] = useState<DocumentTemplateIssue[]>(view.draft?.issues ?? [])
  const [published, setPublished] = useState(view.published)
  const [publishedBody, setPublishedBody] = useState(view.published?.body ?? null)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [actionError, setActionError] = useState<ActionFailure | null>(null)
  const [notice, setNotice] = useState<'saved' | 'published' | 'unchanged' | null>(null)

  const [pane, setPane] = useState<Pane>('edit')
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [previewPending, setPreviewPending] = useState(true)
  const [previewError, setPreviewError] = useState<PreviewFailure | null>(null)

  /** Edited since the text it opened with or last saved — what the save button is for. */
  const dirty = body !== (savedBody ?? initialBody)
  const differsFromPublished = savedBody !== null && savedBody !== publishedBody

  const labelOf = useCallback(
    (expression: string) => {
      const field = fieldOfExpression(kind, expression)
      return field ? t(`documents.fields.${field.path}`) : t('documents.unknown_field')
    },
    [kind, t],
  )

  const editor = useEditor({
    immediatelyRender: false,
    // The toolbar reads bold/aligned/… straight from the editor on every render.
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        link: false,
        heading: { levels: [1, 2, 3] },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      PlaceholderNode.configure({
        label: labelOf,
        known: (expression) => fieldOfExpression(kind, expression) !== null,
      }),
    ],
    content: bodyToEditorHtml(initialBody),
    editorProps: {
      attributes: {
        'aria-label': t('documents.editor_label'),
        class: 'px-5 py-4',
      },
    },
    onUpdate: ({ editor: current }) => {
      setBody(editorHtmlToBody(current.getHTML()))
      setNotice(null)
    },
  })

  /* The preview follows the text: a moment after the typing stops, the API
     prints what is on screen (unsaved) with the sample data. A newer request
     cancels the one still running, so a slow answer never paints over a
     newer one. */
  useEffect(() => {
    const controller = new AbortController()
    setPreviewPending(true)
    async function refresh() {
      try {
        const response = await fetch(`/api/v1/document-templates/${kind}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { reason?: string } | null
          setPreviewError(previewFailureOf(response.status, failure?.reason))
          setPreviewPending(false)
          return
        }
        const answer = (await response.json()) as { pdf: string }
        setPreviewError(null)
        // The text on screen prints, so nothing listed against an older save still stands.
        setIssues([])
        setPdf(decodeBase64(answer.pdf))
      } catch {
        if (controller.signal.aborted) return
        setPreviewError('failed')
        setPreviewPending(false)
      }
    }
    const timer = window.setTimeout(() => void refresh(), PREVIEW_DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [body, kind])

  const onRendered = useCallback(() => setPreviewPending(false), [])
  const pageLabel = useCallback(
    (page: number, pages: number) => t('documents.preview_page', { page, pages }),
    [t],
  )

  /* Leaving with unsaved text asks first — the browser's own prompt. */
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  async function save(): Promise<DocumentTemplateIssue[] | null> {
    setSaving(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/document-templates/${kind}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!response.ok) {
        setActionError('save_failed')
        return null
      }
      const draft = (await response.json()) as { body: string; updatedAt: string; issues: DocumentTemplateIssue[] }
      // What was sent is what the screen shows; the API's copy differs only in
      // how it writes the markup, so comparing against it would never settle.
      setSavedBody(body)
      setSavedAt(draft.updatedAt)
      setIssues(draft.issues)
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
    // Publishing reads the saved draft, so what is on screen is saved first.
    const found = dirty || savedBody === null ? await save() : issues
    if (found === null || found.length > 0) return

    setPublishing(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/document-templates/${kind}/publish`, { method: 'POST' })
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { reason?: string } | null
        setActionError(failure?.reason === 'document_template.publish_conflict' ? 'publish_conflict' : 'publish_failed')
        return
      }
      const version = (await response.json()) as { version: number; publishedAt: string }
      setNotice(published?.version === version.version ? 'unchanged' : 'published')
      setPublished({ version: version.version, publishedAt: version.publishedAt, body: savedBody ?? body })
      setPublishedBody(savedBody ?? body)
    } catch {
      setActionError('publish_failed')
    } finally {
      setPublishing(false)
    }
  }

  const busy = saving || publishing

  const editorPane = (
    <section
      aria-label={t('documents.editor_label')}
      className={`${pane === 'edit' ? 'flex' : 'hidden'} min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white @4xl/page:flex`}
    >
      <Toolbar editor={editor} kind={kind} labelOf={labelOf} />
      <div className="doc-editor min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </section>
  )

  const previewPane = (
    <section
      aria-label={t('documents.preview_label')}
      aria-busy={previewPending}
      className={`${pane === 'preview' ? 'flex' : 'hidden'} relative min-w-0 flex-col rounded-xl border border-line bg-slate-100 @4xl/page:flex`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-white/80 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('documents.preview_title')}
        </span>
        <span className="text-xs text-muted-foreground">{t('documents.preview_sample')}</span>
      </div>
      <div className="relative min-h-[24rem] flex-1 overflow-y-auto p-4">
        {pdf && (
          <div className={previewPending ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
            <PdfPages pdf={pdf} label={pageLabel} onRendered={onRendered} />
          </div>
        )}
        {previewPending && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center" aria-live="polite">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-ink shadow-md ring-1 ring-line">
              <BoIcon name="spinner" size={14} className="animate-spin text-brand-blue" />
              {t('documents.preview_pending')}
            </span>
          </div>
        )}
        {previewError && !previewPending && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {t(`documents.preview_error_${previewError}`)}
          </p>
        )}
      </div>
    </section>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* State and actions — one line on a wide column, wrapping on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">
            {published
              ? t('documents.published_version', {
                  version: published.version,
                  date: formatDateTime(published.publishedAt, locale),
                })
              : t('documents.never_published')}
          </span>
          <span className="text-xs text-muted-foreground">
            {dirty
              ? t('documents.unsaved_changes')
              : savedAt
                ? t('documents.draft_saved', { date: formatDateTime(savedAt, locale) })
                : null}
            {!dirty && differsFromPublished ? ` · ${t('documents.draft_not_published')}` : null}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => void save()}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BoIcon name={saving ? 'spinner' : 'check'} size={16} className={saving ? 'animate-spin' : undefined} />
            {t('documents.save_draft')}
          </button>
          <button
            type="button"
            disabled={busy || (!dirty && !differsFromPublished && published !== null)}
            onClick={() => setConfirmPublish(true)}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
          >
            <BoIcon
              name={publishing ? 'spinner' : 'external'}
              size={16}
              className={publishing ? 'animate-spin' : undefined}
            />
            {t('documents.publish')}
          </button>
        </div>
      </div>

      {confirmPublish && (
        <div
          role="alertdialog"
          aria-label={t('documents.publish_confirm_title')}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-blue/30 bg-sky-soft px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-sm text-ink">{t('documents.publish_confirm_body')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirmPublish(false)}
              className="min-h-tap rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('documents.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              className="min-h-tap rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
            >
              {t('documents.publish_confirm')}
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
          {actionError ? t(`documents.error_${actionError}`) : t(`documents.notice_${notice}`)}
        </p>
      )}

      {issues.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">{t('documents.issues_title')}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-700">
            {issues.map((issue, index) => (
              <li key={index}>{t(`documents.issue_${issueKey(issue.code)}`)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* On a narrow column the two panes take turns; side by side from @4xl. */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 @4xl/page:hidden" role="tablist">
        {PANES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={pane === value}
            onClick={() => setPane(value)}
            className={`min-h-tap flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${
              pane === value ? 'bg-white text-ink shadow-sm' : 'text-muted-foreground'
            }`}
          >
            {t(value === 'edit' ? 'documents.tab_edit' : 'documents.tab_preview')}
          </button>
        ))}
      </div>

      <div className="grid gap-4 @4xl/page:h-[calc(100dvh-16rem)] @4xl/page:min-h-[32rem] @4xl/page:grid-cols-2">
        {editorPane}
        {previewPane}
      </div>
    </div>
  )
}

const ISSUE_KEYS = ['syntax_error', 'unknown_variable', 'unknown_filter', 'forbidden_tag', 'too_large'] as const

function issueKey(code: string): (typeof ISSUE_KEYS)[number] | 'other' {
  return (ISSUE_KEYS as readonly string[]).includes(code) ? (code as (typeof ISSUE_KEYS)[number]) : 'other'
}

function ToolButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: BoIconName
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-brand-blue/10 text-brand-blue-deep' : 'text-muted-foreground hover:bg-sky-soft hover:text-ink'
      }`}
    >
      <BoIcon name={icon} size={18} />
    </button>
  )
}

/** The formatting a document needs, and the list of data to drop in. Nothing else. */
function Toolbar({
  editor,
  kind,
  labelOf,
}: {
  editor: Editor | null
  kind: DocumentKind
  labelOf: (expression: string) => string
}) {
  const t = useTranslations('bo')
  const groups = useMemo(() => DOCUMENT_FIELDS[kind], [kind])
  if (!editor) return <div className="h-[3.25rem] border-b border-line" />
  const state = {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    h1: editor.isActive('heading', { level: 1 }),
    h2: editor.isActive('heading', { level: 2 }),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    left: editor.isActive({ textAlign: 'left' }),
    center: editor.isActive({ textAlign: 'center' }),
    right: editor.isActive({ textAlign: 'right' }),
    justify: editor.isActive({ textAlign: 'justify' }),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  }
  const chain = () => editor.chain().focus()

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger className="mr-1 inline-flex min-h-9 items-center gap-1.5 rounded-md bg-brand-blue px-3 text-sm font-semibold text-white transition hover:bg-brand-blue-deep">
          <BoIcon name="tag" size={16} />
          {t('documents.insert_field')}
          <BoIcon name="chevron-down" size={14} />
        </DropdownMenuTrigger>
        {/* Back to the text after picking, not to this button: the next keystroke belongs to the document. */}
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-72 p-1.5"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            editor.commands.focus()
          }}
        >
          {groups.map((group, index) => (
            <div key={group.key}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`documents.groups.${group.key}`)}
              </DropdownMenuLabel>
              {group.fields.map((field) => (
                <DropdownMenuItem
                  key={field.path}
                  className="px-2 py-2 text-sm"
                  onSelect={() => chain().insertPlaceholder(field.expression).run()}
                >
                  {labelOf(field.expression)}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ToolButton icon="bold" label={t('documents.tool_bold')} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton icon="italic" label={t('documents.tool_italic')} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolButton
        icon="underline"
        label={t('documents.tool_underline')}
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ToolButton
        icon="heading-1"
        label={t('documents.tool_title')}
        active={state.h1}
        onClick={() => chain().toggleHeading({ level: 1 }).run()}
      />
      <ToolButton
        icon="heading-2"
        label={t('documents.tool_subtitle')}
        active={state.h2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        icon="list-bullet"
        label={t('documents.tool_bullets')}
        active={state.bullet}
        onClick={() => chain().toggleBulletList().run()}
      />
      <ToolButton
        icon="list-ordered"
        label={t('documents.tool_numbers')}
        active={state.ordered}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ToolButton
        icon="align-left"
        label={t('documents.tool_align_left')}
        active={state.left}
        onClick={() => chain().setTextAlign('left').run()}
      />
      <ToolButton
        icon="align-center"
        label={t('documents.tool_align_center')}
        active={state.center}
        onClick={() => chain().setTextAlign('center').run()}
      />
      <ToolButton
        icon="align-right"
        label={t('documents.tool_align_right')}
        active={state.right}
        onClick={() => chain().setTextAlign('right').run()}
      />
      <ToolButton
        icon="align-justify"
        label={t('documents.tool_align_justify')}
        active={state.justify}
        onClick={() => chain().setTextAlign('justify').run()}
      />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <ToolButton icon="undo" label={t('documents.tool_undo')} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <ToolButton icon="redo" label={t('documents.tool_redo')} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
    </div>
  )
}
