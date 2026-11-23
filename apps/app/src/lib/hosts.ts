/**
 * The three custom domains of this one Vercel project (apps/app/CLAUDE.md,
 * "Três domínios, um deploy"). Edge-safe: plain constants, read by the
 * middleware (`host-routing.ts`).
 *
 * `student.*` serves the app root (portal and public checkout); `backoffice.*`
 * is rewritten under `/backoffice` and `teacher.*` under `/docente`, so a
 * public path such as `/enrollment` does not exist on either.
 */
export const BACKOFFICE_HOST = 'backoffice.onlyonecoin.edu.pe'
export const STUDENT_HOST = 'student.onlyonecoin.edu.pe'
export const TEACHER_HOST = 'teacher.onlyonecoin.edu.pe'

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

/**
 * Where a staff account's own screens live, seen from the page the reader is
 * on: a `teacher` account's invite and password reset are opened on the
 * teacher domain, so the session they start is the one the teacher portal
 * reads (cookies are per host). Outside production one origin serves all.
 */
export function staffAccountOrigin(currentOrigin: string, role: string): string {
  try {
    const host = new URL(currentOrigin).host
    if (role === 'teacher' && (host === BACKOFFICE_HOST || host === STUDENT_HOST)) return `https://${TEACHER_HOST}`
  } catch {
    // Not a URL — keep what came in rather than invent one.
  }
  return currentOrigin
}

/**
 * The staff door that serves the page the reader is on, for the screens every
 * staff door shares (invite and password reset): the teacher portal on the
 * teacher domain, the panel everywhere else. After setting a password the
 * account goes on from its door's home. The panel would send a teacher on
 * anyway — but from `/backoffice/home` on the teacher domain that is the
 * backoffice domain, where this session does not exist (cookies are per host).
 */
export function staffDoorOnHost(currentHost: string): '/docente' | '/backoffice' {
  return currentHost === TEACHER_HOST ? '/docente' : '/backoffice'
}
