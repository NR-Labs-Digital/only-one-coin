import { v7 as uuid } from "uuid";
import { z } from "zod";
import { SoftDeletableModel, SoftDeletableModelPropsSchema } from "../shared/base/SoftDeletableModel.js";
import { languageKey } from "./courseLanguage.js";

export const LanguagePropsSchema = SoftDeletableModelPropsSchema.extend({
  name: z.string().trim().min(1).max(60),
  key: z.string().min(1),
});

export type LanguageProps = z.infer<typeof LanguagePropsSchema>;

/**
 * A language the catalog is organized by (OOC-128) — "Inglés", "Francés".
 * Its own record so a course picks one instead of typing it: free text let
 * "INGLES" and "Inglés" open two Englishes. `key` is the name compared without
 * case, accents or stray spaces, and there is one live language per key.
 */
export class Language extends SoftDeletableModel {
  public name: string;
  public key: string;

  constructor(props: LanguageProps) {
    super(props);
    this.name = props.name;
    this.key = props.key;
  }

  static create(name: string): Language {
    const valid = LanguagePropsSchema.shape.name.parse(name).replace(/\s+/g, " ");
    return new Language(LanguagePropsSchema.parse({ id: uuid(), name: valid, key: languageKey(valid) }));
  }

  /** Answers whether the name actually changed — a new capital letter counts. */
  rename(name: string): boolean {
    const next = LanguagePropsSchema.shape.name.parse(name).replace(/\s+/g, " ");
    if (next === this.name) return false;
    this.name = next;
    this.key = languageKey(next);
    this.touch();
    return true;
  }
}
