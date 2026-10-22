export { BaseModel, BaseModelPropsSchema } from "./shared/base/BaseModel.js";
export type { BaseModelProps } from "./shared/base/BaseModel.js";
export {
  BASE_PROPS_KEYS,
  SoftDeletableModel,
  SoftDeletableModelPropsSchema,
} from "./shared/base/SoftDeletableModel.js";
export type { SoftDeletableModelProps } from "./shared/base/SoftDeletableModel.js";
export { BaseUseCase } from "./shared/base/BaseUseCase.js";
export type {
  IBaseRepository,
  ISoftDeletableRepository,
} from "./shared/base/IBaseRepository.js";

export { HttpError } from "./shared/base/errors/HttpError.js";
export type { HttpErrorParams } from "./shared/base/errors/HttpError.js";
export { UnauthorizedError } from "./shared/base/errors/UnauthorizedError.js";
export { ForbiddenError } from "./shared/base/errors/ForbiddenError.js";
export { NotFoundError } from "./shared/base/errors/NotFoundError.js";
export { ConflictError } from "./shared/base/errors/ConflictError.js";
export { UnableToProcessEntryError } from "./shared/base/errors/UnableToProcessEntryError.js";
export { InvalidFieldsError } from "./shared/base/errors/InvalidFieldsError.js";

export * from "./student/fields.js";
export { Student, StudentPropsSchema, StudentFieldsSchema, CreateStudentSchema } from "./student/Student.js";
export type { StudentProps, CreateStudentDTO } from "./student/Student.js";
export type { IStudentRepository } from "./student/StudentRepository.js";
export {
  Teacher,
  TeacherPropsSchema,
  TeacherFieldsSchema,
  CreateTeacherSchema,
  TeacherStatusSchema,
} from "./teacher/Teacher.js";
export type { TeacherProps, CreateTeacherDTO, TeacherDataDTO, TeacherStatus } from "./teacher/Teacher.js";
export { TeacherDataSchema, TeacherAvailabilitySchema } from "./teacher/Teacher.js";
export type { ITeacherRepository } from "./teacher/TeacherRepository.js";
export { TeacherAlreadyRegisteredError, TeacherNotFoundError } from "./teacher/errors.js";
export { RegisterTeacherUseCase, type RegisterTeacherInput } from "./teacher/RegisterTeacherUseCase.js";
export { UpdateTeacherUseCase, type UpdateTeacherInput } from "./teacher/UpdateTeacherUseCase.js";
export {
  UpdateTeacherAvailabilityUseCase,
  type UpdateTeacherAvailabilityInput,
} from "./teacher/UpdateTeacherAvailabilityUseCase.js";
export {
  SetTeacherRosterStatusUseCase,
  TEACHER_LEFT_ROSTER_BAN_REASON,
  type SetTeacherRosterStatusInput,
  type SetTeacherRosterStatusOutput,
} from "./teacher/SetTeacherRosterStatusUseCase.js";
export {
  Guardian,
  GuardianPropsSchema,
  GuardianFieldsSchema,
  CreateGuardianSchema,
  GuardianRelationshipSchema,
} from "./student/Guardian.js";
export type { GuardianProps, CreateGuardianDTO, GuardianRelationship } from "./student/Guardian.js";
export type { IGuardianRepository } from "./student/GuardianRepository.js";
export { GuardianRequiredForMinorError, StudentAlreadyRegisteredError, StudentNotFoundError } from "./student/errors.js";
export { UpdateStudentUseCase, type UpdateStudentInput } from "./student/UpdateStudentUseCase.js";
export { SaveGuardianUseCase, type SaveGuardianInput } from "./student/SaveGuardianUseCase.js";
export {
  RegisterStudentUseCase,
  type RegisterStudentInput,
  type RegisterStudentOutput,
} from "./student/RegisterStudentUseCase.js";

