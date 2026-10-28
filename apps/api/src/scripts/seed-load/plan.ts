// What the load seed intends to write, decided without a database in sight —
// so it can be reasoned about and tested. `seed-load.ts` turns it into rows.
//
// The rows are states the platform itself produces: a seat and its payment
// agree, and every read receipt carries the verdict the real traffic light
// (`decideReceiptVerdict`) gives that reading — never one picked by hand.
import {
  decideReceiptVerdict,
  type ReceiptExtractedField,
  type ReceiptValidationSettings,
  type ReceiptVerdictOutcome,
} from "@ooc/domain";

export const BATCH_SIZE = 500;

/**
 * Seats per class group: the top of what a real room holds (45–50,
 * `docs/REGRAS-NEGOCIO.md` §2). Capacity has a real CHECK against
 * `seats_taken`, so the seed opens enough groups for what it writes.
 */
export const GROUP_CAPACITY = 50;

/** Marks every class group and period this seed opens, so what it created stays identifiable. */
export const LOAD_CODE_PREFIX = "LOAD";
export const LOAD_PERIOD_PREFIX = "Ciclo de carga";

/** The model id the seeded readings name — invented, and saying so. */
export const LOAD_MODEL_NAME = "seed/load-fixture";

/**
 * How much to write. `dev` is the ROADMAP Sessão 9 seed (500 students, 3
 * periods, ~40 class groups); `normal` and `peak` are one month at the volumes
 * in CLAUDE.md §1 (5,000 and 20,000 enrollments a month).
 */
export interface LoadProfile {
  /**
   * Scopes what the profile writes — class group codes, idempotency keys,
   * receipt keys — so two profiles on one database never share a class group:
   * each lays its seats out over its own groups, and sharing them would put
   * one profile's seats past the other's capacity. Students are shared: they
   * are found by document.
   */
  name: string;
  students: number;
  enrollments: number;
  minClassGroups: number;
  /** Where its operation numbers start — its own range, so no two payments share one. */
  operationBase: number;
}
export const LOAD_PROFILES = {
  dev: { name: "dev", students: 500, enrollments: 600, minClassGroups: 40, operationBase: 100_000_000 },
  normal: { name: "normal", students: 5_000, enrollments: 5_000, minClassGroups: 40, operationBase: 300_000_000 },
  peak: { name: "peak", students: 20_000, enrollments: 20_000, minClassGroups: 40, operationBase: 500_000_000 },
} satisfies Record<string, LoadProfile>;
export type LoadProfileName = keyof typeof LOAD_PROFILES;

/** Three periods: the one that ended, the one running, the one selling. */
export const LOAD_PERIODS = [
  { index: 1, startsDaysAgo: 150, endsDaysAgo: 60, status: "finished" },
  { index: 2, startsDaysAgo: 45, endsDaysAgo: -45, status: "in_progress" },
  { index: 3, startsDaysAgo: -20, endsDaysAgo: -110, status: "enrolling" },
] as const;
export type LoadPeriod = (typeof LOAD_PERIODS)[number];

export type SeatStatus = "reserved" | "confirmed" | "released";
export type PaymentStatus = "pending" | "under_review" | "approved" | "rejected";
export type PaymentMethod = "yape" | "plin" | "bcp" | "interbank" | "other";
export type Origin = "whatsapp" | "web";

/**
 * What happened to the receipt — the part the review queue and its traffic
 * light are worked against:
 *
 * - `none`: no receipt (a reservation that expired before one was sent).
 * - `unread`: uploaded and processed, the OCR has not answered yet.
 * - `green` / `review` / `far_below`: read, with the reading that yields that verdict.
 */
export type ReceiptScenario = "none" | "unread" | "green" | "review" | "far_below";

interface Outcome {
  seat: SeatStatus;
  payment: PaymentStatus;
  receipt: ReceiptScenario;
  weight: number;
}

/**
 * The selling and running periods, in roughly the proportion a real ciclo
 * produces. The pairs follow what the platform writes: the traffic light only
 * validates (green stays `pending`, the rest go `under_review`), and a person
 * approves or rejects — sometimes against the light, which is why an approved
 * payment can carry a yellow verdict.
 */
