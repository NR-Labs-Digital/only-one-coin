import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { GetOwnClassGroupInput, GetOwnClassGroupUseCase } from "./GetOwnClassGroupUseCase.js";
import type { ITeachingReader, TeachingStudent } from "./TeachingReader.js";

/**
 * Who is in one of the signed-in teacher's class groups — names only. The
 * class group goes through the same check as reading it (`GetOwnClassGroupUseCase`)
 * before a single student is read, so another teacher's roster is a 404 like
 * their class group.
 */
export class ListOwnClassGroupStudentsUseCase extends BaseUseCase<GetOwnClassGroupInput, TeachingStudent[]> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly reader: ITeachingReader,
  ) {
    super();
  }

  async run(input: GetOwnClassGroupInput): Promise<TeachingStudent[]> {
    const group = await this.getOwnClassGroup.run(input);
    return this.reader.listStudents(group.id);
  }
}
