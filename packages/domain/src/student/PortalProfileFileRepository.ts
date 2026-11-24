/**
 * Which file a portal profile writes to (OOC-110). A profile groups every
 * file of one person the account reaches (OOC-147); a write lands on the
 * profile's own file — the newest, the one the portal shows.
 */
export interface IPortalProfileFileRepository {
  /**
   * The file of the profile `profileId` names among the account's own —
   * exactly, with no fallback to the default profile: writing to the wrong
   * child is the one thing this must never do. Null when the id is not one
   * of them.
   */
  findProfileFileId(userId: string, profileId: string): Promise<string | null>;
}
