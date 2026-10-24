import { mergeAttributes, Node } from '@tiptap/react'

export interface PlaceholderNodeOptions {
  /** The chip's visible name for an expression — from the locale files. */
  label: (expression: string) => string
  /** Whether the expression is one the editor offers; unknown ones are marked. */
  known: (expression: string) => boolean
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    placeholder: {
      insertPlaceholder: (expression: string) => ReturnType
    }
  }
}

/**
 * A piece of data inside the text (OOC-123): an inline atom, so it is moved
 * and deleted whole and nobody ends up with half of `{{ teacher.fullName }}`.
 * Serialized as `<span data-placeholder="…">`, which `editorHtmlToBody` turns
 * back into the Liquid the API stores.
 */
export const PlaceholderNode = Node.create<PlaceholderNodeOptions>({
  name: 'placeholder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { label: (expression) => expression, known: () => true }
  },

  addAttributes() {
    return {
      expression: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-placeholder') ?? '',
        renderHTML: (attributes: { expression: string }) => ({ 'data-placeholder': attributes.expression }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-placeholder]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), this.options.label(node.attrs.expression as string)]
  },

  addNodeView() {
    return ({ node }) => {
      const expression = node.attrs.expression as string
      const dom = document.createElement('span')
      dom.className = this.options.known(expression) ? 'doc-chip' : 'doc-chip doc-chip-unknown'
      dom.contentEditable = 'false'
      dom.textContent = this.options.label(expression)
      return { dom }
    }
  },

  addCommands() {
    return {
      insertPlaceholder:
        (expression) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { expression } },
            { type: 'text', text: ' ' },
          ]),
    }
  },
})
