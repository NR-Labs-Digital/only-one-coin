'use client'

import type { StudentDetail } from '@/lib/backoffice/types'
import { Card } from '@/components/backoffice/ui'
import { AttachmentsSection } from '@/components/attachments/attachments-section'
import type { AttachmentList } from '@/lib/attachments/types'

/**
 * Documents tab of the student file (OOC-148): one list of every document on
 * the file — uploaded by the student from the portal or attached by the team —
 * each labelled by who sent it, with a filter by origin. The same list the
 * student sees in the portal, worded for staff.
 *
 * The two screen-local blocks that sat here (issuing a document and the paid
 * requests) left: neither saved anything, and the requests block never had
 * data. Issuing the constancia and the certificate is the OOC-33, and they join
 * this list with their own label when it exists; the paid requests are decided
 * in Pagos.
 */
export function StudentDocuments({
  student,
  attachments,
  canManageAttachments,
}: {
  student: StudentDetail
  /** The student's documents, read on the server; null when the API failed. */
  attachments: AttachmentList | null
  /** Whether the reader's cargo attaches and removes documents (the API decides too). */
  canManageAttachments: boolean
}) {
  return (
    <Card className="p-5">
      <AttachmentsSection
        scope={{ kind: 'staff', ownerType: 'student', ownerId: student.id }}
        initial={attachments}
        variant="staff"
        canUpload={canManageAttachments}
        canRemove={canManageAttachments}
      />
    </Card>
  )
}
