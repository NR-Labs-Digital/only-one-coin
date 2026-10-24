-- OOC-122: the general audit log pages the whole trail newest first by
-- (created_at, id) and filters by who did it. Indexes only, no data touched.
CREATE INDEX "audit_log_created_at_id_idx" ON "audit_log" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log" USING btree ("actor_id","created_at");