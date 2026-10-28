/**
 * How a language name is compared: "INGLES", "inglés" and "Inglés " are one
 * language — no case, accents or stray spaces. The Language record stores it
 * as `key`, one live language per key (OOC-128); migrations 0041/0042 mirror
 * it in SQL with `translate`.
 */
export function languageKey(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

export function sameLanguage(a: string, b: string): boolean {
  return languageKey(a) === languageKey(b);
}
