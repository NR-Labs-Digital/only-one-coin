import type { IPortalProfileFileRepository } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";
import { profilesOfAccount } from "./accountProfiles.js";

/**
 * The file a portal write lands on (OOC-110): the profile is found among the
 * account's own (`profilesOfAccount`, the one reach definition) and exactly —
 * `pickProfile`'s fallback to the default profile is right for a read and
 * wrong for a write. The file is the profile's id, the newest of the person's
 * files, the one the portal shows.
 */
export class DrizzlePortalProfileFileRepository implements IPortalProfileFileRepository {
  constructor(private readonly db: Db) {}

  async findProfileFileId(userId: string, profileId: string): Promise<string | null> {
    const profiles = await profilesOfAccount(this.db, userId);
    return profiles.find((profile) => profile.fileIds.includes(profileId))?.id ?? null;
  }
}
