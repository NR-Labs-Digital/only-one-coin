// What the seed intends to write, decided without a database in sight — so it
// can be reasoned about and tested. The script next door turns this into rows.

export const DEFAULT_COUNT = 300;
export const BATCH_SIZE = 100;

/**
 * Seats per class group the seed opens. Capacity is a real column with a real
 * CHECK (`seats_taken <= capacity`), so the seed sizes its own groups to hold
 * what it is about to put in them rather than widening the ones coordination
 * created.
 */
export const GROUP_CAPACITY = 60;

/** Marks every class group this seed opens, so what it created stays
 * identifiable afterwards — it cannot be taken back (see the script header). */
export const SEED_CODE_PREFIX = "SEED";

export type SeatStatus = "reserved" | "confirmed" | "released";
export type PaymentStatus = "pending" | "under_review" | "approved" | "rejected";
export type PaymentMethod = "yape" | "plin" | "bcp" | "interbank" | "other";
export type Origin = "whatsapp" | "web";

/**
 * The states as the ledger actually meets them, in roughly the proportion a
 * real ciclo produces: most seats settled, a working queue of receipts still
 * under review, a few opened and never paid, a few refused.
 *
 * The pairs are not free combinations — the screen derives what it shows from
 * both columns at once (`deriveStatus` in ListEnrollmentsQuery), so a seat
 * that says `confirmed` beside a payment that says `rejected` would be a state
 * the platform never writes and coordination would have to explain.
 */
const OUTCOMES: Array<{ seat: SeatStatus; payment: PaymentStatus; weight: number }> = [
  // Paid, settled, sitting in class — what most rows are.
  { seat: "confirmed", payment: "approved", weight: 55 },
  // Receipt read, waiting on a human (CLAUDE.md §5, the review queue).
  { seat: "reserved", payment: "under_review", weight: 20 },
  // Submitted, nothing read yet.
  { seat: "reserved", payment: "pending", weight: 13 },
  // Refused receipt: the seat goes back.
  { seat: "released", payment: "rejected", weight: 7 },
  // Reservation that expired without a receipt — the cron handed the seat back.
  { seat: "released", payment: "pending", weight: 5 },
];

const METHODS: Array<{ method: PaymentMethod; weight: number }> = [
  { method: "yape", weight: 45 },
  { method: "plin", weight: 25 },
  { method: "bcp", weight: 15 },
  { method: "interbank", weight: 10 },
  { method: "other", weight: 5 },
];

/** Free text naming the rail when it is `other` — the text IS the label
 * (CLAUDE.md §4 glossary), so it can never be empty. */
const OTHER_DETAILS = [
  "Transferencia BBVA",
  "Depósito Scotiabank",
  "PayPal (familiar en el extranjero)",
  "Transferencia Banco de la Nación",
];

export interface PlannedEnrollment {
  /** Index into the roster of students the caller supplies. */
  studentSlot: number;
  /** Index into the class groups the caller opens. */
  groupSlot: number;
  seatStatus: SeatStatus;
  paymentStatus: PaymentStatus;
  method: PaymentMethod;
  methodDetail: string | null;
  operationNumber: string;
  /** Unique per seeded row, and the handle a rerun recognises: the column is
   * UNIQUE, so the same key can never write a second payment (CLAUDE.md §5). */
  idempotencyKey: string;
  origin: Origin;
  createdAt: Date;
  /** Whether this row claims a seat — a released one gave it back. */
  holdsSeat: boolean;
}

/** Deterministic PRNG (mulberry32), same reasoning as the student seed: a
 * rerun has to recognise what it already wrote. */
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

/** How many class groups the seed has to open to hold `count` seats. */
export function groupsNeeded(count: number): number {
  return Math.max(1, Math.ceil(count / GROUP_CAPACITY));
}

export function buildPlan(count: number, studentCount: number, now: Date): PlannedEnrollment[] {
  if (studentCount < 1) return [];

  const random = makeRandom(20260922);
  const groups = groupsNeeded(count);
  const planned: PlannedEnrollment[] = [];

  for (let index = 0; index < count; index += 1) {
    const outcome = pick(OUTCOMES, random());
    const rail = pick(METHODS, random());

    /* Spread over the ciclo so the ledger's newest-first order and the date
       column have something to say. Every twelfth row repeats the previous
       timestamp: enrollments arrive in bursts when a sales push lands, and a
       list that never ties is a list that never exercises its ordering. */
    const createdAt =
      index % 12 === 0 && planned.length > 0
        ? new Date(planned[planned.length - 1]!.createdAt)
        : new Date(now.getTime() - Math.floor(random() * 90) * 24 * 60 * 60 * 1000 - Math.floor(random() * 86_400_000));

    planned.push({
      // Round-robin so no student collects the whole ledger, and so the
      // roster is reused when there are fewer students than seats.
      studentSlot: index % studentCount,
      groupSlot: index % groups,
      seatStatus: outcome.seat,
      paymentStatus: outcome.payment,
      method: rail.method,
      methodDetail:
        rail.method === "other" ? OTHER_DETAILS[Math.floor(random() * OTHER_DETAILS.length)]! : null,
      // What the student reads off their Yape receipt — 8 digits, unique per
      // row so the ledger's search finds exactly one.
      operationNumber: String(10_000_000 + index * 7 + 3),
      idempotencyKey: `seed-enrollment-${index}`,
      origin: random() < 0.6 ? "whatsapp" : "web",
      createdAt,
      // A released seat gave its place back: it must not be counted in
      // `seats_taken`, or the class group reads as full of people who left.
      holdsSeat: outcome.seat !== "released",
    });
  }

  return planned;
}
