// Client-safe: the same-origin `/api/v1` proxy, never the database (CLAUDE.md §8).

/**
 * The two steps of a complaints book sheet (OOC-58). Answers `done`, or a key
 * of `complaints.errors.*` the screen says — never the API's text.
 */
export type ComplaintStepResult = 'done' | 'already_taken' | 'already_answered' | 'answer_required' | 'failed'

async function step(path: string, body?: unknown): Promise<ComplaintStepResult> {
  try {
    const response = await fetch(`/api/v1/complaints/${path}`, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.ok) return 'done'
    const failure = (await response.json().catch(() => null)) as { reason?: string } | null
    switch (failure?.reason) {
      case 'complaint.already_taken':
        return 'already_taken'
      case 'complaint.already_answered':
        return 'already_answered'
      case 'complaint.answer_required':
        return 'answer_required'
      default:
        return 'failed'
    }
  } catch {
    return 'failed'
  }
}

/** Takes the sheet: the inbox stops counting it as unread. */
export function takeComplaint(id: string) {
  return step(`${encodeURIComponent(id)}/take`)
}

/** Answers the sheet; the answer is e-mailed to the consumer and never changes. */
export function answerComplaint(id: string, answer: string) {
  return step(`${encodeURIComponent(id)}/answer`, { answer })
}
