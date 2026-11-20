/**
 * The monthly modality of a course (OOC-86, CLAUDE.md §1): a prepaid purchase
 * of one module at a time. Never an installment of the package, never a debt —
 * a student who does not buy the module they are in simply has no access to
 * the class in the portal.
 *
 * What a payment bought is a list of (module, attempt): a student who repeats
 * a module buys it again (decision of 20/11/2026), so paying module 3 covers
 * the attempt it was bought for and never the next time through. Paying ahead
 * buys the first attempt of the modules after the current one.
 *
 * Pure rules, integers only. Who reads the rows and who writes them is the
 * repository's business.
 */

export interface ModuleAttempt {
  module: number;
  attempt: number;
}

/** A purchase still alive: a rejected payment's rows are not coverage. */
export type CoverageStatus = "pending" | "under_review" | "approved";

export interface CoveredModule extends ModuleAttempt {
  status: CoverageStatus;
}

function sameAttempt(a: ModuleAttempt, b: ModuleAttempt): boolean {
  return a.module === b.module && a.attempt === b.attempt;
}

/**
 * What the student may buy now, in the order it must be bought: the attempt
 * they are on, if nobody bought it yet, then the first attempt of every later
 * module of the course that is not bought yet. Anything bought and still alive
 * (waiting for review or approved) is left out — it is not for sale twice.
 */
export function purchasableModules(params: {
  current: ModuleAttempt;
  courseModules: number;
  covered: readonly CoveredModule[];
}): ModuleAttempt[] {
  const bought = (item: ModuleAttempt): boolean => params.covered.some((row) => sameAttempt(row, item));
  const items: ModuleAttempt[] = [];

  if (!bought(params.current)) items.push({ ...params.current });
  for (let module = params.current.module + 1; module <= params.courseModules; module += 1) {
    const item = { module, attempt: 1 };
    if (!bought(item)) items.push(item);
  }
  return items;
}

/**
 * The selection the student sent, checked against what is for sale. Modules
 * run in order, so the selection is always the first `count` items, never a
 * free pick (decision of 06/09/2026): paying the fourth with the third open is
 * not a thing. Answers the items bought, or null when the count does not fit.
 */
export function selectPrefix(purchasable: readonly ModuleAttempt[], count: number): ModuleAttempt[] | null {
  if (!Number.isInteger(count) || count < 1 || count > purchasable.length) return null;
  return purchasable.slice(0, count).map((item) => ({ ...item }));
}

/**
 * The amount of a monthly payment: the module's price in force today, once
 * per module bought. No discount for buying ahead, ever.
 */
export function monthlyAmountCents(count: number, modulePriceCents: number): number {
  return count * modulePriceCents;
}

/**
 * Whether the class is open to the student: the attempt they are on was
 * bought and a person approved it (decision of 20/11/2026 — a receipt waiting
 * in Pagos does not open the class yet).
 */
export function hasClassAccess(current: ModuleAttempt, covered: readonly CoveredModule[]): boolean {
  return covered.some((row) => row.status === "approved" && sameAttempt(row, current));
}

/** Why the class is closed to a monthly student, or null when it is open. */
export type MonthlyAccessLock = "monthly_payment_due" | "monthly_payment_in_review";

export function monthlyAccessLock(current: ModuleAttempt, covered: readonly CoveredModule[]): MonthlyAccessLock | null {
  if (hasClassAccess(current, covered)) return null;
  return covered.some((row) => sameAttempt(row, current)) ? "monthly_payment_in_review" : "monthly_payment_due";
}
