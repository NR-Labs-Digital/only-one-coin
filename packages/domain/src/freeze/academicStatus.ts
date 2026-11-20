/**
 * Where an enrollment stands academically (OOC-84), derived and never
 * stored, the same treatment as the enrollment's payment status:
 *
 * - `frozen` — the student paused; the seat went back to the class group;
 * - `completed` — the seat is confirmed and its class group finished or was
 *   closed;
 * - `active` — the seat is confirmed and its class group is still running or
 *   selling.
 *
 * A seat still reserved, or released, has no academic status: it is money
 * waiting in Payments, or a refusal. Withdrawn and transferred are not here
 * yet — no rule says what they mean (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §7).
 */
export const ACADEMIC_STATUSES = ["active", "frozen", "completed"] as const;
export type AcademicStatus = (typeof ACADEMIC_STATUSES)[number];

export function academicStatusOf(seatStatus: string, classGroupStatus: string): AcademicStatus | null {
  if (seatStatus === "frozen") return "frozen";
  if (seatStatus !== "confirmed") return null;
  return classGroupStatus === "finished" || classGroupStatus === "closed" ? "completed" : "active";
}
