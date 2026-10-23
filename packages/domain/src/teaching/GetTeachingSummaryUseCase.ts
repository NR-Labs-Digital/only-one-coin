import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { ListOwnClassGroupsInput, ListOwnClassGroupsUseCase } from "./ListOwnClassGroupsUseCase.js";
import { isTeaching } from "./teachingScope.js";
import type { ITeachingReader } from "./TeachingReader.js";

export interface TeachingSummary {
  /** Class groups enrolling or running. */
  teaching: number;
  /** Every class group still in the portal — finished ones included. */
  inPortal: number;
  /** Confirmed students across the ones teaching. */
  students: number;
}

/**
 * The figures on the teacher's home (OOC-82). Built on the same list the
 * portal shows, so the home can never count a class group the teacher cannot
 * open. Pending grades and certificates join it when they exist (OOC-38,
 * OOC-33) — not as a zero before then.
 */
export class GetTeachingSummaryUseCase extends BaseUseCase<ListOwnClassGroupsInput, TeachingSummary> {
  constructor(
    private readonly listOwnClassGroups: ListOwnClassGroupsUseCase,
    private readonly reader: ITeachingReader,
  ) {
    super();
  }

  async run(input: ListOwnClassGroupsInput): Promise<TeachingSummary> {
    const groups = await this.listOwnClassGroups.run(input);
    const teaching = groups.filter(isTeaching);
    const students = teaching.length === 0 ? 0 : await this.reader.countStudents(teaching.map((group) => group.id));
    return { teaching: teaching.length, inPortal: groups.length, students };
  }
}
