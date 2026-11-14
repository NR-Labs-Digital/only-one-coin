import { z } from "zod";

/**
 * The profile a portal read is about (OOC-147): any file id of the person,
 * as the app keeps it in a cookie. It only picks among the account's own
 * profiles (`pickProfile`), so an unknown or malformed value reads as the
 * default profile — never a 400 that a stale cookie would turn into a broken
 * portal.
 */
export const PortalProfileQuerySchema = z.object({
  profile: z.string().uuid().optional().catch(undefined),
});

export const requestedProfile = (query: { profile?: string | undefined }): string | null => query.profile ?? null;
