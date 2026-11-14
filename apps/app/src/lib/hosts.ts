/**
 * The two custom domains of this one Vercel project (CLAUDE.md §7, "Dois
 * domínios, um deploy"). Edge-safe: plain constants, read by the middleware.
 *
 * `student.*` serves the app root (portal and public checkout); `backoffice.*`
 * is rewritten under `/backoffice`, so a public path such as `/enrollment`
 * does not exist on it.
 */
export const BACKOFFICE_HOST = 'backoffice.onlyonecoin.edu.pe'
export const STUDENT_HOST = 'student.onlyonecoin.edu.pe'

/**
 * Where a public page (the checkout) lives, seen from the page the reader is
 * on. On the backoffice domain that is the student domain; anywhere else —
 * local, Vercel preview, staging — the app serves both from one origin.
 */
export function publicAppOrigin(currentOrigin: string): string {
  try {
    if (new URL(currentOrigin).host === BACKOFFICE_HOST) return `https://${STUDENT_HOST}`
  } catch {
    // Not a URL — keep what came in rather than invent one.
  }
  return currentOrigin
}
