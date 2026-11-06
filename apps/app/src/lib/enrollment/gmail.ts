/**
 * The student's address is always a personal Gmail (CLAUDE.md §1), so the
 * checkout asks only for the username and shows `@gmail.com` fixed beside the
 * field (OOC-141): a domain nobody types is a domain nobody mistypes. The
 * draft keeps the whole address, which is what the rules and the API read.
 */
export const GMAIL_SUFFIX = '@gmail.com'

/** The part the field shows. A draft saved before OOC-141 may hold another
 * domain; it shows whole, and the Gmail rule flags it. */
export function gmailUsernameOf(email: string): string {
  return email.toLowerCase().endsWith(GMAIL_SUFFIX) ? email.slice(0, -GMAIL_SUFFIX.length) : email
}

/** What the field writes back. A pasted full address loses the suffix it
 * already carries; anything else after an `@` stays, for the rules to refuse
 * instead of the screen silently swapping a domain the reader typed. */
export function gmailFromUsername(value: string): string {
  const username = gmailUsernameOf(value.trim())
  return username === '' ? '' : `${username}${GMAIL_SUFFIX}`
}
