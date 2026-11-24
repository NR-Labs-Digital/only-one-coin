/**
 * Contact channels of the Asociación, mirroring `org` in
 * `apps/landing/src/i18n/ui.ts`.
 *
 * Catalog data, not configuration: it is the same number in every environment
 * and every language, so it is not an env var — the same treatment the landing
 * gives it. It is also not UI copy, so it is allowed in a `.ts`
 * (`CLAUDE.md` §4 exempts proper nouns and real data).
 */
export const org = {
  /** WhatsApp number in wa.me form — country code + number, digits only. */
  whatsapp: '51951153323',
} as const

/**
 * The Google Form the complaints book lived in before OOC-63. Where
 * `/libro-de-reclamaciones` sends people while the `complaints` flag is off
 * in production; goes away with the flag.
 */
export const legacyComplaintsFormUrl = 'https://forms.gle/55Z6uner33ZZxZ1cA'

/** Full wa.me link for the help button on the public checkout. */
export const whatsappUrl = `https://wa.me/${org.whatsapp}`
