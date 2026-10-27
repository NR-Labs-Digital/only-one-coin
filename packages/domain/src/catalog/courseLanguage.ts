/**
 * `courses.language` and teacher languages are free text — there is no
 * languages table — so "INGLES", "inglés" and "Inglés " are one language:
 * compared without case, accents or stray spaces.
 */
export function languageKey(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

export function sameLanguage(a: string, b: string): boolean {
  return languageKey(a) === languageKey(b);
}

/**
 * The spelling a language is written in: the catalog's own when the language
 * is already in use (`inUse`, most used first), the typed text when it is new.
 * The catalog groups by the spelling, so "INGLES" next to "Inglés" would open
 * a second English on the courses screen and in the checkout.
 */
export function catalogSpelling(typed: string, inUse: string[]): string {
  return inUse.find((spelling) => sameLanguage(spelling, typed)) ?? typed.trim();
}
