import { z } from "zod";
import { RouteBuilder } from "@/shared/http/RouteBuilder.js";
import { container } from "@/container.js";

// The figures on the teacher's home. Pending grades and certificates are not
// here until they exist (OOC-38, OOC-33) — a zero before then would be a lie.
export const getTeachingSummaryRoute = RouteBuilder.get("/teaching/summary")
  .docs({
    tags: ["Teaching"],
    summary: "The signed-in teacher's home figures",
    description: "Class groups teaching (enrolling or running), class groups in the portal, confirmed students across the ones teaching.",
  })
  .roles("teacher")
  .response(200, z.object({ teaching: z.number().int(), inPortal: z.number().int(), students: z.number().int() }))
  .handler(async (request, reply) => {
    const summary = await container.useCases.teaching.summary.run({ userId: request.currentUser!.id });
    reply.status(200).send(summary);
  });
