import type { Locale } from "../notification/EmailNotification.js";
import { receivedEmailsFor, type PaymentItemEmailFacts } from "../notification/enrollmentEmails.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { InvalidFieldsError } from "../shared/base/errors/InvalidFieldsError.js";
import { GuardianRequiredForMinorError } from "../student/errors.js";
import { isGmail } from "../student/fields.js";
import { Guardian, type CreateGuardianDTO } from "../student/Guardian.js";
import { Student, type CreateStudentDTO } from "../student/Student.js";
import { Enrollment } from "./Enrollment.js";
import {
  ClassGroupNotFoundError,
  LotDuplicateCourseError,
  LotDuplicatePersonError,
  ReceiptNotReadyError,
  SeatHoldExpiredError,
  StudentBelowMinimumAgeError,
} from "./errors.js";
import { Payment, type PaymentMethod } from "./Payment.js";
import type {
  IPublicEnrollmentRepository,
  PublicEnrollmentContext,
  PublicEnrollmentItemToWrite,
  PublicEnrollmentPersonToWrite,
  SubmitPublicEnrollmentResult,
} from "./PublicEnrollmentRepository.js";
import type { IReceiptUploadRepository } from "./ReceiptUploadRepository.js";
import type { SeatHold } from "./SeatHold.js";
import type { ISeatHoldRepository } from "./SeatHoldRepository.js";

/**
 * How many enrollments one checkout may send at once (OOC-158). A guard on a
 * public route against a forged body, not a business rule — nobody decided a
 * family's limit. Provisional; the route's schema says the same.
 */
export const MAX_PUBLIC_LOT_ITEMS = 10;

/** One person of the checkout: the student, and the guardian when there is one. */
export interface SubmitPublicEnrollmentPerson {
  student: CreateStudentDTO;
  guardian: Omit<CreateGuardianDTO, "studentId"> | null;
}

/** One enrollment of the checkout. */
export interface SubmitPublicEnrollmentItem {
  /** The hold claimed when the checkout settled on this class group. Its
   * seat becomes this enrollment's — the submit never takes a second one. */
  seatHoldId: string;
  classGroupId: string;
  planId: string;
  /** Index into `people`. */
  person: number;
}

export interface SubmitPublicEnrollmentInput {
  /** Everybody the checkout enrolls, each once (one document, one entry). */
  people: SubmitPublicEnrollmentPerson[];
  /** At least one, at most `MAX_PUBLIC_LOT_ITEMS`. One is the ordinary
   * checkout; more is a lot (OOC-158), paid with one receipt. */
  items: SubmitPublicEnrollmentItem[];
  /** Minted by `RequestReceiptUploadUseCase` and confirmed by
   * `ConfirmReceiptUploadUseCase` before this call — must belong to the first
   * item's seat hold and be at least `uploaded`, or the submit fails with
   * `ReceiptNotReadyError`. */
  receiptUploadId: string;
  /** Resolved by the route from the request itself (CLAUDE.md §8) — never
   * trusted from the body. Required exactly when some person has a guardian. */
  consent: { version: string; ip: string } | null;
  /** The language the person filled the form in — the one their e-mails
   * are written in (CLAUDE.md §4). */
  locale: Locale;
  payment: {
    method: PaymentMethod;
    methodDetail: string | null;
    operationNumber: string;
    idempotencyKey: string;
  };
}

export type SubmitPublicEnrollmentOutput = SubmitPublicEnrollmentResult;

/**
 * The public checkout's submit. One call, one transaction at the repository
 * boundary: register every student (and guardian, if a minor), consume every
 * seat hold, create the enrollments and the one payment `pending` that pays
 * for all of them, and queue the "enrollment received" e-mail in the outbox.
 *
 * Since OOC-158 the checkout may send a lot: the same student in several
 * courses, several children, or both, paid with one receipt. The expected
 * amount is the sum of the plan prices in force — no discount, ever
 * (CLAUDE.md §1) — and the payment points at the first item's enrollment,
 * listing the others as its lot. One item is exactly the checkout as it was.
 *
 * Price and each course's minimum age are resolved here from the server's
 * own read of the class group and plan — never accepted from the client
 * (CLAUDE.md §5). The channel comes from the seat hold, recorded at first
 * access — never from this request either.
 */
export class SubmitPublicEnrollmentUseCase extends BaseUseCase<
  SubmitPublicEnrollmentInput,
  SubmitPublicEnrollmentOutput
