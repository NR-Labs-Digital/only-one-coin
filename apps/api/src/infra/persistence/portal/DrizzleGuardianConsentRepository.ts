import { consents, guardians, students } from "@ooc/db";
import type { GuardianConsentSubject, IGuardianConsentRepository, NewGuardianConsent } from "@ooc/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { profilesOfAccount } from "./accountProfiles.js";

/**
 * The guardian's consent as the portal reads and writes it (OOC-72). The
 * profile is found among the account's own (`profilesOfAccount`, the one
 * reach definition) and exactly — `pickProfile`'s fallback to the default
 * profile is right for a read and wrong for an acceptance.
 */
export class DrizzleGuardianConsentRepository implements IGuardianConsentRepository {
  constructor(private readonly db: Db) {}

  async findSubject(userId: string, profileId: string): Promise<GuardianConsentSubject | null> {
    const profiles = await profilesOfAccount(this.db, userId);
    const profile = profiles.find((candidate) => candidate.fileIds.includes(profileId));
    if (!profile) return null;

    const [file] = await this.db
      .select({ birthDate: students.birthDate })
      .from(students)
      .where(eq(students.id, profile.id))
      .limit(1);
    const account = await this.db.execute<{ email: string }>(sql`select "email" from "user" where "id" = ${userId} limit 1`);
    const accountEmail = account.rows[0]?.email;
    if (!file || !accountEmail) return null;

    const [guardian] = await this.db
      .select({
        id: guardians.id,
        email: guardians.email,
        // Qualified by hand: in a one-table select Drizzle prints `guardians.id`
        // as a bare "id", which inside the subquery is the consent's own id.
        consentGiven: sql<boolean>`exists (select 1 from ${consents} c where c."guardian_id" = "guardians"."id")`,
      })
      .from(guardians)
      .where(and(eq(guardians.studentId, profile.id), isNull(guardians.deletedAt)))
      .limit(1);

    return {
      studentId: profile.id,
      birthDate: file.birthDate,
      guardian: guardian ? { id: guardian.id, email: guardian.email } : null,
      consentGiven: guardian?.consentGiven ?? false,
      accountEmail,
    };
  }

  async appendIfAbsent(consent: NewGuardianConsent): Promise<boolean> {
    // One statement, so a double click does not write two acceptances. Two
    // truly simultaneous ones could still both pass the `not exists` under
    // READ COMMITTED — harmless on an append-only record, where the current
    // consent is simply the newest row.
    const inserted = await this.db.execute(sql`
      insert into ${consents} ("guardian_id", "version", "accepted_at", "ip")
      select ${consent.guardianId}, ${consent.version}, ${consent.acceptedAt}, ${consent.ip}
       where not exists (select 1 from ${consents} c where c."guardian_id" = ${consent.guardianId})
      returning "id"`);
    return inserted.rows.length > 0;
  }
}
