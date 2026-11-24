import { ConflictError } from "@ooc/domain";
import type { IStaffAccountProvisioner, ProvisionStaffAccountInput, ProvisionStaffAccountOutput } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";
import { insertCredentialUser } from "@/infra/auth/credentialAccount.js";
import { isUniqueViolation } from "@/infra/db/isUniqueViolation.js";

/**
 * Writes the account directly — Better Auth's sign-up is closed
 * (`disableSignUp`), server calls included. One transaction, so an invite
 * never leaves a "user" without its password behind. An e-mail that already
 * has an account is a 409, as Better Auth's sign-up used to answer.
 */
export class BetterAuthStaffAccountProvisioner implements IStaffAccountProvisioner {
  constructor(private readonly db: Db) {}

  async provision(input: ProvisionStaffAccountInput): Promise<ProvisionStaffAccountOutput> {
    try {
      const userId = await this.db.transaction((tx) =>
        insertCredentialUser(tx, {
          email: input.email,
          name: input.name,
          role: input.role,
          profileId: input.profileId,
          password: input.password,
        }),
      );
      return { userId };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError({
          reason: "staff_invite.email_taken",
          message: "An account with this e-mail already exists.",
          cause: error,
        });
      }
      throw error;
    }
  }
}