const OPEN_OUTCOMES: Outcome[] = [
  { seat: "confirmed", payment: "approved", receipt: "green", weight: 48 },
  { seat: "confirmed", payment: "approved", receipt: "review", weight: 7 },
  { seat: "reserved", payment: "under_review", receipt: "review", weight: 14 },
  { seat: "reserved", payment: "under_review", receipt: "far_below", weight: 4 },
  { seat: "reserved", payment: "pending", receipt: "green", weight: 9 },
  { seat: "reserved", payment: "pending", receipt: "unread", weight: 6 },
  { seat: "released", payment: "rejected", receipt: "far_below", weight: 5 },
  { seat: "released", payment: "rejected", receipt: "review", weight: 2 },
  { seat: "released", payment: "pending", receipt: "none", weight: 5 },
];

/** A period that already ended has nothing open: every payment was decided. */
const CLOSED_OUTCOMES: Outcome[] = [
  { seat: "confirmed", payment: "approved", receipt: "green", weight: 80 },
  { seat: "confirmed", payment: "approved", receipt: "review", weight: 8 },
  { seat: "released", payment: "rejected", receipt: "far_below", weight: 8 },
  { seat: "released", payment: "rejected", receipt: "review", weight: 4 },
];

const METHODS: Array<{ method: PaymentMethod; weight: number }> = [
  { method: "yape", weight: 45 },
  { method: "plin", weight: 25 },
  { method: "bcp", weight: 15 },
  { method: "interbank", weight: 10 },
  { method: "other", weight: 5 },
];

/** The text IS the label of `other` (CLAUDE.md §4 glossary), so it is never empty. */
const OTHER_DETAILS = ["Transferencia BBVA", "Depósito Scotiabank", "Transferencia Banco de la Nación"];

const REJECTION_REASONS = ["amount_mismatch", "illegible", "duplicate", "not_a_receipt"] as const;

export interface PlannedReceipt {
  /** Unique per row: `receipt_uploads.object_key` is UNIQUE. */
  objectKey: string;
  processedObjectKey: string;
  /** Null while the OCR has not answered (`unread`). */
  reading: {
    amountCents: number | null;
    operationNumber: string | null;
    fields: ReceiptExtractedField[];
    outcome: ReceiptVerdictOutcome;
  } | null;
}

export interface PlannedEnrollment {
  /** Index into the roster of seeded students. */
  studentSlot: number;
  /** Index into the class groups the plan opens. */
  groupSlot: number;
  seatStatus: SeatStatus;
  paymentStatus: PaymentStatus;
  rejectionReason: (typeof REJECTION_REASONS)[number] | null;
  method: PaymentMethod;
  methodDetail: string | null;
  operationNumber: string;
  /** The handle a rerun recognises: `payments.idempotency_key` is UNIQUE (CLAUDE.md §5). */
  idempotencyKey: string;
  origin: Origin;
  createdAt: Date;
  /** A released seat gave its place back and is not counted in `seats_taken`. */
  holdsSeat: boolean;
  receipt: PlannedReceipt | null;
}

export interface PlannedClassGroup {
  code: string;
  /** Index into the plans (course + price in force) the caller supplies. */
  planSlot: number;
  period: LoadPeriod;
}

/** Deterministic PRNG (mulberry32): a rerun has to recognise what it already wrote. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends { weight: number }>(items: T[], roll: number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = roll * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1]!;
}

export function classGroupsNeeded(profile: LoadProfile): number {
  return Math.max(profile.minClassGroups, Math.ceil(profile.enrollments / GROUP_CAPACITY));
}

/**
 * The class groups, spread over the three periods and every plan on file —
 * so each language the catalog has shows up in each period.
 */
export function buildClassGroups(profile: LoadProfile, planCount: number): PlannedClassGroup[] {
  if (planCount < 1) return [];
  return Array.from({ length: classGroupsNeeded(profile) }, (_, index) => ({
    code: `${LOAD_CODE_PREFIX}-${profile.name.toUpperCase()}-${String(index + 1).padStart(5, "0")}`,
    planSlot: index % planCount,
    period: LOAD_PERIODS[index % LOAD_PERIODS.length]!,
  }));
}

/**
 * The reading the OCR would have returned for a scenario, and the verdict the
 * real traffic light gives it with today's settings.
 */
