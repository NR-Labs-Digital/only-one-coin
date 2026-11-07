import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AttachmentInspection, IAttachmentStorage, PresignedReceiptUpload } from "@ooc/domain";
import { fileTypeFromBuffer } from "file-type";
import { contentDisposition } from "./contentDisposition.js";

/** Same life as the receipt's upload target: long enough for a slow mobile
 * upload, short enough that a leaked URL is not a standing door. */
const UPLOAD_TARGET_EXPIRY_SECONDS = 5 * 60;

/** Enough of the head of a file for `file-type` to name every type we accept. */
const SNIFF_BYTES = 4100;

/**
 * The `IAttachmentStorage` port (OOC-143), on the one bucket and client the
 * receipts use, under `documents/<id>`.
 *
 * Unlike the receipt's confirm (a HEAD), `inspect` reads the object once: the
 * checksum and the magic bytes are only in the bytes. The read is streamed —
 * hashed chunk by chunk, keeping only the first few KB for the type check — so
 * a 10 MB file never sits whole in memory. Attachments are sent one at a time
 * by a person, not by the checkout's crowd, so this is a cost the volume bears.
 */
export class TigrisAttachmentStorage implements IAttachmentStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async createUploadTarget(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedReceiptUpload> {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: params.objectKey,
      Expires: UPLOAD_TARGET_EXPIRY_SECONDS,
      Conditions: [
        ["content-length-range", 1, params.maxBytes],
        { "Content-Type": params.contentType },
      ],
      Fields: { "Content-Type": params.contentType },
    });
    return { url, fields };
  }

  async inspect(objectKey: string): Promise<AttachmentInspection | null> {
    let head;
    try {
      head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }

    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!result.Body) return null;

    const hash = createHash("sha256");
    const headChunks: Buffer[] = [];
    let headLength = 0;
    let byteSize = 0;
    // Body is a Node.js Readable at runtime under the Node SDK.
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      byteSize += buffer.length;
      if (headLength < SNIFF_BYTES) {
        headChunks.push(buffer);
        headLength += buffer.length;
      }
    }

    const detected = await fileTypeFromBuffer(Buffer.concat(headChunks).subarray(0, SNIFF_BYTES));
    return {
      byteSize: byteSize || (head.ContentLength ?? 0),
      checksumSha256: hash.digest("hex"),
      detectedType: detected?.mime ?? null,
    };
  }

  async createDownloadUrl(params: {
    objectKey: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        ResponseContentType: params.contentType,
        ResponseContentDisposition: contentDisposition(params.fileName, "file"),
      }),
      { expiresIn: params.expiresInSeconds },
    );
  }

  async delete(objectKey: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: unknown }).name;
  return name === "NotFound" || name === "NoSuchKey";
}
