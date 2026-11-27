import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { backupTakenAt, isBackupKey, type BackupFile, type IBackupStore } from "@ooc/domain";

/**
 * The backups bucket the API deploy writes its `pg_dump` to (OOC-153). Read
 * only: this process lists and downloads, and never writes or deletes there —
 * the 30-day retention is the bucket's own.
 */
export class TigrisBackupStore implements IBackupStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async list(): Promise<BackupFile[]> {
    const files: BackupFile[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: "ooc-prod-", ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        const key = object.Key;
        if (!key || !isBackupKey(key)) continue;
        files.push({ key, takenAt: backupTakenAt(key)!, sizeBytes: object.Size ?? 0 });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return files.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  /** The gzip, as a stream — never buffered whole in memory. `null` when it is gone. */
  async open(key: string): Promise<Readable | null> {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return object.Body as Readable;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}
