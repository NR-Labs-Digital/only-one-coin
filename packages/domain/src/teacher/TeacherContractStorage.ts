import type { PresignedReceiptUpload } from "../enrollment/ReceiptStorage.js";

/** Same shape as the receipt's: a presigned POST the browser sends the file to. */
export type PresignedContractUpload = PresignedReceiptUpload;

/**
 * The bucket, as filing a contract needs it (OOC-81). The bytes go from the
 * browser straight to the bucket (CLAUDE.md §6). Filing reads the size first
 * and only then the file — at most the size cap — to open it as a PDF.
 */
export interface ITeacherContractStorage {
  /** A one-time upload target for `objectKey`, capped at `maxBytes` by the bucket's policy. */
  createUploadTarget(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedContractUpload>;

  /** The size of what landed at `objectKey` (a HEAD). `null` when nothing is there. */
  size(objectKey: string): Promise<number | null>;

  /** The whole object. Called only after `size` said it is within the cap. */
  read(objectKey: string): Promise<Uint8Array>;

  /** Removes an upload that was refused, so it does not sit in the bucket unfiled. */
  delete(objectKey: string): Promise<void>;

  /**
   * A short-lived GET URL that downloads the file under `fileName` — the only
   * way a person opens a contract (CLAUDE.md §8). The caller logs the access.
   */
  createDownloadUrl(params: { objectKey: string; fileName: string; expiresInSeconds: number }): Promise<string>;
}
