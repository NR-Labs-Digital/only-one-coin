import { describe, expect, it } from "vitest";
import {
  assertReceivable,
  assertTransferable,
  EnrollmentNotFoundError,
  EnrollmentTransferRefusedError,
  EnrollmentTransferStudentNotFoundError,
  TransferEnrollmentUseCase,
  type IEnrollmentTransferRepository,
  type IPortalAccessRepository,
  type IPortalLinkBuilder,
  type PortalAccountProvisioning,
  type TransferDestination,
  type TransferSource,
} from "@ooc/domain";

const SOURCE: TransferSource = {
  id: "e1",
  studentId: "s1",
  seatStatus: "confirmed",
  classGroupId: "g1",
  classGroupStatus: "in_progress",
  courseId: "c1",
  courseAllowsEnrollmentTransfer: true,
  courseMinAge: 12,
  graded: false,
  procedureOpen: false,
};

const yearsAgo = (years: number) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCMonth(0, 1);
  return date;
};

const DESTINATION: TransferDestination = {
  id: "s2",
  birthDate: yearsAgo(30),
  hasLiveGuardian: false,
  enrolledInCourse: false,
};

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    return error instanceof EnrollmentTransferRefusedError ? error.reason : "other";
  }
  return null;
}

function useCase(overrides: { source?: TransferSource | null; destination?: TransferDestination | null } = {}) {
  const transfers: Parameters<IEnrollmentTransferRepository["transfer"]>[0][] = [];
  const provisioned: PortalAccountProvisioning[] = [];
  const repository: IEnrollmentTransferRepository = {
    findSource: () => Promise.resolve(overrides.source === undefined ? SOURCE : overrides.source),
    findDestination: () => Promise.resolve(overrides.destination === undefined ? DESTINATION : overrides.destination),
    transfer: (params) => {
      transfers.push(params);
      return Promise.resolve();
    },
  };
  const portalAccess = {
    provision: (request: PortalAccountProvisioning) => {
      provisioned.push(request);
      return Promise.resolve("created" as const);
    },
  } as unknown as IPortalAccessRepository;
  const links: IPortalLinkBuilder = { access: (token: string) => `https://portal.example.com/access/${token}` } as IPortalLinkBuilder;
  return { run: new TransferEnrollmentUseCase(repository, portalAccess, links), transfers, provisioned };
}

describe("enrollment transfer (OOC-105)", () => {
  it("hands over only a confirmed, ungraded seat of a course that offers it, in a running class group", () => {
    expect(reasonOf(() => assertTransferable(SOURCE))).toBeNull();
    expect(reasonOf(() => assertTransferable({ ...SOURCE, seatStatus: "reserved" }))).toBe("enrollment.transfer_seat_not_confirmed");
    expect(reasonOf(() => assertTransferable({ ...SOURCE, seatStatus: "frozen" }))).toBe("enrollment.transfer_seat_not_confirmed");
    expect(reasonOf(() => assertTransferable({ ...SOURCE, courseAllowsEnrollmentTransfer: false }))).toBe(
      "enrollment.transfer_course_disallows",
    );
    expect(reasonOf(() => assertTransferable({ ...SOURCE, classGroupStatus: "finished" }))).toBe(
      "enrollment.transfer_class_group_not_running",
    );
    expect(reasonOf(() => assertTransferable({ ...SOURCE, classGroupStatus: "enrolling" }))).toBeNull();
    expect(reasonOf(() => assertTransferable({ ...SOURCE, graded: true }))).toBe("enrollment.transfer_graded");
    expect(reasonOf(() => assertTransferable({ ...SOURCE, procedureOpen: true }))).toBe("enrollment.transfer_procedure_open");
  });

  it("gives it to someone without a seat in the course, old enough, with a guardian if a minor", () => {
    expect(reasonOf(() => assertReceivable(DESTINATION, 12))).toBeNull();
    expect(reasonOf(() => assertReceivable({ ...DESTINATION, enrolledInCourse: true }, 12))).toBe(
      "enrollment.transfer_student_already_enrolled",
    );
    expect(reasonOf(() => assertReceivable({ ...DESTINATION, birthDate: yearsAgo(10) }, 12))).toBe(
      "enrollment.transfer_student_below_minimum_age",
    );
    expect(reasonOf(() => assertReceivable({ ...DESTINATION, birthDate: yearsAgo(14) }, 12))).toBe(
      "enrollment.transfer_guardian_required",
    );
    expect(reasonOf(() => assertReceivable({ ...DESTINATION, birthDate: yearsAgo(14), hasLiveGuardian: true }, 12))).toBeNull();
  });

  it("transfers with the reason in the trail, then opens the destination's portal", async () => {
    const { run, transfers, provisioned } = useCase();
    const result = await run.run({ actorId: "staff", enrollmentId: "e1", toStudentId: "s2", reason: "  Cede a su hermana  " });

    expect(result).toEqual({ enrollmentId: "e1", studentId: "s2", portalAccess: "created" });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ enrollmentId: "e1", fromStudentId: "s1", toStudentId: "s2", courseId: "c1" });
    expect(transfers[0]!.audit).toMatchObject({
      actorId: "staff",
      action: "enrollment.transferred",
      metadata: { studentId: "s2", fromStudentId: "s1", classGroupId: "g1", reason: "Cede a su hermana" },
    });
    expect(provisioned).toHaveLength(1);
    expect(provisioned[0]).toMatchObject({ studentId: "s2", actorId: "staff" });
    expect(provisioned[0]!.guardian).toBeDefined();
  });

  it("refuses an empty reason, the same student, and unknown ids — without writing anything", async () => {
    const reject = async (fixture: ReturnType<typeof useCase>, toStudentId: string, reason: string) => {
      await expect(fixture.run.run({ actorId: "staff", enrollmentId: "e1", toStudentId, reason })).rejects.toBeDefined();
      expect(fixture.transfers).toHaveLength(0);
      expect(fixture.provisioned).toHaveLength(0);
    };

    const empty = useCase();
    await expect(empty.run.run({ actorId: "staff", enrollmentId: "e1", toStudentId: "s2", reason: "   " })).rejects.toMatchObject({
      reason: "enrollment.transfer_reason_required",
    });
    await reject(empty, "s2", "   ");

    const same = useCase();
    await expect(same.run.run({ actorId: "staff", enrollmentId: "e1", toStudentId: "s1", reason: "x" })).rejects.toMatchObject({
      reason: "enrollment.transfer_same_student",
    });
    await reject(same, "s1", "x");

    const noEnrollment = useCase({ source: null });
    await expect(noEnrollment.run.run({ actorId: "staff", enrollmentId: "e1", toStudentId: "s2", reason: "x" })).rejects.toBeInstanceOf(
      EnrollmentNotFoundError,
    );
    await reject(noEnrollment, "s2", "x");

    const noStudent = useCase({ destination: null });
    await expect(noStudent.run.run({ actorId: "staff", enrollmentId: "e1", toStudentId: "s2", reason: "x" })).rejects.toBeInstanceOf(
      EnrollmentTransferStudentNotFoundError,
    );
    await reject(noStudent, "s2", "x");
  });
});
