-- OOC-96: the academic assistant cargo ("Assistente Acadêmico") joins the
-- staff board. "user" lives outside the Drizzle schema (Better Auth owns it),
-- so its CHECK is written by hand, as 0009 did.
ALTER TABLE "staff_invites" DROP CONSTRAINT "staff_invites_role_check";--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_role_check" CHECK ("staff_invites"."role" in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing'));--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_role_check";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing', 'student', 'guardian'));
