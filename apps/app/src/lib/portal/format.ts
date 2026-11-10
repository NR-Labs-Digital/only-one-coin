/**
 * Os formatadores passaram a ser compartilhados com o backoffice e vivem em
 * `@/lib/format`. Este arquivo permanece como fachada para não mexer nos
 * imports das páginas do portal.
 */
export {
  formatMoney,
  formatNumber,
  formatDate,
  formatDateNumeric,
  formatDateTime,
  formatWeekdayTime,
  initials,
} from '@/lib/format'
