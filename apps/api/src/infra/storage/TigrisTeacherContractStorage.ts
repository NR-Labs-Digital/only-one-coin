import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ITeacherContractStorage } from "@ooc/domain";

/**
 * The `ITeacherContractStorage` port, on the same bucket and client as the
 * receipts (`teacher-contracts/<teacherId>/…`). Only opening is left: the
 * contracts filed under OOC-81 stay downloadable, and nothing is uploaded
 * since OOC-124.
 */
export class TigrisTeacherContractStorage implements ITeacherContractStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

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
