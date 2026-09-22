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
export { UnableToProcessEntryError } from "./shared/base/errors/UnableToProcessEntryError.js";

export {
  Student,
  StudentPropsSchema,
  CreateStudentSchema,
  NationalIdTypeSchema,
} from "./student/Student.js";
export type { StudentProps, CreateStudentDTO, NationalIdType } from "./student/Student.js";
export type { IStudentRepository } from "./student/StudentRepository.js";
export {
  Guardian,
  GuardianPropsSchema,
  CreateGuardianSchema,
  GuardianRelationshipSchema,
} from "./student/Guardian.js";
export type { GuardianProps, CreateGuardianDTO, GuardianRelationship } from "./student/Guardian.js";
export type { IGuardianRepository } from "./student/GuardianRepository.js";
export { GuardianRequiredForMinorError, StudentAlreadyRegisteredError } from "./student/errors.js";
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
  IPublicEnrollmentRepository,
  PublicEnrollmentContext,
  SubmitPublicEnrollmentParams,
  SubmitPublicEnrollmentResult,
} from "./enrollment/PublicEnrollmentRepository.js";
export {
  ClassGroupFullError,
  ClassGroupNotFoundError,
  PlanPriceNotFoundError,
  StudentBelowMinimumAgeError,
} from "./enrollment/errors.js";
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
export { MASTER_EMAIL_DOMAINS, canHoldMaster, isOwnerEmail } from "./identity/Role.js";
export type { AuthenticatedUser } from "./identity/AuthenticatedUser.js";
export {
  NotFreshlyAuthenticatedError,
  InsufficientPrivilegeError,
  CannotActOnSelfError,
} from "./identity/errors.js";
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
export type { IStaffUserLookup, StaffUserDisplay } from "./identity/ports/IStaffUserLookup.js";
export type {
  IStaffPasswordResetRepository,
  StaffPasswordReset,
  CreateStaffPasswordResetRecord,
} from "./identity/ports/IStaffPasswordResetRepository.js";
export type { IStaffPasswordSetter } from "./identity/ports/IStaffPasswordSetter.js";
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

export type {
  FeatureFlagOverride,
  FeatureFlagOverrideView,
} from "./platform/FeatureFlagOverride.js";
export type { IFeatureFlagOverrideRepository } from "./platform/ports/IFeatureFlagOverrideRepository.js";
export { NotAPlatformOwnerError } from "./platform/errors.js";
export {
  SetFeatureFlagOverrideUseCase,
  type SetFeatureFlagOverrideInput,
  type SetFeatureFlagOverrideOutput,
} from "./platform/SetFeatureFlagOverrideUseCase.js";