function readingFor(
  scenario: Exclude<ReceiptScenario, "none" | "unread">,
  params: { expectedCents: number; operationNumber: string; method: PaymentMethod; methodDetail: string | null },
  settings: ReceiptValidationSettings,
  roll: () => number,
): NonNullable<PlannedReceipt["reading"]> {
  let amountCents: number | null = params.expectedCents;
  let operationNumber: string | null = params.operationNumber;

  if (scenario === "far_below") {
    amountCents = Math.max(1, Math.floor((params.expectedCents * Math.max(1, settings.rejectBelowPercent - 20)) / 100));
  } else if (scenario === "review") {
    // The three ways a receipt lands in review: paid more than asked, the
    // operation number read is not the one typed, or the amount is illegible.
    const kind = Math.floor(roll() * 3);
    if (kind === 0) amountCents = params.expectedCents + settings.toleranceCents + 1000;
    else if (kind === 1) {
      // One digit off — the last one moved, so it never lands back on itself.
      const last = Number(params.operationNumber.slice(-1));
      operationNumber = `${params.operationNumber.slice(0, -1)}${(last + 1) % 10}`;
    }
    else amountCents = null;
  }

  const confident = scenario === "green";
  const confidence = () => Math.round((confident ? 0.88 + roll() * 0.11 : 0.4 + roll() * 0.45) * 100) / 100;

  const fields: ReceiptExtractedField[] = [
    { field: "amount_cents", value: amountCents, confidence: amountCents === null ? 0 : confidence() },
    { field: "operation_number", value: operationNumber, confidence: confidence() },
    { field: "payment_method", value: params.method, detail: params.methodDetail, confidence: confidence() },
    { field: "payer_name", value: null, confidence: 0 },
    { field: "paid_at", value: null, confidence: 0 },
  ];

  const outcome = decideReceiptVerdict({
    expectedCents: params.expectedCents,
    declaredOperationNumber: params.operationNumber,
    readAmountCents: amountCents,
    readOperationNumber: operationNumber,
    declaredMethod: params.method,
    readMethod: params.method,
    settings,
  });

  return { amountCents, operationNumber, fields, outcome };
}

export function buildEnrollments(params: {
  profile: LoadProfile;
  groups: PlannedClassGroup[];
  /** The price in force of each plan, by plan slot — never a number the seed chooses (no discounts, CLAUDE.md §1). */
  planAmounts: number[];
  settings: ReceiptValidationSettings;
  now: Date;
}): PlannedEnrollment[] {
  const { profile, groups, planAmounts, settings, now } = params;
  if (groups.length === 0 || profile.students < 1) return [];

  const random = makeRandom(20261028);
  const day = 24 * 60 * 60 * 1000;
  const planned: PlannedEnrollment[] = [];

  for (let index = 0; index < profile.enrollments; index += 1) {
    // Round-robin: every group stays under its capacity (there are enough of them).
    const groupSlot = index % groups.length;
    const group = groups[groupSlot]!;
    const outcome = pick(group.period.status === "finished" ? CLOSED_OUTCOMES : OPEN_OUTCOMES, random());
    const rail = pick(METHODS, random());
    const methodDetail = rail.method === "other" ? OTHER_DETAILS[Math.floor(random() * OTHER_DETAILS.length)]! : null;

    // Bought in the month before the period started, or while it sells.
    const soldDaysAgo = Math.max(0, group.period.startsDaysAgo) + Math.floor(random() * 30);
    const createdAt = new Date(now.getTime() - soldDaysAgo * day - Math.floor(random() * day));

    // 9 digits, unique per row and per profile; the seed:enrollments rows use 8, so the two never meet.
    const operationNumber = String(profile.operationBase + index * 7 + 3);

    const receipt: PlannedReceipt | null =
      outcome.receipt === "none"
        ? null
        : {
            objectKey: `receipts/raw/load/${profile.name}/${index}`,
            processedObjectKey: `receipts/processed/load/${profile.name}/${index}`,
            reading:
              outcome.receipt === "unread"
                ? null
                : readingFor(
                    outcome.receipt,
                    { expectedCents: planAmounts[group.planSlot]!, operationNumber, method: rail.method, methodDetail },
                    settings,
                    random,
                  ),
          };

    planned.push({
      studentSlot: index % profile.students,
      groupSlot,
      seatStatus: outcome.seat,
      paymentStatus: outcome.payment,
      rejectionReason:
        outcome.payment === "rejected" ? REJECTION_REASONS[Math.floor(random() * REJECTION_REASONS.length)]! : null,
      method: rail.method,
      methodDetail,
      operationNumber,
      idempotencyKey: `seed-load-${profile.name}-${index}`,
      origin: random() < 0.6 ? "whatsapp" : "web",
      createdAt,
      holdsSeat: outcome.seat !== "released",
      receipt,
    });
  }

  return planned;
}
