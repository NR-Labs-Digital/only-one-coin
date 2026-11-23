import {
  VERIFICATION_CODE_ALPHABET,
  certificateBlockReason,
  closesTheCourse,
  issuedDocumentStatus,
  newDocumentCode,
  normalizeDocumentCode,
  type CertificateCandidate,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";

/** The certificate rule and the verification code (OOC-33), pure. */

const pass = (score: number) => ({ score, didNotSit: false as const });
const DA = { score: null, didNotSit: true as const };

function candidate(overrides: Partial<CertificateCandidate> = {}): CertificateCandidate {
  return { enrollmentId: "e", lastModuleGrade: pass(16), earlierModuleGrades: [], alreadyIssued: false, ...overrides };
}

const RULE = { passingGrade: 14, examRequired: false, examApproved: false };

describe("certificateBlockReason (OOC-33)", () => {
  it("issues on a passing last-module grade", () => {
    expect(certificateBlockReason(candidate(), RULE)).toBeNull();
    // Compared as typed: exactly the pass mark passes.
    expect(certificateBlockReason(candidate({ lastModuleGrade: pass(14) }), RULE)).toBeNull();
  });

  it("refuses below the pass mark, on DA, and while no grade is posted", () => {
    expect(certificateBlockReason(candidate({ lastModuleGrade: pass(13.99) }), RULE)).toBe("grade_below_minimum");
    expect(certificateBlockReason(candidate({ lastModuleGrade: DA }), RULE)).toBe("did_not_sit");
    expect(certificateBlockReason(candidate({ lastModuleGrade: null }), RULE)).toBe("grade_pending");
  });

  it("reads the pass mark it is given, never a constant", () => {
    expect(certificateBlockReason(candidate({ lastModuleGrade: pass(12) }), { ...RULE, passingGrade: 11 })).toBeNull();
  });

  it("refuses when an earlier module on the platform failed, and lets a missing one through", () => {
    expect(
      certificateBlockReason(candidate({ earlierModuleGrades: [{ module: 1, grade: pass(15) }, { module: 2, grade: pass(10) }] }), RULE),
    ).toBe("earlier_module_failed");
    expect(certificateBlockReason(candidate({ earlierModuleGrades: [{ module: 2, grade: DA }] }), RULE)).toBe(
      "earlier_module_failed",
    );
    // Module 1 and 2 have no grade on the platform (before 09/11/2026): not a block.
    expect(certificateBlockReason(candidate({ earlierModuleGrades: [{ module: 3, grade: pass(14) }] }), RULE)).toBeNull();
  });

  it("asks for coordination's exam mark when the course requires the certification exam", () => {
    const exam = { ...RULE, examRequired: true };
    expect(certificateBlockReason(candidate(), exam)).toBe("exam_not_approved");
    expect(certificateBlockReason(candidate(), { ...exam, examApproved: true })).toBeNull();
    // The grade still comes first: a mark never issues below the pass mark.
    expect(certificateBlockReason(candidate({ lastModuleGrade: pass(9) }), { ...exam, examApproved: true })).toBe(
      "grade_below_minimum",
    );
  });

  it("never issues twice", () => {
    expect(certificateBlockReason(candidate({ alreadyIssued: true }), RULE)).toBe("already_issued");
  });
});

describe("closesTheCourse (OOC-33)", () => {
  it("is the course's last module", () => {
    expect(closesTheCourse({ module: 4, fullCourse: false }, 4)).toBe(true);
    expect(closesTheCourse({ module: 3, fullCourse: false }, 4)).toBe(false);
  });

  it("takes the unnumbered module group only on a single-module course", () => {
    expect(closesTheCourse({ module: null, fullCourse: false }, 1)).toBe(true);
    expect(closesTheCourse({ module: null, fullCourse: false }, 4)).toBe(false);
    expect(closesTheCourse({ module: 1, fullCourse: false }, 1)).toBe(true);
  });

  it("never a full-course run (split per module since 0059)", () => {
    expect(closesTheCourse({ module: null, fullCourse: true }, 1)).toBe(false);
  });
});

describe("the verification code (OOC-33)", () => {
  it("is OOC- and two groups of four from an unambiguous alphabet", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = newDocumentCode();
      expect(code).toMatch(/^OOC-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      expect([...code.slice(4).replace("-", "")].every((character) => VERIFICATION_CODE_ALPHABET.includes(character))).toBe(true);
      // Nothing two people read alike: no 0/O, 1/I/L after the prefix.
      expect(code.slice(4)).not.toMatch(/[01ILO]/);
    }
  });

  it("draws from the random source it is given", () => {
    expect(newDocumentCode((length) => new Uint8Array(length))).toBe("OOC-2222-2222");
  });

  it("reads back what somebody typed, and refuses what cannot be a code", () => {
    expect(normalizeDocumentCode(" ooc 7k4m 9qx2 ")).toBe("OOC-7K4M-9QX2");
    expect(normalizeDocumentCode("7K4M9QX2")).toBe("OOC-7K4M-9QX2");
    expect(normalizeDocumentCode("OOC-7K4M-9QX")).toBeNull();
    expect(normalizeDocumentCode("OOC-0K4M-9QX2")).toBeNull();
  });
});

describe("issuedDocumentStatus (OOC-59)", () => {
  it("is valid until a person revokes it", () => {
    expect(issuedDocumentStatus({ revoked: false, replaced: false })).toBe("valid");
    expect(issuedDocumentStatus({ revoked: true, replaced: false })).toBe("revoked");
  });

  it("says replaced once another was issued in its place — there is a good one now", () => {
    expect(issuedDocumentStatus({ revoked: true, replaced: true })).toBe("replaced");
  });
});
