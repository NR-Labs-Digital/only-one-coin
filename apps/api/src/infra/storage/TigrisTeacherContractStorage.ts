import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ITeacherContractStorage } from "@ooc/domain";
import { contentDisposition } from "./contentDisposition.js";

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
        ResponseContentDisposition: contentDisposition(params.fileName, "contrato.pdf"),
      }),
      { expiresIn: params.expiresInSeconds },
    );
  }
}
