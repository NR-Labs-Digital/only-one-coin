// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { z } from "zod";
import {
  BASE_PROPS_KEYS,
  SoftDeletableModel,
  SoftDeletableModelPropsSchema,
} from "../shared/base/SoftDeletableModel.js";
import { NationalIdTypeSchema } from "./Student.js";

export const GuardianRelationshipSchema = z.enum(["mother", "father", "legal_guardian"]);
export type GuardianRelationship = z.infer<typeof GuardianRelationshipSchema>;

export const GuardianPropsSchema = SoftDeletableModelPropsSchema.extend({
  studentId: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  relationship: GuardianRelationshipSchema,
  nationalIdType: NationalIdTypeSchema,
  nationalId: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});

export const CreateGuardianSchema = GuardianPropsSchema.omit(BASE_PROPS_KEYS);

export type GuardianProps = z.infer<typeof GuardianPropsSchema>;
export type CreateGuardianDTO = z.infer<typeof CreateGuardianSchema>;

/**
 * Consent (Ley 29733) is deliberately not a field here — it is a separate,
 * append-only record accepted by the guardian themself, with their own
 * timestamp/version/IP (CLAUDE.md §1, §8). A Guardian is created with
 * consent pending; nothing on this entity ever claims it was accepted.
 */
export class Guardian extends SoftDeletableModel {
  public studentId: string;
  public firstName: string;
  public lastName: string;
  public relationship: GuardianRelationship;
  public nationalIdType: z.infer<typeof NationalIdTypeSchema>;
  public nationalId: string;
  public email: string;
  public phone: string;

  constructor(props: GuardianProps) {
    super(props);
    this.studentId = props.studentId;
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.relationship = props.relationship;
    this.nationalIdType = props.nationalIdType;
    this.nationalId = props.nationalId;
    this.email = props.email;
    this.phone = props.phone;
  }

  static create(dto: CreateGuardianDTO): Guardian {
    const result = CreateGuardianSchema.safeParse(dto);

    if (!result.success) {
      throw new Error("Invalid data");
    }

    return new Guardian({
      id: uuid(),
      ...result.data,
    });
  }
}
