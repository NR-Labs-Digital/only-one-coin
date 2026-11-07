/**
 * `attachment` with the name the person gave the file: an ASCII fallback for
 * old clients and the UTF-8 form (RFC 6266) for the accents a Peruvian name
 * has. `fallback` is what the ASCII form says when nothing of the name survives.
 */
export function contentDisposition(fileName: string, fallback: string): string {
  const ascii = fileName.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || fallback;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
