import { z } from "zod";
import { container } from "@/container.js";
import type { GradeRegisterRecordListItem } from "@/documents/GradeRegisterRecordService.js";
import { contentDisposition } from "@/infra/storage/contentDisposition.js";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";

/**
 * The teacher's acta de notas (OOC-176): the PDF of an official grade
 * register. Coordination and administration list and download every one
 * (`grades.register_records`); the teacher, only their own, from the portal.
 * No grade travels here — only the counts.
 */

const RecordRowSchema = z.object({
  registerId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  classGroupModuleId: z.string().uuid(),
  round: z.number().int(),
  classGroupCode: z.string(),
  classGroupStatus: z.string(),
  courseName: z.string(),
  academicPeriodId: z.string().uuid(),
  academicPeriodName: z.string(),
  module: z.number().int().nullable(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string().nullable(),
  /** ISO 8601, UTC. */
  confirmedAt: z.string().datetime(),
  confirmedByName: z.string().nullable(),
  students: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  didNotSit: z.number().int(),
  /** ISO 8601, UTC — the last correction after official; null when none. */
  correctedAt: z.string().datetime().nullable(),
  /** ISO 8601, UTC — the first download; null while nobody downloaded it. */
  recordedAt: z.string().datetime().nullable(),
});

const RecordListSchema = z.object({ items: z.array(RecordRowSchema) });

function serialize(row: GradeRegisterRecordListItem): z.infer<typeof RecordRowSchema> {
  return {
    registerId: row.registerId,
    classGroupId: row.classGroupId,
    classGroupModuleId: row.classGroupModuleId,
    round: row.round,
    classGroupCode: row.classGroupCode,
    classGroupStatus: row.classGroupStatus,
    courseName: row.courseName,
    academicPeriodId: row.academicPeriodId,
    academicPeriodName: row.academicPeriodName,
    module: row.module,
    teacherId: row.teacherId,
    teacherName: row.teacherName,
    confirmedAt: row.confirmedAt.toISOString(),
    confirmedByName: row.confirmedByName,
    students: row.students,
    passed: row.passed,
    failed: row.failed,
    didNotSit: row.didNotSit,
    correctedAt: row.correctedAt ? row.correctedAt.toISOString() : null,
    recordedAt: row.record ? row.record.recordedAt.toISOString() : null,
  };
}

const RegisterParamsSchema = z.object({ registerId: z.string().uuid() });

export const listGradeRegisterRecordsRoute = RouteBuilder.get("/grade-register-records")
  .docs({
    tags: ["Teaching"],
    summary: "The actas de notas: every official grade register, newest confirmation first",
    description: "Class groups closed or retired included — erased ones are not. Counts only, never a grade.",
  })
  .can("grades.register_records")
  .query(z.object({ period: z.string().uuid().optional(), teacher: z.string().uuid().optional() }))
  .response(200, RecordListSchema)
  .handler(async (request, reply) => {
    const items = await container.documents.gradeRegisterRecords.list({
      academicPeriodId: request.query.period ?? null,
      teacherId: request.query.teacher ?? null,
    });
    reply.status(200).send({ items: items.map(serialize) });
  });

export const downloadGradeRegisterRecordRoute = RouteBuilder.get("/grade-register-records/:registerId/pdf")
  .docs({
    tags: ["Teaching"],
    summary: "Download the acta de notas of an official grade register",
    description:
      "Responds with the PDF itself. The first download records the acta with the published template version (422 `document_template.not_published` without one).",
  })
  .can("grades.register_records")
  .params(RegisterParamsSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { pdf, fileName } = await container.documents.gradeRegisterRecords.download({
      actorId: request.currentUser!.id,
      registerId: request.params.registerId,
    });
    reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", contentDisposition(fileName, fileName))
      .header("Cache-Control", "no-store")
      .send(Buffer.from(pdf));
  });

export const listOwnGradeRegisterRecordsRoute = RouteBuilder.get("/teaching/grade-register-records")
  .docs({
    tags: ["Teaching"],
    summary: "The signed-in teacher's actas de notas",
    description: "Their own runs' official registers, the class group closed or not. A teacher with no file gets an empty list.",
  })
  .can("teaching.own_grades")
  .response(200, RecordListSchema)
  .handler(async (request, reply) => {
    const items = await container.documents.gradeRegisterRecords.listOwn(request.currentUser!.id);
    reply.status(200).send({ items: items.map(serialize) });
  });

export const downloadOwnGradeRegisterRecordRoute = RouteBuilder.get("/teaching/grade-register-records/:registerId/pdf")
  .docs({
    tags: ["Teaching"],
    summary: "Download one of the signed-in teacher's actas de notas",
    description: "Another teacher's acta is the same 404 as one that does not exist.",
  })
  .can("teaching.own_grades")
  .params(RegisterParamsSchema)
  .response(404, ErrorResponseSchema)
  .response(422, ErrorResponseSchema)
  .response(503, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const { pdf, fileName } = await container.documents.gradeRegisterRecords.download({
      actorId: request.currentUser!.id,
      registerId: request.params.registerId,
      teacherUserId: request.currentUser!.id,
    });
    reply
      .status(200)
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", contentDisposition(fileName, fileName))
      .header("Cache-Control", "no-store")
      .send(Buffer.from(pdf));
  });
