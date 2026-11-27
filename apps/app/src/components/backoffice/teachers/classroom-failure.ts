import type { TeacherSaveFailure } from '@/lib/backoffice/save-teacher'

/** The teacher form's answer when the Classroom account picked was refused (OOC-196). */
export function classroomFailureMessage(
  failure: TeacherSaveFailure,
  t: (key: 'teachers.save_error_classroom_full' | 'teachers.save_error_classroom_gone' | 'teachers.save_error_classroom_inactive') => string,
): string | null {
  switch (failure.kind) {
    case 'classroom_full':
      return t('teachers.save_error_classroom_full')
    case 'classroom_gone':
      return t('teachers.save_error_classroom_gone')
    case 'classroom_inactive':
      return t('teachers.save_error_classroom_inactive')
    default:
      return null
  }
}
