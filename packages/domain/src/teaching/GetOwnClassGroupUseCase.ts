import { CatalogClassGroupNotFoundError } from "../catalog/errors.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { isOwnClassGroup, ownTeacherId } from "./teachingScope.js";
import type { ITeachingReader, TeachingClassGroup } from "./TeachingReader.js";

export interface GetOwnClassGroupInput {
  /** The session's account — never an id the client sent. */
  userId: string;
  /** From the URL: what is asked for, never proof of whose it is. */
  classGroupId: string;
}

/**
 * One of the signed-in teacher's class groups (OOC-82). Somebody else's, one
 * closed or still a draft, and one that does not exist all answer the same
 * 404: the id in the URL is guessable, so telling them apart would say which
 * ids are real (anti-IDOR, CLAUDE.md §8).
 */
export class GetOwnClassGroupUseCase extends BaseUseCase<GetOwnClassGroupInput, TeachingClassGroup> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly reader: ITeachingReader,
  ) {
    super();
  }

  async run(input: GetOwnClassGroupInput): Promise<TeachingClassGroup> {
    const teacherId = await ownTeacherId(this.teachers, input.userId);
    if (teacherId === null) throw new CatalogClassGroupNotFoundError();
    const group = await this.reader.findClassGroup(input.classGroupId);
    if (!group || !isOwnClassGroup(teacherId, group)) throw new CatalogClassGroupNotFoundError();
    return group;
  }
}