export { Enrollment, EnrollmentPropsSchema, SeatStatusSchema } from "./enrollment/Enrollment.js";
export type { EnrollmentProps, SeatStatus } from "./enrollment/Enrollment.js";
export { Payment, PaymentPropsSchema, PaymentMethodSchema, PaymentRailSchema, PaymentStatusSchema } from "./enrollment/Payment.js";
export type { PaymentProps, PaymentMethod, PaymentStatus } from "./enrollment/Payment.js";
export type { IEnrollmentRepository } from "./enrollment/EnrollmentRepository.js";
export type { IPlanPriceLookup } from "./enrollment/PlanPriceLookup.js";
export type {
  IEnrollmentEmailContextLookup,
  EnrollmentEmailContext,
} from "./enrollment/EnrollmentEmailContextLookup.js";

export {
  LocaleSchema,
  DEFAULT_LOCALE,
  EMAIL_TEMPLATE_KEYS,
} from "./notification/EmailNotification.js";
export type {
  Locale,
  EmailTemplateKey,
  EmailTemplateVars,
  EmailNotification,
} from "./notification/EmailNotification.js";
export {
  enrollmentRecipients,
  enrollmentReceivedEmails,
  paymentApprovedEmails,
  paymentRejectedEmails,
  type PaymentEmailFacts,
  type EnrollmentEmailFacts,
  type EnrollmentRecipient,
  type EnrollmentRecipientKind,
} from "./notification/enrollmentEmails.js";
export type {
  IPublicEnrollmentRepository,
  PublicEnrollmentContext,
  SubmitPublicEnrollmentParams,
  SubmitPublicEnrollmentResult,
} from "./enrollment/PublicEnrollmentRepository.js";
export {
  ClassGroupFullError,
  ClassGroupNotFoundError,
  OperationNumberAlreadyUsedError,
  PaymentAlreadySettledError,
  PaymentNotFoundError,
  PaymentSeatReleasedError,
  ReceiptNotRereadableError,
  ReceiptRereadInProgressError,
  PlanPriceNotFoundError,
  ReceiptNotReadyError,
  ReceiptNotUploadedError,
  ReceiptUploadNotFoundError,
  SeatHoldExpiredError,
  StudentBelowMinimumAgeError,
  EmailVerificationAttemptsExhaustedError,
  EmailVerificationCodeExpiredError,
  EmailVerificationCodeInvalidError,
  EmailVerificationCooldownError,
  EmailVerificationNotFoundError,
  EmailVerificationRequiredError,
  EmailVerificationTooManySendsError,
} from "./enrollment/errors.js";
export {
  EnrollmentOriginSchema,
  EnrollmentOriginInputSchema,
  type EnrollmentOrigin,
} from "./enrollment/EnrollmentOrigin.js";
export type { SeatHold } from "./enrollment/SeatHold.js";
export type { ISeatHoldRepository, ClaimSeatHoldResult } from "./enrollment/SeatHoldRepository.js";
export { ClaimSeatHoldUseCase, type ClaimSeatHoldInput } from "./enrollment/ClaimSeatHoldUseCase.js";
export { ReleaseSeatHoldUseCase } from "./enrollment/ReleaseSeatHoldUseCase.js";
export { ExpireSeatHoldsUseCase, EXPIRE_SEAT_HOLDS_BATCH } from "./enrollment/ExpireSeatHoldsUseCase.js";
export type { ReceiptUpload, ReceiptUploadStatus } from "./enrollment/ReceiptUpload.js";
export type { IReceiptUploadRepository } from "./enrollment/ReceiptUploadRepository.js";
export type { IReceiptStorage, PresignedReceiptUpload, StoredObjectHead } from "./enrollment/ReceiptStorage.js";
export {
  exifSignals,
  isReceiptFraudSignalKind,
  normalizeOperationNumber,
  payerNameMatches,
  RECEIPT_FRAUD_SIGNAL_KINDS,
  routesToHumanReview,
  type OperationNumberClaim,
  type ReceiptExifFacts,
  type ReceiptFraudSignal,
  type ReceiptFraudSignalKind,
} from "./enrollment/ReceiptScreening.js";
export type {
  IReceiptScreeningRepository,
  ReceiptLookalike,
  ReceiptScreeningSubject,
} from "./enrollment/ReceiptScreeningRepository.js";
export {
  ScreenReceiptUploadUseCase,
  MAX_LOOKALIKE_SIGNALS,
  type ScreenReceiptUploadInput,
  type ScreenReceiptUploadOutput,
} from "./enrollment/ScreenReceiptUploadUseCase.js";
export {
  RECEIPT_EXTRACTION_TIER_PRIMARY,
  RECEIPT_EXTRACTION_TIER_SECONDARY,
  ReceiptExtractionError,
  findExtractedField,
  type IReceiptExtractor,
  type ReceiptExtractedField,
  type ReceiptExtractedFieldName,
  type ReceiptExtraction,
  type ReceiptExtractionFailureReason,
  type ReceiptExtractionTier,
  type ReceiptImage,
} from "./enrollment/ReceiptExtraction.js";
export {
  RECEIPT_VERDICTS,
  RECEIPT_VERDICT_REASONS,
  classifyReceiptAmount,
  decideReceiptVerdict,
  isReceiptVerdict,
  isReceiptVerdictReason,
  type ReceiptValidationSettings,
  type ReceiptVerdict,
  type ReceiptVerdictOutcome,
  type ReceiptVerdictReason,
} from "./enrollment/ReceiptValidation.js";
export type {
  IReceiptValidationRepository,
  ReceiptValidationDetail,
  ReceiptValidationEffect,
  ReceiptValidationSubject,
} from "./enrollment/ReceiptValidationRepository.js";
export {
  ValidateReceiptUseCase,
  type ValidateReceiptInput,
  type ValidateReceiptOutput,
} from "./enrollment/ValidateReceiptUseCase.js";
export type {
  IReceiptExtractionRepository,
  IReceiptImageReader,
  ReceiptExtractionSubject,
} from "./enrollment/ReceiptExtractionRepository.js";
export {
  ExtractReceiptUseCase,
  type ExtractReceiptInput,
  type ExtractReceiptOutput,
  type RecordReceiptExtractionFailureInput,
} from "./enrollment/ExtractReceiptUseCase.js";
export {
  RequestReceiptUploadUseCase,
  RECEIPT_CONTENT_TYPES,
  type ReceiptContentType,
  type RequestReceiptUploadInput,
  type RequestReceiptUploadOutput,
} from "./enrollment/RequestReceiptUploadUseCase.js";
export {
  ConfirmReceiptUploadUseCase,
  type ConfirmReceiptUploadInput,
  type ConfirmReceiptUploadOutput,
} from "./enrollment/ConfirmReceiptUploadUseCase.js";
export {
  CreateManualEnrollmentUseCase,
  type CreateManualEnrollmentInput,
  type CreateManualEnrollmentOutput,
} from "./enrollment/CreateManualEnrollmentUseCase.js";
export {
  SubmitPublicEnrollmentUseCase,
  type SubmitPublicEnrollmentInput,
  type SubmitPublicEnrollmentOutput,
} from "./enrollment/SubmitPublicEnrollmentUseCase.js";

