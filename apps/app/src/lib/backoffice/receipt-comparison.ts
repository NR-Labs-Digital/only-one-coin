import type { PaymentMethod } from './types'

/**
 * What the review dialog shows next to each field it compares (OOC-146): the
 * reading either matches what was expected or declared, differs from it, or
 * there is nothing to compare (not read, or nothing declared).
 *
 * A fact about the two values, never a judgement: the traffic light is the
 * judgement (it applies the amount tolerance from `platform_settings`, which
 * this screen does not), and a person decides. So the amount is compared
 * exactly — a reading one cent over the price "differs", even when the verdict
 * tolerated it.
 */
export type FieldComparison = 'match' | 'differs' | 'none'

export function compareAmount(expectedCents: number, readCents: number | null): FieldComparison {
  if (readCents === null) return 'none'
  return readCents === expectedCents ? 'match' : 'differs'
}

/**
 * The operation number as the antifraud lock and the traffic light compare it:
 * letters and digits only, upper case, leading zeros kept. Mirrors
 * `normalizeOperationNumber` (`packages/domain/src/enrollment/ReceiptScreening.ts`)
 * — the app cannot import that module, so the two change together.
 */
function normalizeOperationNumber(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

export function compareOperationNumber(declared: string | null, read: string | null): FieldComparison {
  if (declared === null || read === null) return 'none'
  const a = normalizeOperationNumber(declared)
  const b = normalizeOperationNumber(read)
  if (a === '' || b === '') return 'none'
  return a === b ? 'match' : 'differs'
}

export function compareMethod(declared: PaymentMethod, read: PaymentMethod | null): FieldComparison {
  if (read === null) return 'none'
  return read === declared ? 'match' : 'differs'
}
