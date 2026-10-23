import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { isOwnClassGroup, ownTeacherId } from "./teachingScope.js";
import type { ITeachingReader, TeachingClassGroup } from "./TeachingReader.js";

export interface ListOwnClassGroupsInput {
  /** The session's account — never an id the client sent. */
  userId: string;
}

/**
 * The signed-in teacher's class groups (OOC-82). The adapter already narrows
 * by teacher; the usecase checks every row again, so what leaves here is the
 * teacher's whatever the query underneath does.
 */
export class ListOwnClassGroupsUseCase extends BaseUseCase<ListOwnClassGroupsInput, TeachingClassGroup[]> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly reader: ITeachingReader,
  ) {
    super();
  }

  async run(input: ListOwnClassGroupsInput): Promise<TeachingClassGroup[]> {
    const teacherId = await ownTeacherId(this.teachers, input.userId);
    if (teacherId === null) return [];
    const groups = await this.reader.listClassGroupsOf(teacherId);
    return groups.filter((group) => isOwnClassGroup(teacherId, group));
  }
}