export type { Role } from "./identity/Role.js";
export { MASTER_EMAIL_DOMAINS, MFA_REQUIRED_ROLES, canHoldMaster, isOwnerEmail, requiresMfa } from "./identity/Role.js";
export type { AuthenticatedUser } from "./identity/AuthenticatedUser.js";
export {
  NotFreshlyAuthenticatedError,
  InsufficientPrivilegeError,
  CannotActOnSelfError,
  CurrentPasswordIncorrectError,
  NewPasswordRejectedError,
  MfaEnrollmentRequiredError,
  MfaRequiredForRoleError,
  MfaAlreadyEnabledError,
  MfaNotEnabledError,
  MfaCodeRejectedError,
} from "./identity/errors.js";
export { STAFF_PASSWORD_MIN_LENGTH, meetsStaffPasswordPolicy } from "./identity/StaffPasswordPolicy.js";
export {
  STUDENT_PASSWORD_MAX_LENGTH,
  STUDENT_PASSWORD_MIN_LENGTH,
  meetsStudentPasswordPolicy,
  studentPasswordIssues,
} from "./identity/StudentPasswordPolicy.js";
export type { StudentPasswordIssue } from "./identity/StudentPasswordPolicy.js";
export type { ICurrentSessionPort } from "./identity/ports/ICurrentSessionPort.js";
export type { IUserRoleRepository } from "./identity/ports/IUserRoleRepository.js";
export type { IAuditLogRepository, AuditLogEntry } from "./identity/ports/IAuditLogRepository.js";
export type { IFreshAuthVerifier } from "./identity/ports/IFreshAuthVerifier.js";
export type {
  IStaffInviteRepository,
  StaffInvite,
  CreateStaffInviteRecord,
} from "./identity/ports/IStaffInviteRepository.js";
export type {
  IStaffAccountProvisioner,
  ProvisionStaffAccountInput,
  ProvisionStaffAccountOutput,
} from "./identity/ports/IStaffAccountProvisioner.js";
export type { IStaffAccessRepository } from "./identity/ports/IStaffAccessRepository.js";
export type { IStaffUserLookup, StaffUserDisplay, ResettableStaffUser } from "./identity/ports/IStaffUserLookup.js";
export type {
  IStaffPasswordResetRepository,
  StaffPasswordReset,
  CreateStaffPasswordResetRecord,
  IssueSelfServiceResetRecord,
} from "./identity/ports/IStaffPasswordResetRepository.js";
export type { IStaffPasswordResetLinkBuilder } from "./identity/ports/IStaffPasswordResetLinkBuilder.js";
export type { IStaffPasswordSetter } from "./identity/ports/IStaffPasswordSetter.js";
export type { IStaffSessionRevoker } from "./identity/ports/IStaffSessionRevoker.js";
export type {
  IStaffSecondFactor,
  StaffMfaState,
  MfaCodeFailure,
  ConfirmMfaEnrollmentResult,
} from "./identity/ports/IStaffSecondFactor.js";
export {
  PromoteUserRoleUseCase,
  type PromoteUserRoleInput,
  type PromoteUserRoleOutput,
} from "./identity/PromoteUserRoleUseCase.js";
export {
  CreateStaffInviteUseCase,
  type CreateStaffInviteInput,
  type CreateStaffInviteOutput,
} from "./identity/CreateStaffInviteUseCase.js";
export {
  RenewStaffInviteUseCase,
  type RenewStaffInviteInput,
  type RenewStaffInviteOutput,
} from "./identity/RenewStaffInviteUseCase.js";
export {
  CancelStaffInviteUseCase,
  type CancelStaffInviteInput,
} from "./identity/CancelStaffInviteUseCase.js";
export {
  CompleteStaffInviteUseCase,
  type CompleteStaffInviteInput,
  type CompleteStaffInviteOutput,
} from "./identity/CompleteStaffInviteUseCase.js";
export {
  RemoveStaffAccessUseCase,
  type RemoveStaffAccessInput,
} from "./identity/RemoveStaffAccessUseCase.js";
export {
  RestoreStaffAccessUseCase,
  type RestoreStaffAccessInput,
} from "./identity/RestoreStaffAccessUseCase.js";
export {
  CreateStaffPasswordResetUseCase,
  type CreateStaffPasswordResetInput,
  type CreateStaffPasswordResetOutput,
} from "./identity/CreateStaffPasswordResetUseCase.js";
export {
  RenewStaffPasswordResetUseCase,
  type RenewStaffPasswordResetInput,
  type RenewStaffPasswordResetOutput,
} from "./identity/RenewStaffPasswordResetUseCase.js";
export {
  CancelStaffPasswordResetUseCase,
  type CancelStaffPasswordResetInput,
} from "./identity/CancelStaffPasswordResetUseCase.js";
export {
  CompleteStaffPasswordResetUseCase,
  type CompleteStaffPasswordResetInput,
  type CompleteStaffPasswordResetOutput,
} from "./identity/CompleteStaffPasswordResetUseCase.js";
export {
  RequestStaffPasswordResetUseCase,
  SELF_SERVICE_RESET_TTL_MINUTES,
  SELF_SERVICE_RESET_COOLDOWN_SECONDS,
  type RequestStaffPasswordResetInput,
} from "./identity/RequestStaffPasswordResetUseCase.js";
export {
  ChangeOwnPasswordUseCase,
  type ChangeOwnPasswordInput,
  type ChangeOwnPasswordOutput,
} from "./identity/ChangeOwnPasswordUseCase.js";
export { StartOwnMfaEnrollmentUseCase, type StartOwnMfaEnrollmentInput } from "./identity/StartOwnMfaEnrollmentUseCase.js";
export {
  ConfirmOwnMfaEnrollmentUseCase,
  type ConfirmOwnMfaEnrollmentInput,
  type ConfirmOwnMfaEnrollmentOutput,
} from "./identity/ConfirmOwnMfaEnrollmentUseCase.js";
export {
  RegenerateOwnRecoveryCodesUseCase,
  type RegenerateOwnRecoveryCodesInput,
  type RegenerateOwnRecoveryCodesOutput,
} from "./identity/RegenerateOwnRecoveryCodesUseCase.js";
export { DisableOwnMfaUseCase, type DisableOwnMfaInput } from "./identity/DisableOwnMfaUseCase.js";
export { STAFF_MFA_CODE_TTL_MINUTES, staffMfaCodeEmail } from "./identity/staffMfaEmail.js";

