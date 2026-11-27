/**
 * The screens of apps/app that measure anything (OOC-47): the public
 * checkout, `/enrollment` and below, in any locale. `middleware.ts` opens the
 * pixel hosts in the CSP only here; portal, backoffice and teacher screens
 * keep the strict policy.
 */
export function isMeasuredPath(pathname: string, localeCodes: readonly string[]): boolean {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] && localeCodes.includes(segments[0])) segments.shift()
  return segments[0] === 'enrollment'
}
