import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { ClassroomCredentialsUnavailableError, type ICredentialCipher } from "@ooc/domain";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Seals the shared Classroom passwords (OOC-196) with AES-256-GCM. The key is
 * derived (HKDF-SHA256) from BETTER_AUTH_SECRET under a label of its own —
 * the same secret the MFA recovery codes are sealed with (infra/auth/
 * recoveryCodes.ts), so no new secret is needed, and a different label so the
 * two never share a key. Rotating BETTER_AUTH_SECRET makes every sealed
 * password unreadable: the screen then answers 503 and coordination types the
 * passwords again.
 *
 * Stored as `v1:` + base64(iv ‖ tag ‖ ciphertext); the prefix leaves room for
 * a dedicated key later.
 */
export class AesGcmCredentialCipher implements ICredentialCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "ooc:classroom-credentials:v1", 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
  }

  open(sealed: string): string {
    const [version, payload] = sealed.split(":", 2);
    if (version !== VERSION || !payload) throw new ClassroomCredentialsUnavailableError();
    try {
      const raw = Buffer.from(payload, "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    } catch (error) {
      throw new ClassroomCredentialsUnavailableError({ cause: error });
    }
  }
}
