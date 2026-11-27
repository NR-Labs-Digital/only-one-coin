'use client'

import { useRouter } from '@/i18n/navigation'
import type { CourseDetail, CourseLanguage, CourseRow } from '@/lib/backoffice/types'
import { NewCourseForm } from '../../new-course-form'

/** The form's two exits: the new course's page on save, the source's on cancel. */
export function DuplicateCourse({
  source,
  courses,
  languages,
}: {
  source: CourseDetail
  courses: CourseRow[]
  languages: CourseLanguage[]
}) {
  const router = useRouter()
  return (
    <NewCourseForm
      source={source}
      courses={courses}
      languages={languages}
      onCancel={() => router.push(`/backoffice/courses/${source.course.id}`)}
      onCreated={(id) => router.push(`/backoffice/courses/${id}?created=duplicate`)}
    />
  )
}
