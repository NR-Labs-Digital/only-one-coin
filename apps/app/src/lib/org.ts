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

/** Full wa.me link for the help button on the public checkout. */
export const whatsappUrl = `https://wa.me/${org.whatsapp}`
