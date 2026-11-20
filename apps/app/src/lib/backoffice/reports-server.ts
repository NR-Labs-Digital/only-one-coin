import { apiFetch } from './api-client'
import type { Report, ReportQuery } from './reports'

/**
 * `GET /api/v1/reports`, read on the server. `null` = the API failed or
 * refused. Apart from `reports.ts` because the client view imports that file,
 * and `apiFetch` reads the session cookie through `next/headers`.
 */
export async function getReport(query: ReportQuery): Promise<Report | null> {
  const params = new URLSearchParams({ dimension: query.dimension })
  if (query.period) params.set('period', query.period)
  try {
    const response = await apiFetch(`/api/v1/reports?${params.toString()}`)
    if (!response.ok) return null
    return (await response.json()) as Report
  } catch {
    return null
  }
}
