/**
 * The bucket, as the contracts filed under OOC-81 still need it: a way to open
 * one. Nothing is uploaded any more (OOC-124) — a contract is generated from
 * the published template, and the signed copy is kept outside the platform.
 */
export interface ITeacherContractStorage {
  /**
   * A short-lived GET URL that downloads the file under `fileName` — the only
   * way a person opens a filed contract (CLAUDE.md §8). The caller logs the access.
   */
  createDownloadUrl(params: { objectKey: string; fileName: string; expiresInSeconds: number }): Promise<string>;
}