export type {
  FeatureFlagOverride,
  FeatureFlagOverrideView,
} from "./platform/FeatureFlagOverride.js";
export type { IFeatureFlagOverrideRepository } from "./platform/ports/IFeatureFlagOverrideRepository.js";
export { NotAPlatformOwnerError, InvalidPlatformSettingError } from "./platform/errors.js";
export {
  CHECKOUT_HOLD_MINUTES_MIN,
  CHECKOUT_HOLD_MINUTES_MAX,
  CheckoutHoldMinutesSchema,
  RECEIPT_AMOUNT_TOLERANCE_CENTS_MIN,
  RECEIPT_AMOUNT_TOLERANCE_CENTS_MAX,
  RECEIPT_REJECT_BELOW_PERCENT_MIN,
  RECEIPT_REJECT_BELOW_PERCENT_MAX,
  ReceiptAmountToleranceCentsSchema,
  ReceiptRejectBelowPercentSchema,
  type PlatformSettings,
} from "./platform/PlatformSettings.js";
export type { IPlatformSettingsRepository } from "./platform/ports/IPlatformSettingsRepository.js";
export {
  UpdateCheckoutHoldMinutesUseCase,
  type UpdateCheckoutHoldMinutesInput,
} from "./platform/UpdateCheckoutHoldMinutesUseCase.js";
export {
  UpdateReceiptAmountToleranceUseCase,
  type UpdateReceiptAmountToleranceInput,
} from "./platform/UpdateReceiptAmountToleranceUseCase.js";
export {
  UpdateReceiptRejectBelowPercentUseCase,
  type UpdateReceiptRejectBelowPercentInput,
} from "./platform/UpdateReceiptRejectBelowPercentUseCase.js";
export {
  SetFeatureFlagOverrideUseCase,
  type SetFeatureFlagOverrideInput,
  type SetFeatureFlagOverrideOutput,
} from "./platform/SetFeatureFlagOverrideUseCase.js";

