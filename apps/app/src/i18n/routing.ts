import { defineRouting } from 'next-intl/routing'

/**
 * es-PE é padrão e não leva prefixo; /en e /pt prefixados (CLAUDE.md §4).
 * Os códigos de rota são curtos (es/en/pt); os arquivos de locale mantêm o
 * nome completo (es-PE/pt-BR/en) — ver ./request.ts. Um 4º idioma (ex.: quechua)
 * é só mais uma entrada aqui + mais um arquivo de mensagens.
 */
export const routing = defineRouting({
  locales: ['es', 'en', 'pt'],
  defaultLocale: 'es',
  localePrefix: 'as-needed',
  // next-intl 4 writes NEXT_LOCALE as a session cookie: closing the browser
  // dropped the choice, and the next visit to an unprefixed path fell back to
  // the browser's Accept-Language — English on an English browser, whatever
  // the person had picked (OOC-191). A year keeps the choice across restarts;
  // the account's own preference still opens the language at sign-in (OOC-150).
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
})
