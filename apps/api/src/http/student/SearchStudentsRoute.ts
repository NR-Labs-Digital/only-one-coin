import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { ErrorResponseSchema } from "@/shared/http/ErrorResponseSchema.js";
import { container } from "@/container.js";
import { serializeStudentRow, StudentListRowSchema } from "./ListStudentsRoute.js";

// The floor keeps a search box from turning into a directory-enumeration
// primitive — a capped match list, never a browse.
const SearchStudentsQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

const SearchStudentsResponseSchema = z.object({ items: z.array(StudentListRowSchema) });

/**
 * The manual enrollment form's and the waitlist's student picker (CLAUDE.md
 * §1, "só sobre aluno já cadastrado"). Unlike the directory it finds a
 * student whose only seat is still under review — staff searching a document
 * must find the file that already exists, or they would register the person
 * twice.
 */
export const searchStudentsRoute = RouteBuilder.get("/students/search")
  .docs({
    tags: ["Students"],
    summary: "Find a student by partial name or national id",
    description: "Backs the manual enrollment and waitlist pickers — a short, capped match list.",
  })
  .can("students.view")
  .query(SearchStudentsQuerySchema)
  .response(200, SearchStudentsResponseSchema)
  .response(400, ErrorResponseSchema)
  .handler(async (request, reply) => {
    const items = await container.queries.listStudents.search(request.query.q);
    reply.status(200).send({ items: items.map(serializeStudentRow) });
  });
