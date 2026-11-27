'use client'

import { useEffect, useRef } from 'react'
import { EditorContent, Node, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { PlaceholderNode } from '@/components/backoffice/documents/placeholder-node'
import { docToText, textToDoc } from '@/lib/backoffice/email-template-text'

/** A document of exactly one paragraph: an e-mail block is one line of text. */
const OneLine = Node.create({ name: 'doc', topNode: true, content: 'paragraph' })

/**
 * One block of an e-mail's words (OOC-60): plain text with data dropped in as
 * chips — the same chip the document editor uses, so the person reads
 * "Nombre del alumno" where the API stores `{studentName}`, and moves or
 * deletes it whole. No formatting: the layout of an e-mail is the code's.
 *
 * Controlled from outside by `value`; `onFocusEditor` hands the parent the
 * editor that last had the focus, so the placeholder list inserts there.
 */
export function LineField({
  id,
  value,
  onChange,
  label,
  known,
  readOnly,
  invalid,
  onFocusEditor,
  describedBy,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  /** A placeholder's visible name — from the locale files. */
  label: (name: string) => string
  /** Whether the block may hold that placeholder; unknown ones are marked. */
  known: (name: string) => boolean
  readOnly: boolean
  invalid: boolean
  onFocusEditor?: (editor: Editor) => void
  describedBy?: string
}) {
  const lastText = useRef(value)
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      OneLine,
      StarterKit.configure({
        document: false,
        heading: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        hardBreak: false,
        link: false,
        underline: false,
      }),
      PlaceholderNode.configure({ label, known }),
    ],
    content: textToDoc(value),
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'false',
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        class: 'px-3 py-2 text-sm leading-relaxed',
      },
    },
    onUpdate: ({ editor: current }) => {
      const text = docToText(current.getJSON())
      lastText.current = text
      onChange(text)
    },
    onFocus: ({ editor: current }) => onFocusEditor?.(current),
  })

  /* A value changed from outside (back to the repository's words, another
     version loaded) replaces the line; the value the editor itself just
     produced does not, or the caret would jump on every key. */
  useEffect(() => {
    if (!editor || value === lastText.current) return
    lastText.current = value
    editor.commands.setContent(textToDoc(value), { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  return (
    <div
      className={`email-line rounded-lg border transition focus-within:border-brand-blue ${
        invalid ? 'border-red-400' : 'border-line'
      } ${readOnly ? 'bg-slate-50 text-muted-foreground' : 'bg-white'}`}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
