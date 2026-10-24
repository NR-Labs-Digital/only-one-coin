'use client'

import { useEffect, useRef } from 'react'

/**
 * The PDF drawn page by page on canvases (pdf.js), not in an iframe: a phone
 * browser does not show a PDF inside a page, and the person editing has to
 * see the real document wherever they are. pdf.js is loaded on demand — only
 * this screen pays for it — and its worker comes from our own origin
 * (`worker-src 'self'` in the CSP).
 */
export function PdfPages({
  pdf,
  label,
  onRendered,
}: {
  pdf: Uint8Array
  /** Accessible name of each page — "Página 1 de 2". */
  label: (page: number, pages: number) => string
  onRendered?: () => void
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const host = container.current
    if (!host) return

    async function draw(target: HTMLDivElement) {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

      // pdf.js takes ownership of the buffer it reads; give it a copy.
      const task = pdfjs.getDocument({ data: pdf.slice() })
      const document = await task.promise
      if (cancelled) return void task.destroy()

      const width = target.clientWidth
      const ratio = window.devicePixelRatio || 1
      const canvases: HTMLCanvasElement[] = []
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number)
        const scale = width / page.getViewport({ scale: 1 }).width
        const viewport = page.getViewport({ scale: scale * ratio })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = '100%'
        canvas.className = 'rounded-sm bg-white shadow-sm ring-1 ring-line'
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', label(number, document.numPages))
        await page.render({ canvas, viewport }).promise
        if (cancelled) return void task.destroy()
        canvases.push(canvas)
      }
      // Swap all pages at once, so the old preview stays up until the new one is whole.
      target.replaceChildren(...canvases)
      void task.destroy()
      onRendered?.()
    }

    draw(host).catch(() => {
      /* A PDF that does not draw leaves the last good preview in place. */
    })
    return () => {
      cancelled = true
    }
  }, [pdf, label, onRendered])

  return <div ref={container} className="flex flex-col gap-4" />
}
