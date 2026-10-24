import { LEGAL_IDENTITY } from "@ooc/domain";
import copy from "./locales/es-PE.json" with { type: "json" };

/**
 * The fixed part of every generated document (OOC-123): page size, margins,
 * type, the running header with the legal identity and the page count. It is
 * code, on purpose — whoever edits a template in the backoffice edits the
 * text, never the layout, and a page that breaks is our bug, not theirs.
 *
 * The body is the rendered template (HTML from the editor, already sanitized
 * and filled by the engine). Nothing here points at a URL: WeasyPrint would
 * fetch it, and a document render must never reach the network.
 */
export function frameDocument(bodyHtml: string): string {
  const header = `${escapeHtml(LEGAL_IDENTITY.legalName)} · ${escapeHtml(copy.frame.ruc)} ${escapeHtml(LEGAL_IDENTITY.ruc)}`;
  return `<!doctype html>
<html lang="es-PE">
<head>
<meta charset="utf-8">
<style>
@page {
  size: A4;
  margin: 2.6cm 2.2cm 2.4cm;
  @top-center { content: element(running-header); }
  @bottom-center {
    content: ${cssString(copy.frame.page)} " " counter(page) " " ${cssString(copy.frame.pageOf)} " " counter(pages);
    font-size: 8.5pt;
    color: #555;
  }
}
html { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #111; }
.running-header { position: running(running-header); font-size: 8.5pt; color: #555; border-bottom: 0.5pt solid #999; padding-bottom: 4pt; width: 100%; text-align: center; }
h1 { font-size: 14pt; margin: 0 0 12pt; }
h2 { font-size: 11.5pt; margin: 14pt 0 6pt; }
h3 { font-size: 10.5pt; margin: 12pt 0 4pt; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
blockquote { margin: 0 0 8pt 12pt; padding-left: 8pt; border-left: 1.5pt solid #bbb; }
hr { border: 0; border-top: 0.5pt solid #999; margin: 12pt 0; }
h1, h2, h3 { page-break-after: avoid; }
</style>
</head>
<body>
<div class="running-header">${header}</div>
<main>${bodyHtml}</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** A CSS string literal; the copy is ours, but quoting it properly costs nothing. */
function cssString(value: string): string {
  return `"${value.replace(/["\\\n]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `)}"`;
}
