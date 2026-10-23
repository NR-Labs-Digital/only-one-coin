import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ITeacherContractStorage, PresignedContractUpload } from "@ooc/domain";

/** Long enough for a scanned PDF on a slow connection; same as the receipt's. */
const UPLOAD_TARGET_EXPIRY_SECONDS = 5 * 60;

/**
 * The `ITeacherContractStorage` port, on the same bucket and client as the
 * receipts (`teacher-contracts/<teacherId>/…`), so the bucket's CORS rule for
 * the backoffice origin already covers it. A presigned POST for the same reason
 * as the receipt's: only its policy lets the bucket refuse an oversized file.
 */
export class TigrisTeacherContractStorage implements ITeacherContractStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async createUploadTarget(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedContractUpload> {
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

  async inspect(objectKey: string, headBytes: number): Promise<{ byteSize: number; head: Uint8Array } | null> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey, Range: `bytes=0-${headBytes - 1}` }),
      );
      const bytes = result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
      return { byteSize: head.ContentLength ?? 0, head: bytes };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async createDownloadUrl(params: { objectKey: string; fileName: string; expiresInSeconds: number }): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: contentDisposition(params.fileName),
      }),
      { expiresIn: params.expiresInSeconds },
    );
  }
}

/**
 * `attachment` with the name the person filed it under: an ASCII fallback for
 * old clients and the UTF-8 form (RFC 6266) for the accents a Peruvian name has.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "contrato.pdf";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: unknown }).name;
  return name === "NotFound" || name === "NoSuchKey";
}
