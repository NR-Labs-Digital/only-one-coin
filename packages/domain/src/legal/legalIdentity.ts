/*
 * Who answers legally for the platform — one copy, read by `apps/landing`
 * (footer, terms, privacy policy, JSON-LD) through the
 * `@ooc/domain/legal-identity` subpath, and by `apps/api` (the documents it
 * generates: the teacher contract, and later constancia and certificate,
 * OOC-123) through the package root, `@ooc/domain`.
 *
 * The subpath is the raw `.ts`, compiled by the Astro build — so this file
 * stays self-contained: no dependency, no relative import. The API must not
 * use the subpath: in production it runs compiled `dist/` under plain Node,
 * which refuses to strip types inside `node_modules`.
 *
 * INGLES POR UN SOL S.A.C. replaced the Asociación Only One Coin Perú (RUC
 * 20610561463) on the owner's decision of 04/09/2026 (CLAUDE.md §1). Written
 * in capitals, as on the RUC record. Still open in CLAUDE.md §1: which entity
 * signs the teacher contract and issues the certificate, and the S.A.C.'s own
 * fiscal address — the address below is still the Asociación's, in Chorrillos.
 */
export const LEGAL_IDENTITY = {
  legalName: "INGLES POR UN SOL S.A.C.",
  ruc: "20613918028",
  address: "Av. Manuel Murillo, Condominio Gral Manuel Murillo 180, Chorrillos, Lima, Perú",
} as const;
