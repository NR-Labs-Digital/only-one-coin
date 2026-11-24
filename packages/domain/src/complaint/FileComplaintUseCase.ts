import { LEGAL_IDENTITY } from "../legal/legalIdentity.js";
import type { Locale } from "../notification/EmailNotification.js";
import { complaintFiledEmails } from "../notification/complaintEmails.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { ComplaintForm } from "../student/fields.js";
import { COMPLAINT_PRIVACY_NOTICE_VERSION, type FiledComplaint } from "./Complaint.js";
import type { IComplaintRepository } from "./ComplaintRepository.js";

export interface FileComplaintInput {
  /** Already through `ComplaintFormSchema` (the route's body). */
  form: ComplaintForm;
  locale: Locale;
  ip: string;
  idempotencyKey: string;
}

/**
 * A sheet of the complaints book (Libro de Reclamaciones, OOC-63). Anybody
 * files — being a student is not a condition — and the sheet is never edited
 * afterwards. The supplier is frozen from `LEGAL_IDENTITY` on the sheet, since
 * the company answering for the site has already changed twice. The consumer
 * gets the copy by e-mail, in the language of the form, in the same
 * transaction as the sheet.
 */
export class FileComplaintUseCase extends BaseUseCase<FileComplaintInput, FiledComplaint> {
  constructor(private readonly complaints: IComplaintRepository) {
    super();
  }

  /**
   * A resend of a sheet that was already filed (the phone lost the answer):
   * the same number, with no captcha spent — the first submit already passed
   * one, and its token is gone.
   */
  findFiled(idempotencyKey: string): Promise<FiledComplaint | null> {
    return this.complaints.findByIdempotencyKey(idempotencyKey);
  }

  async run(input: FileComplaintInput): Promise<FiledComplaint> {
    const supplier = {
      legalName: LEGAL_IDENTITY.legalName,
      ruc: LEGAL_IDENTITY.ruc,
      address: LEGAL_IDENTITY.address,
    };
    return this.complaints.file(
      {
        form: input.form,
        supplier,
        locale: input.locale,
        privacyNoticeVersion: COMPLAINT_PRIVACY_NOTICE_VERSION,
        ip: input.ip,
        idempotencyKey: input.idempotencyKey,
      },
      (filed) => complaintFiledEmails({ ...filed, form: input.form, supplier }, input.locale),
    );
  }
}
