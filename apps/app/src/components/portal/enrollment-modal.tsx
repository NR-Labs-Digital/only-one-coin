'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Dialog, DialogContent, DialogDescription } from '@/components/ui/dialog'

/**
 * The modal an enrollment opens in, over the course list (OOC-144). Open is
 * the URL (`/portal/courses?enrollment=<id>`), not local state: the phone's
 * back button closes it, a reload keeps it open, and a link to one course
 * still lands on it. Closing goes back to the bare list without a scroll jump.
 *
 * The content is server-rendered (`EnrollmentDetail`) and passed in as
 * children. On a phone the dialog rises from the bottom (`components/ui/dialog.tsx`).
 */
export function EnrollmentModal({ children, courseName }: { children: ReactNode; courseName: string }) {
  const t = useTranslations('portal')
  const router = useRouter()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.replace('/portal/courses', { scroll: false })
      }}
    >
      <DialogContent closeLabel={t('course_detail.close')} className="sm:max-w-2xl">
        {/* Radix wants a description; the title is the course name inside. */}
        <DialogDescription className="sr-only">
          {t('course_detail.modal_description', { course: courseName })}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}
