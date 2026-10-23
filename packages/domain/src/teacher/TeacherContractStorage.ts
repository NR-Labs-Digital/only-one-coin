import type { PresignedReceiptUpload } from "../enrollment/ReceiptStorage.js";

/** Same shape as the receipt's: a presigned POST the browser sends the file to. */
export type PresignedContractUpload = PresignedReceiptUpload;

/**
 * The bucket, as filing a contract needs it (OOC-81). The bytes go from the
 * browser straight to the bucket (CLAUDE.md §6); `apps/api` reads back only
 * the size and the first few bytes, enough to tell a PDF from anything else.
 */
export interface ITeacherContractStorage {
  /** A one-time upload target for `objectKey`, capped at `maxBytes` by the bucket's policy. */
  createUploadTarget(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedContractUpload>;

  /**
   * What landed at `objectKey`: its size and its first `headBytes` bytes (a
   * ranged GET, never the whole file). `null` when nothing is there.
   */
  inspect(objectKey: string, headBytes: number): Promise<{ byteSize: number; head: Uint8Array } | null>;

  /** Removes an upload that was refused, so it does not sit in the bucket unfiled. */
  delete(objectKey: string): Promise<void>;

  /**
   * A short-lived GET URL that downloads the file under `fileName` — the only
   * way a person opens a contract (CLAUDE.md §8). The caller logs the access.
   */
  createDownloadUrl(params: { objectKey: string; fileName: string; expiresInSeconds: number }): Promise<string>;
}
