import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

/** How many recovery codes a set has, and how long each one is before the dash. */
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;

/**
 * How the recovery codes are stored in `"twoFactor"."backupCodes"`: the JSON
 * array, encrypted with the auth secret. Better Auth's own default
 * (`storeBackupCodes: "encrypted"`) does the same with a key it keeps
 * internal; handing it this pair instead lets apps/api write the row itself
 * (`BetterAuthStaffSecondFactor`) — the plugin only issues codes through
 * endpoints that need a TOTP set-up or the password, and neither fits an
 * e-mail factor turned on by its own code.
 *
 * Reversible on purpose: the plugin verifies a code by decrypting the list
 * and comparing, so a hash would never match.
 */
export function recoveryCodeCipher(secret: string) {
  return {
    encrypt: (data: string) => symmetricEncrypt({ key: secret, data }),
    decrypt: (data: string) => symmetricDecrypt({ key: secret, data }),
  };
}

export type RecoveryCodeCipher = ReturnType<typeof recoveryCodeCipher>;

/** Same shape as Better Auth's own: `xxxxx-xxxxx`, letters and digits. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const code = generateRandomString(RECOVERY_CODE_LENGTH, "a-z", "0-9", "A-Z");
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}
