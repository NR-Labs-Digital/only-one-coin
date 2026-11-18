'use client'

import type { StudentDetail } from '@/lib/backoffice/types'
import { Card } from '@/components/backoffice/ui'
import { AttachmentsSection } from '@/components/attachments/attachments-section'
import type { AttachmentList } from '@/lib/attachments/types'
import type { IssuedDocumentItem } from '@/lib/issued-documents/types'

/**
 * Documents tab of the student file (OOC-148): one list of every document on
 * the file — uploaded by the student from the portal or attached by the team —
 * each labelled by who sent it, with a filter by origin. The same list the
 * student sees in the portal, worded for staff.
 *
 * The constancia and the certificate the institution issued (OOC-33) join the
 * list with their own label and code. They are issued elsewhere — the
 * constancia once its payment is approved in Pagos, the certificate in the
 * class group's batch — never from here.
 */
export function StudentDocuments({
  student,
  attachments,
  issuedDocuments,
  canManageAttachments,
}: {
  student: StudentDetail
  /** The student's documents, read on the server; null when the API failed. */
  attachments: AttachmentList | null
  /** The documents the institution issued (OOC-33); null when the API failed. */
  issuedDocuments: IssuedDocumentItem[] | null
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
        issued={issuedDocuments}
        issuedScope={{ kind: 'staff', studentId: student.id }}
      />
    </Card>
  )
}
