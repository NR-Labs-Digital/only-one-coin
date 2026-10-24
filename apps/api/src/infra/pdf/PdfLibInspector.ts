import type { IPdfInspector } from "@ooc/domain";
import { PDFDocument } from "pdf-lib";

/**
 * The `IPdfInspector` port, on pdf-lib (OOC-81). A scanned contract may come
 * password-protected for editing; it still opens for reading, so encryption
 * alone is not a refusal. Anything pdf-lib cannot parse is.
 */
export class PdfLibInspector implements IPdfInspector {
  async pageCount(bytes: Uint8Array): Promise<number | null> {
    try {
      const document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return document.getPageCount();
    } catch {
      return null;
    }
  }
}