export {
  CatalogEntryKindSchema,
  type CatalogEntryKind,
  type CatalogEntryState,
} from "./catalog/CatalogEntry.js";
export type { ICatalogEntryRepository } from "./catalog/ports/ICatalogEntryRepository.js";
export {
  CatalogEntryNotFoundError,
  CourseNotFoundError,
  PlanNotFoundError,
  PriceInPastError,
  PeriodNotFoundError,
  CatalogClassGroupNotFoundError,
  InvalidDateRangeError,
  InvalidStatusTransitionError,
  ClassGroupIncompleteError,
  CapacityBelowSeatsTakenError,
  ClassGroupCourseLockedError,
  ClassGroupTeacherUnavailableError,
  ClassGroupTeacherLanguageError,
  PeriodAlreadyDuplicatedError,
  DuplicateSamePeriodError,
  ClassGroupNotFullError,
  WaitlistAlreadyJoinedError,
  WaitlistAlreadyEnrolledError,
  WaitlistStudentNotFoundError,
  WaitlistEntryClosedError,
  WaitlistEntryNotFoundError,
  LandingKeyTakenError,
} from "./catalog/errors.js";
export {
  AcademicPeriod,
  AcademicPeriodPropsSchema,
  CreateAcademicPeriodSchema,
  UpdateAcademicPeriodSchema,
  type AcademicPeriodProps,
  type CreateAcademicPeriodDTO,
  type UpdateAcademicPeriodDTO,
} from "./catalog/AcademicPeriod.js";
export {
  ClassGroup,
  ClassGroupPropsSchema,
  ClassGroupStatusSchema,
  CreateClassGroupSchema,
  UpdateClassGroupSchema,
  NEXT_CLASS_GROUP_STATUS,
  WeekdaySchema,
  WeeklySlotSchema,
  type ClassGroupProps,
  type ClassGroupStatus,
  type CreateClassGroupDTO,
  type UpdateClassGroupDTO,
  type WeeklySlot,
} from "./catalog/ClassGroup.js";
export type { IAcademicPeriodRepository } from "./catalog/ports/IAcademicPeriodRepository.js";
export type { IClassGroupRepository } from "./catalog/ports/IClassGroupRepository.js";
export { CreateAcademicPeriodUseCase, type CreateAcademicPeriodInput } from "./catalog/CreateAcademicPeriodUseCase.js";
export { UpdateAcademicPeriodUseCase, type UpdateAcademicPeriodInput } from "./catalog/UpdateAcademicPeriodUseCase.js";
export { CreateClassGroupUseCase, type CreateClassGroupInput } from "./catalog/CreateClassGroupUseCase.js";
export { UpdateClassGroupUseCase, type UpdateClassGroupInput } from "./catalog/UpdateClassGroupUseCase.js";
export { DuplicateClassGroupsUseCase, type DuplicateClassGroupsInput } from "./catalog/DuplicateClassGroupsUseCase.js";
export {
  AdvanceClassGroupStatusUseCase,
  type AdvanceClassGroupStatusInput,
} from "./catalog/AdvanceClassGroupStatusUseCase.js";
export {
  WaitlistEntry,
  WaitlistEntryPropsSchema,
  WaitlistLeaveReasonSchema,
  StaffWaitlistLeaveReasonSchema,
  type WaitlistEntryProps,
  type WaitlistLeaveReason,
  type StaffWaitlistLeaveReason,
} from "./catalog/WaitlistEntry.js";
export type { IWaitlistRepository, WaitlistStudentStanding } from "./catalog/ports/IWaitlistRepository.js";
export { JoinWaitlistUseCase, type JoinWaitlistInput } from "./catalog/JoinWaitlistUseCase.js";
export { LeaveWaitlistUseCase, type LeaveWaitlistInput } from "./catalog/LeaveWaitlistUseCase.js";
export { Plan, PlanPrice, PRICE_PAST_TOLERANCE_MS, type PlanProps, type PlanPriceProps } from "./catalog/Plan.js";
export type { IPlanRepository } from "./catalog/ports/IPlanRepository.js";
export { CreatePlanUseCase, type CreatePlanInput } from "./catalog/CreatePlanUseCase.js";
export { RenamePlanUseCase, type RenamePlanInput } from "./catalog/RenamePlanUseCase.js";
export { SchedulePlanPriceUseCase, type SchedulePlanPriceInput } from "./catalog/SchedulePlanPriceUseCase.js";
export {
  Course,
  CertificateRuleSchema,
  CourseOptionsSchema,
  CreateCourseSchema,
  LandingCourseKeySchema,
  UpdateCourseSchema,
  type CertificateRule,
  type CourseProps,
  type CreateCourseDTO,
  type UpdateCourseDTO,
} from "./catalog/Course.js";
export {
  LANDING_COURSE_KEYS,
  isLandingCourseKey,
  type LandingCourseKey,
} from "./catalog/landingCourseKeys.js";
export type { ICourseRepository } from "./catalog/ports/ICourseRepository.js";
export { CreateCourseUseCase, type CreateCourseInput } from "./catalog/CreateCourseUseCase.js";
export { UpdateCourseUseCase, type UpdateCourseInput } from "./catalog/UpdateCourseUseCase.js";
export {
  RetireCatalogEntryUseCase,
  type RetireCatalogEntryInput,
  type RetireCatalogEntryOutput,
} from "./catalog/RetireCatalogEntryUseCase.js";
export {
  RestoreCatalogEntryUseCase,
  type RestoreCatalogEntryInput,
  type RestoreCatalogEntryOutput,
} from "./catalog/RestoreCatalogEntryUseCase.js";
export {
  PaymentRejectionReasonSchema,
  type PaymentRejectionReason,
  type PaymentDecision,
  type PaymentToSettle,
  type IPaymentSettlementRepository,
} from "./enrollment/PaymentSettlement.js";
export { SettlePaymentUseCase, type SettlePaymentInput, type SettlePaymentOutput } from "./enrollment/SettlePaymentUseCase.js";
export type {
  IReceiptRereadRepository,
  ReceiptRereadResult,
  ReceiptRereadSubject,
} from "./enrollment/ReceiptRereadRepository.js";
export {
  RequestReceiptRereadUseCase,
  type RequestReceiptRereadInput,
  type RequestReceiptRereadOutput,
} from "./enrollment/RequestReceiptRereadUseCase.js";
export {
  RereadReceiptUseCase,
  type RereadReceiptInput,
  type RereadReceiptOutput,
  type RecordReceiptRereadFailureInput,
} from "./enrollment/RereadReceiptUseCase.js";