> {
  constructor(
    private readonly repository: IPublicEnrollmentRepository,
    private readonly seatHolds: ISeatHoldRepository,
    private readonly receiptUploads: IReceiptUploadRepository,
  ) {
    super();
  }

  async run(input: SubmitPublicEnrollmentInput): Promise<SubmitPublicEnrollmentOutput> {
    const { items } = input;
    if (items.length === 0 || items.length > MAX_PUBLIC_LOT_ITEMS) {
      throw new InvalidFieldsError([{ path: "items", code: "invalid" }]);
    }

    const people = this.readPeople(input);
    const lead = items[0]!;

    // Every hold once: the same seat cannot pay for two enrollments.
    if (new Set(items.map((item) => item.seatHoldId)).size !== items.length) {
      throw new InvalidFieldsError([{ path: "items", code: "invalid" }]);
    }

    const contexts: PublicEnrollmentContext[] = [];
    const holds: SeatHold[] = [];
    const coursesByPerson = new Map<number, Set<string>>();
    for (const item of items) {
      const person = people[item.person];
      if (!person) throw new InvalidFieldsError([{ path: "items", code: "invalid" }]);

      const context = await this.repository.findContext({ classGroupId: item.classGroupId, planId: item.planId });
      if (!context) throw new ClassGroupNotFoundError();
      if (person.student.ageInYears < context.courseMinAge) throw new StudentBelowMinimumAgeError();

      const courses = coursesByPerson.get(item.person) ?? new Set<string>();
      if (courses.has(context.courseId)) throw new LotDuplicateCourseError();
      courses.add(context.courseId);
      coursesByPerson.set(item.person, courses);

      // Read whatever the hold's status: the origin on it never changes, and an
      // idempotent retry arrives here with the hold its first attempt already
      // consumed. Whether the seat can still be taken is the repository's
      // call, inside the transaction and against the database clock.
      const hold = await this.seatHolds.find(item.seatHoldId);
      if (!hold || hold.classGroupId !== item.classGroupId) throw new SeatHoldExpiredError();

      contexts.push(context);
      holds.push(hold);
    }

    // Nobody is enrolled without being in a lot item.
    if (people.some((_, index) => !coursesByPerson.has(index))) {
      throw new InvalidFieldsError([{ path: "people", code: "invalid" }]);
    }

    // Early, non-authoritative check — same shape as the holds' above: fast
    // feedback before the heavier work, with the repository re-checking
    // inside the submit transaction (DrizzlePublicEnrollmentRepository).
    const receipt = await this.receiptUploads.findById(input.receiptUploadId);
    if (
      !receipt ||
      receipt.seatHoldId !== lead.seatHoldId ||
      (receipt.status !== "uploaded" && receipt.status !== "processed")
    ) {
      throw new ReceiptNotReadyError();
    }

    const toWrite: PublicEnrollmentItemToWrite[] = items.map((item, index) => ({
      seatHoldId: item.seatHoldId,
      person: item.person,
      enrollment: Enrollment.createFromPublicCheckout({
        studentId: people[item.person]!.student.id,
        classGroupId: item.classGroupId,
        planPriceId: contexts[index]!.planPriceId,
        origin: holds[index]!.origin,
      }),
    }));

    // The sum of the prices in force, in integer cents — never a discount.
    const amountCents = contexts.reduce((total, context) => total + context.amountCents, 0);

    const payment = Payment.createFromPublicCheckout({
      enrollmentId: toWrite[0]!.enrollment.id,
      idempotencyKey: input.payment.idempotencyKey,
      method: input.payment.method,
      methodDetail: input.payment.methodDetail,
      amountCents,
      operationNumber: input.payment.operationNumber,
    });

    const emailItems: PaymentItemEmailFacts[] = toWrite.map((item, index) => {
      const person = people[item.person]!;
      return {
        enrollmentId: item.enrollment.id,
        studentId: person.student.id,
        student: person.student,
        guardian: person.guardian,
        courseName: contexts[index]!.courseName,
        classGroupStartsOn: contexts[index]!.classGroupStartsOn,
      };
    });
    const notifications = receivedEmailsFor({ paymentId: payment.id, items: emailItems, amountCents }, input.locale);

    const anyGuardian = people.some((person) => person.guardian !== null);
    return this.repository.submit({
      people,
      items: toWrite,
      consent:
        anyGuardian && input.consent
          ? { version: input.consent.version, acceptedAt: new Date(), ip: input.consent.ip }
          : null,
      payment,
      receiptUploadId: receipt.id,
      notifications,
    });
  }

  /** Builds each person and holds them to the checkout's own gates. */
  private readPeople(input: SubmitPublicEnrollmentInput): PublicEnrollmentPersonToWrite[] {
    if (input.people.length === 0) throw new InvalidFieldsError([{ path: "people", code: "invalid" }]);

    const documents = new Set<string>();
    return input.people.map((entry, index) => {
      const student = Student.create(entry.student);

      // The checkout's own gate, not the entity's: the backoffice registration
      // is not held to it until OOC-65 decides (fields.ts, isGmail).
      if (!isGmail(student.email)) {
        throw new InvalidFieldsError([{ path: `people.${index}.student.email`, code: "email_must_be_gmail" }]);
      }

      if (student.isMinor && !entry.guardian) {
        throw new GuardianRequiredForMinorError();
      }

      // One document, one person (CLAUDE.md §1) — compared normalized, the
      // way the entity stores it.
      const document = `${student.nationalIdType}:${student.nationalId}`;
      if (documents.has(document)) throw new LotDuplicatePersonError();
      documents.add(document);

      const guardian = entry.guardian ? Guardian.create({ ...entry.guardian, studentId: student.id }) : null;
      return { student, guardian };
    });
  }
}
