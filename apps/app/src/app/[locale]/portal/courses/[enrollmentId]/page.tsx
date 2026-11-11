import { redirect } from '@/i18n/navigation'

/**
 * The enrollment used to be its own page; since OOC-144 it opens in a modal
 * over the course list. This address stays so links already out there — the
 * home cards, a bookmark, an e-mail — still land on the right course. Whether
 * the id is the student's own is checked by the list, which opens nothing for
 * one that is not (CLAUDE.md §8).
 */
export default async function CourseDetailRedirect({
  params,
}: {
  params: Promise<{ locale: string; enrollmentId: string }>
}) {
  const { locale, enrollmentId } = await params
  redirect({ href: `/portal/courses?enrollment=${encodeURIComponent(enrollmentId)}`, locale })
}