export {
  PORTAL_ACTIVATION_TTL_DAYS,
  PORTAL_RESET_TTL_MINUTES,
  PORTAL_SIGN_IN_SENTINEL_EMAIL,
  PORTAL_TOKEN_COOLDOWN_SECONDS,
  hashPortalToken,
  newPortalToken,
  parsePortalIdentifier,
} from "./identity/portal/PortalAccess.js";
export type {
  NewPortalToken,
  PortalAccessOutcome,
  PortalAccessState,
  PortalAccessToken,
  PortalAccessTokenPurpose,
  PortalAccount,
  PortalIdentifier,
  PortalIdentity,
} from "./identity/portal/PortalAccess.js";
export type {
  IPortalAccessRepository,
  IPortalLinkBuilder,
  IPortalPasswordSetter,
  IssuePortalTokenRequest,
  PortalAccountProvisioning,
} from "./identity/portal/ports.js";
export { portalCredentialsEmail, portalPasswordResetEmail } from "./identity/portal/portalEmails.js";
export { ResolvePortalSignInEmailUseCase } from "./identity/portal/ResolvePortalSignInEmailUseCase.js";
export { RequestPortalPasswordResetUseCase } from "./identity/portal/RequestPortalPasswordResetUseCase.js";
export { CompletePortalAccessUseCase } from "./identity/portal/CompletePortalAccessUseCase.js";
export { IssuePortalAccessUseCase } from "./identity/portal/IssuePortalAccessUseCase.js";
export type { IssuePortalAccessOutcome } from "./identity/portal/IssuePortalAccessUseCase.js";
export {
  EMAIL_VERIFICATION_CODE_TTL_MINUTES,
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EMAIL_VERIFICATION_MAX_SENDS_PER_HOLD,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  emailVerificationCodeEmail,
  hashVerificationCode,
  newVerificationCode,
  verificationCodeMatches,
} from "./enrollment/EmailVerification.js";
export type {
  IEmailVerificationRepository,
  IssueEmailVerificationOutcome,
  IssueEmailVerificationRequest,
  LatestEmailVerification,
} from "./enrollment/EmailVerificationRepository.js";
export {
  SendEmailVerificationCodeUseCase,
  type SendEmailVerificationCodeInput,
} from "./enrollment/SendEmailVerificationCodeUseCase.js";
export {
  ConfirmEmailVerificationUseCase,
  type ConfirmEmailVerificationInput,
} from "./enrollment/ConfirmEmailVerificationUseCase.js";
