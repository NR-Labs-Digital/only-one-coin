/**
 * Opens bytes as a PDF (OOC-81). Five magic bytes say a file *claims* to be a
 * PDF; only a parser says it is one a person can open — an upload cut short,
 * or a header with nothing behind it, passes the first check and fails here.
 * Implemented in `apps/api` with a PDF library; the domain stays library-free.
 */
export interface IPdfInspector {
  /** How many pages the document has, or `null` when it does not open as a PDF. */
  pageCount(bytes: Uint8Array): Promise<number | null>;
}
