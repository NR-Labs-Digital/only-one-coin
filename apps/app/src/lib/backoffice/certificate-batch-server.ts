import { apiFetch } from './api-client'
import type { CertificateBatch } from './certificate-batch'

/** The batch (OOC-33), read on the server. Null when the API failed or refused. */
export async function getCertificateBatch(classGroupId: string, moduleId: string): Promise<CertificateBatch | null> {
  try {
    const response = await apiFetch(
      `/api/v1/catalog/class-groups/${encodeURIComponent(classGroupId)}/modules/${encodeURIComponent(moduleId)}/certificates`,
    )
    if (!response.ok) return null
    return (await response.json()) as CertificateBatch
  } catch {
    return null
  }
}
