import type { FastifyBaseLogger } from "fastify";
import {
  CancelStaffInviteUseCase,
  ClaimSeatHoldUseCase,
  SendEmailVerificationCodeUseCase,
  CancelStaffPasswordResetUseCase,
  ChangeOwnPasswordUseCase,
  CompletePortalAccessUseCase,
  CompleteStaffInviteUseCase,
  CompleteStaffPasswordResetUseCase,
  ConfirmEmailVerificationUseCase,
  ConfirmReceiptUploadUseCase,
  CreateCourseUseCase,
  CreateAcademicPeriodUseCase,
  UpdateAcademicPeriodUseCase,
  DuplicateClassGroupsUseCase,
  CreateClassGroupUseCase,
  UpdateClassGroupUseCase,
  AdvanceClassGroupStatusUseCase,
  IssuePortalAccessUseCase,
  JoinWaitlistUseCase,
  LeaveWaitlistUseCase,
  CreateManualEnrollmentUseCase,
  CreatePlanUseCase,
  CreateStaffInviteUseCase,
  CreateStaffPasswordResetUseCase,
  ExpireSeatHoldsUseCase,
  PromoteUserRoleUseCase,
  RegisterStudentUseCase,
  RegisterTeacherUseCase,
  SetTeacherRosterStatusUseCase,
  UpdateTeacherAvailabilityUseCase,
  UpdateTeacherUseCase,
  UpdateStudentUseCase,
  SaveGuardianUseCase,
  RenamePlanUseCase,
  ReleaseSeatHoldUseCase,
  RequestPortalPasswordResetUseCase,
  RequestReceiptUploadUseCase,
  ResolvePortalSignInEmailUseCase,
  ScreenReceiptUploadUseCase,
  RetireCatalogEntryUseCase,
  SettlePaymentUseCase,
  RemoveStaffAccessUseCase,
  RenewStaffInviteUseCase,
  RenewStaffPasswordResetUseCase,
  RequestStaffPasswordResetUseCase,
  RestoreCatalogEntryUseCase,
  RestoreStaffAccessUseCase,
  SchedulePlanPriceUseCase,
  SetFeatureFlagOverrideUseCase,
  SubmitPublicEnrollmentUseCase,
  UpdateCheckoutHoldMinutesUseCase,
  UpdateReceiptAmountToleranceUseCase,
  ValidateReceiptUseCase,
  UpdateReceiptRejectBelowPercentUseCase,
  UpdateCourseUseCase,
  type IAuditLogRepository,
  type ICatalogEntryRepository,
  type ICourseRepository,
  type IAcademicPeriodRepository,
  type IClassGroupRepository,
  type IWaitlistRepository,
  type ICurrentSessionPort,
  type IEnrollmentRepository,
  type IFeatureFlagOverrideRepository,
  type IFreshAuthVerifier,
  type IGuardianRepository,
  type IPlanPriceLookup,
  type IPlanRepository,
  type IPlatformSettingsRepository,
  type IPortalAccessRepository,
  type IPublicEnrollmentRepository,
  type IReceiptExtractionRepository,
  type IReceiptUploadRepository,
  type IEmailVerificationRepository,
  type ISeatHoldRepository,
  type IStaffAccessRepository,
  type IStaffAccountProvisioner,
  type IStaffInviteRepository,
  type IStaffPasswordResetRepository,
  type IStaffPasswordSetter,
  type IStaffUserLookup,
  type IStudentRepository,
  type ITeacherRepository,
  type IUserRoleRepository,
} from "@ooc/domain";
import { loadConfig, type Config } from "./config.js";
import { createLogger } from "./infra/logger.js";
import type { Redis } from "ioredis";
import { createEdgeRedis } from "./infra/edge/createEdgeRedis.js";
import { RedisRateLimiter, type RateLimiter } from "./infra/edge/RedisRateLimiter.js";
import { RedisIdempotencyCache, type IdempotencyCache } from "./infra/edge/RedisIdempotencyCache.js";
import { TurnstileCaptchaVerifier, type CaptchaVerifier } from "./infra/edge/TurnstileCaptchaVerifier.js";
import { createAuth, type Auth } from "./infra/auth/betterAuth.js";
import { BetterAuthCurrentSessionPort } from "./infra/identity/BetterAuthCurrentSessionPort.js";
import { BetterAuthFreshAuthVerifier } from "./infra/identity/BetterAuthFreshAuthVerifier.js";
import { PortalLinkBuilder } from "./infra/identity/PortalLinkBuilder.js";
import { BackofficePasswordResetLinkBuilder } from "./infra/identity/BackofficePasswordResetLinkBuilder.js";
import { BetterAuthStaffAccountProvisioner } from "./infra/identity/BetterAuthStaffAccountProvisioner.js";
import { BetterAuthPortalPasswordSetter } from "./infra/identity/BetterAuthPortalPasswordSetter.js";
import { BetterAuthStaffPasswordSetter } from "./infra/identity/BetterAuthStaffPasswordSetter.js";
import { BetterAuthStaffSessionRevoker } from "./infra/identity/BetterAuthStaffSessionRevoker.js";
import { DrizzleAuditLogRepository } from "./infra/identity/DrizzleAuditLogRepository.js";
import { DrizzleStaffAccessRepository } from "./infra/identity/DrizzleStaffAccessRepository.js";
import { DrizzleStaffInviteRepository } from "./infra/identity/DrizzleStaffInviteRepository.js";
import { DrizzleStaffPasswordResetRepository } from "./infra/identity/DrizzleStaffPasswordResetRepository.js";
import { DrizzleStaffUserLookup } from "./infra/identity/DrizzleStaffUserLookup.js";
import { DrizzleUserRoleRepository } from "./infra/identity/DrizzleUserRoleRepository.js";
import { createDb, type Db } from "./infra/db/client.js";
import { DrizzlePortalAccessRepository } from "./infra/persistence/portal/DrizzlePortalAccessRepository.js";
import { DrizzleStudentRepository } from "./infra/persistence/student/DrizzleStudentRepository.js";
import { DrizzleGuardianRepository } from "./infra/persistence/student/DrizzleGuardianRepository.js";
import { DrizzleEnrollmentRepository } from "./infra/persistence/enrollment/DrizzleEnrollmentRepository.js";
import { DrizzlePublicEnrollmentRepository } from "./infra/persistence/enrollment/DrizzlePublicEnrollmentRepository.js";
import { DrizzlePlanPriceLookup } from "./infra/persistence/enrollment/DrizzlePlanPriceLookup.js";
import { DrizzleEmailVerificationRepository } from "./infra/persistence/enrollment/DrizzleEmailVerificationRepository.js";
import { DrizzleSeatHoldRepository } from "./infra/persistence/enrollment/DrizzleSeatHoldRepository.js";
import {
  DrizzleReceiptUploadRepository,
  type IReceiptNormalizationStore,
} from "./infra/persistence/enrollment/DrizzleReceiptUploadRepository.js";
import { DrizzleReceiptValidationRepository } from "./infra/persistence/enrollment/DrizzleReceiptValidationRepository.js";
import { DrizzleReceiptScreeningRepository } from "./infra/persistence/enrollment/DrizzleReceiptScreeningRepository.js";
import { DrizzleReceiptExtractionRepository } from "./infra/persistence/enrollment/DrizzleReceiptExtractionRepository.js";
import { createS3Client } from "./infra/storage/s3Client.js";
import { TigrisReceiptStorage } from "./infra/storage/TigrisReceiptStorage.js";
import { ReceiptObjectStore } from "./infra/storage/ReceiptObjectStore.js";
import { ListStudentsQuery } from "./infra/persistence/student/ListStudentsQuery.js";
import { GetStudentQuery } from "./infra/persistence/student/GetStudentQuery.js";
import { StudentEnrollmentHistoryQuery } from "./infra/persistence/student/StudentEnrollmentHistoryQuery.js";
import { StudentActivityQuery } from "./infra/persistence/student/StudentActivityQuery.js";
import { DrizzleTeacherRepository } from "./infra/persistence/teacher/DrizzleTeacherRepository.js";
import { ListTeachersQuery } from "./infra/persistence/teacher/ListTeachersQuery.js";
import { GetTeacherQuery } from "./infra/persistence/teacher/GetTeacherQuery.js";
import { ListTeacherOptionsQuery } from "./infra/persistence/teacher/ListTeacherOptionsQuery.js";
import { DrizzlePaymentSettlementRepository } from "./infra/persistence/payment/DrizzlePaymentSettlementRepository.js";
import { ListPaymentsQuery } from "./infra/persistence/payment/ListPaymentsQuery.js";
import { ListPaymentReviewQueueQuery } from "./infra/persistence/payment/ListPaymentReviewQueueQuery.js";
import { DashboardSummaryQuery } from "./infra/persistence/dashboard/DashboardSummaryQuery.js";
import { PaymentReceiptImageQuery } from "./infra/persistence/payment/PaymentReceiptImageQuery.js";
import { StudentPortalQuery } from "./infra/persistence/portal/StudentPortalQuery.js";
import { ListEnrollmentsQuery } from "./infra/persistence/enrollment/ListEnrollmentsQuery.js";
import { ListOpenClassGroupsQuery } from "./infra/persistence/catalog/ListOpenClassGroupsQuery.js";
import { GetPublicCatalogQuery } from "./infra/persistence/catalog/GetPublicCatalogQuery.js";
import { DrizzleCatalogEntryRepository } from "./infra/persistence/catalog/DrizzleCatalogEntryRepository.js";
import { DrizzleCourseRepository } from "./infra/persistence/catalog/DrizzleCourseRepository.js";
import { DrizzlePlanRepository } from "./infra/persistence/catalog/DrizzlePlanRepository.js";
import { ListCoursesQuery } from "./infra/persistence/catalog/ListCoursesQuery.js";
import { GetCourseQuery } from "./infra/persistence/catalog/GetCourseQuery.js";
import { DrizzleAcademicPeriodRepository } from "./infra/persistence/catalog/DrizzleAcademicPeriodRepository.js";
import { DrizzleClassGroupRepository } from "./infra/persistence/catalog/DrizzleClassGroupRepository.js";
import { DrizzleWaitlistRepository } from "./infra/persistence/catalog/DrizzleWaitlistRepository.js";
import { ListPeriodsQuery } from "./infra/persistence/catalog/ListPeriodsQuery.js";
import { ListClassGroupsQuery } from "./infra/persistence/catalog/ListClassGroupsQuery.js";
import { ListWaitlistQuery } from "./infra/persistence/catalog/ListWaitlistQuery.js";
import { ListStaffQuery } from "./infra/persistence/identity/ListStaffQuery.js";
import { ListStaffRoleChangesQuery } from "./infra/persistence/identity/ListStaffRoleChangesQuery.js";
import { GetPasswordChangedAtQuery } from "./infra/persistence/identity/GetPasswordChangedAtQuery.js";
import { DrizzleFeatureFlagOverrideRepository } from "./infra/persistence/platform/DrizzleFeatureFlagOverrideRepository.js";
import { DrizzlePlatformSettingsRepository } from "./infra/persistence/platform/DrizzlePlatformSettingsRepository.js";
import { DrizzleEnrollmentEmailContextLookup } from "./infra/persistence/enrollment/DrizzleEnrollmentEmailContextLookup.js";
import { DrizzleOutboxRepository, type IOutboxStore } from "./infra/persistence/notification/DrizzleOutboxRepository.js";
import { createNotificationProvider } from "./infra/notification/createNotificationProvider.js";
import type { NotificationProvider } from "@ooc/notifications";

export interface AppRepositories {
  catalogEntry: ICatalogEntryRepository;
  course: ICourseRepository;
  academicPeriod: IAcademicPeriodRepository;
  classGroup: IClassGroupRepository;
  waitlist: IWaitlistRepository;
  plan: IPlanRepository;
  student: IStudentRepository;
  guardian: IGuardianRepository;
  teacher: ITeacherRepository;
  enrollment: IEnrollmentRepository;
  publicEnrollment: IPublicEnrollmentRepository;
  seatHold: ISeatHoldRepository;
  emailVerification: IEmailVerificationRepository;
  /** Widened past the domain port: the normalize worker's own read/write
   * shape (`IReceiptNormalizationStore`) lives here too, the same way
   * `AppNotifications.outbox` is `IOutboxStore` rather than a domain port —
   * this is infra a worker consumes directly, not a usecase's dependency. */
  receiptUpload: IReceiptUploadRepository & IReceiptNormalizationStore;
  /** Only the `receipt-extract` worker uses it (OOC-20). The extractor itself
   * is not in this container on purpose: routes load the container, and the
   * submit route must never import the AI module (apps/api/CLAUDE.md) —
   * index.ts builds it next to the workers. */
  receiptExtraction: IReceiptExtractionRepository;
  planPriceLookup: IPlanPriceLookup;
  portalAccess: IPortalAccessRepository;
  staffInvite: IStaffInviteRepository;
  staffPasswordReset: IStaffPasswordResetRepository;
  featureFlagOverride: IFeatureFlagOverrideRepository;
  platformSettings: IPlatformSettingsRepository;
}

export interface AppUseCases {
  teacher: {
    register: RegisterTeacherUseCase;
    update: UpdateTeacherUseCase;
    updateAvailability: UpdateTeacherAvailabilityUseCase;
    setRosterStatus: SetTeacherRosterStatusUseCase;
  };
  student: {
    register: RegisterStudentUseCase;
    update: UpdateStudentUseCase;
    saveGuardian: SaveGuardianUseCase;
  };
  enrollment: {
    createManual: CreateManualEnrollmentUseCase;
    submitPublic: SubmitPublicEnrollmentUseCase;
    claimSeatHold: ClaimSeatHoldUseCase;
    releaseSeatHold: ReleaseSeatHoldUseCase;
    expireSeatHolds: ExpireSeatHoldsUseCase;
    requestReceiptUpload: RequestReceiptUploadUseCase;
    confirmReceiptUpload: ConfirmReceiptUploadUseCase;
    sendEmailVerification: SendEmailVerificationCodeUseCase;
    confirmEmailVerification: ConfirmEmailVerificationUseCase;
    /** Run by the `receipt-screen` worker, never a route (OOC-22). */
    screenReceiptUpload: ScreenReceiptUploadUseCase;
    /** Run by the `receipt-validate` worker, never a route (OOC-21). Pure
     * comparison — no AI module, so it may live in the container. */
    validateReceipt: ValidateReceiptUseCase;
  };
  payment: {
    settlePayment: SettlePaymentUseCase;
  };
  staff: {
    promoteRole: PromoteUserRoleUseCase;
    createInvite: CreateStaffInviteUseCase;
    renewInvite: RenewStaffInviteUseCase;
    cancelInvite: CancelStaffInviteUseCase;
    completeInvite: CompleteStaffInviteUseCase;
    removeAccess: RemoveStaffAccessUseCase;
    restoreAccess: RestoreStaffAccessUseCase;
    createPasswordReset: CreateStaffPasswordResetUseCase;
    renewPasswordReset: RenewStaffPasswordResetUseCase;
    cancelPasswordReset: CancelStaffPasswordResetUseCase;
    completePasswordReset: CompleteStaffPasswordResetUseCase;
    requestPasswordReset: RequestStaffPasswordResetUseCase;
    changeOwnPassword: ChangeOwnPasswordUseCase;
  };
  portal: {
    resolveSignInEmail: ResolvePortalSignInEmailUseCase;
    requestPasswordReset: RequestPortalPasswordResetUseCase;
    completeAccess: CompletePortalAccessUseCase;
    issueAccess: IssuePortalAccessUseCase;
  };
  platform: {
    setFeatureFlag: SetFeatureFlagOverrideUseCase;
    updateCheckoutHoldMinutes: UpdateCheckoutHoldMinutesUseCase;
    updateReceiptAmountTolerance: UpdateReceiptAmountToleranceUseCase;
    updateReceiptRejectBelowPercent: UpdateReceiptRejectBelowPercentUseCase;
  };
  catalog: {
    retire: RetireCatalogEntryUseCase;
    restore: RestoreCatalogEntryUseCase;
    createCourse: CreateCourseUseCase;
    updateCourse: UpdateCourseUseCase;
    createPlan: CreatePlanUseCase;
    renamePlan: RenamePlanUseCase;
    schedulePlanPrice: SchedulePlanPriceUseCase;
    createPeriod: CreateAcademicPeriodUseCase;
    updatePeriod: UpdateAcademicPeriodUseCase;
    duplicatePeriod: DuplicateClassGroupsUseCase;
    createClassGroup: CreateClassGroupUseCase;
    updateClassGroup: UpdateClassGroupUseCase;
    advanceClassGroupStatus: AdvanceClassGroupStatusUseCase;
    joinWaitlist: JoinWaitlistUseCase;
    leaveWaitlist: LeaveWaitlistUseCase;
  };
}

export interface AppQueries {
  listStudents: ListStudentsQuery;
  listEnrollments: ListEnrollmentsQuery;
  listPayments: ListPaymentsQuery;
  listPaymentReviewQueue: ListPaymentReviewQueueQuery;
  dashboardSummary: DashboardSummaryQuery;
  paymentReceiptImage: PaymentReceiptImageQuery;
  getStudent: GetStudentQuery;
  studentPortal: StudentPortalQuery;
  studentEnrollmentHistory: StudentEnrollmentHistoryQuery;
  studentActivity: StudentActivityQuery;
  listTeachers: ListTeachersQuery;
  getTeacher: GetTeacherQuery;
  listTeacherOptions: ListTeacherOptionsQuery;
  listOpenClassGroups: ListOpenClassGroupsQuery;
  getPublicCatalog: GetPublicCatalogQuery;
  listCourses: ListCoursesQuery;
  getCourse: GetCourseQuery;
  listPeriods: ListPeriodsQuery;
  listClassGroups: ListClassGroupsQuery;
  listWaitlist: ListWaitlistQuery;
  listStaff: ListStaffQuery;
  listStaffRoleChanges: ListStaffRoleChangesQuery;
  getPasswordChangedAt: GetPasswordChangedAtQuery;
}

export interface AppIdentity {
  currentSession: ICurrentSessionPort;
  freshAuthVerifier: IFreshAuthVerifier;
  userRoleRepository: IUserRoleRepository;
  auditLogRepository: IAuditLogRepository;
  staffAccessRepository: IStaffAccessRepository;
  staffAccountProvisioner: IStaffAccountProvisioner;
  staffUserLookup: IStaffUserLookup;
  staffPasswordSetter: IStaffPasswordSetter;
}

/** What the e-mail workers need — the outbox and the (guarded) provider. */
export interface AppNotifications {
  outbox: IOutboxStore;
  provider: NotificationProvider;
}

/** What the receipt normalize worker needs — the raw bucket GET/PUT/DELETE
 * (OOC-19). Not `IReceiptStorage`: that port is scoped to the two
 * HTTP-facing usecases (mint a target, HEAD it), never to downloading or
 * writing bytes. */
export interface AppStorage {
  objectStore: ReceiptObjectStore;
}

/** The public-route protection (OOC-24): what stands between a burst of
 * requests and Postgres. On its own Redis connection — see createEdgeRedis. */
export interface AppEdge {
  redis: Redis;
  rateLimiter: RateLimiter;
  idempotency: IdempotencyCache;
  captcha: CaptchaVerifier;
}

export interface AppContainer {
  production: boolean;
  config: Config;
  logger: FastifyBaseLogger;
  auth: Auth;
  db: Db;
  identity: AppIdentity;
  notifications: AppNotifications;
  storage: AppStorage;
  edge: AppEdge;
  repositories: AppRepositories;
  useCases: AppUseCases;
  queries: AppQueries;
}

function buildContainer(): AppContainer {
  const config = loadConfig();
  const logger = createLogger(config);

  // Auth
  const auth = createAuth(config);
  const currentSession = new BetterAuthCurrentSessionPort(auth);

  // Public-route protection
  const edgeRedis = createEdgeRedis(config.REDIS_URL, logger);
  const edge: AppEdge = {
    redis: edgeRedis,
    rateLimiter: new RedisRateLimiter(edgeRedis, logger),
    idempotency: new RedisIdempotencyCache(edgeRedis, logger),
    captcha: new TurnstileCaptchaVerifier(config.TURNSTILE_SECRET_KEY, logger),
  };

  // Persistence
  const db = createDb(config);
  const freshAuthVerifier = new BetterAuthFreshAuthVerifier(auth, db);

  // Repositories
  const studentRepository = new DrizzleStudentRepository(db);
  const guardianRepository = new DrizzleGuardianRepository(db);
  const teacherRepository = new DrizzleTeacherRepository(db);
  const enrollmentRepository = new DrizzleEnrollmentRepository(db);
  const publicEnrollmentRepository = new DrizzlePublicEnrollmentRepository(db);
  const planPriceLookup = new DrizzlePlanPriceLookup(db);
  const seatHoldRepository = new DrizzleSeatHoldRepository(db);
  const emailVerificationRepository = new DrizzleEmailVerificationRepository(db);
  const receiptUploadRepository = new DrizzleReceiptUploadRepository(db);
  const receiptScreeningRepository = new DrizzleReceiptScreeningRepository(db);
  const receiptExtractionRepository = new DrizzleReceiptExtractionRepository(db);
  const platformSettingsRepository = new DrizzlePlatformSettingsRepository(db);
  const userRoleRepository = new DrizzleUserRoleRepository(db);
  const auditLogRepository = new DrizzleAuditLogRepository(db);
  const staffInviteRepository = new DrizzleStaffInviteRepository(db);
  const staffAccessRepository = new DrizzleStaffAccessRepository(db);
  const staffAccountProvisioner = new BetterAuthStaffAccountProvisioner(db);
  const staffUserLookup = new DrizzleStaffUserLookup(db);
  const staffPasswordResetRepository = new DrizzleStaffPasswordResetRepository(db);
  const staffPasswordSetter = new BetterAuthStaffPasswordSetter(db);
  const staffSessionRevoker = new BetterAuthStaffSessionRevoker(auth, db);
  const featureFlagOverrideRepository = new DrizzleFeatureFlagOverrideRepository(db);
  const catalogEntryRepository = new DrizzleCatalogEntryRepository(db);
  const courseRepository = new DrizzleCourseRepository(db);
  const planRepository = new DrizzlePlanRepository(db);
  const academicPeriodRepository = new DrizzleAcademicPeriodRepository(db);
  const classGroupRepository = new DrizzleClassGroupRepository(db);
  const waitlistRepository = new DrizzleWaitlistRepository(db);
  const enrollmentEmailContextLookup = new DrizzleEnrollmentEmailContextLookup(db);
  const paymentSettlementRepository = new DrizzlePaymentSettlementRepository(db);

  // Notifications
  const outboxRepository = new DrizzleOutboxRepository(db);
  const notificationProvider = createNotificationProvider(config, logger);

  // Storage (Tigris/S3-compatible — OOC-19)
  const s3Client = createS3Client(config);
  const receiptStorage = new TigrisReceiptStorage(s3Client, config.BUCKET_NAME);
  const receiptObjectStore = new ReceiptObjectStore(s3Client, config.BUCKET_NAME);

  // Use cases
  const registerStudent = new RegisterStudentUseCase(studentRepository, guardianRepository, auditLogRepository);
  const updateStudent = new UpdateStudentUseCase(studentRepository, guardianRepository, auditLogRepository);
  const saveGuardian = new SaveGuardianUseCase(studentRepository, guardianRepository, auditLogRepository);
  const registerTeacher = new RegisterTeacherUseCase(teacherRepository, auditLogRepository);
  const updateTeacher = new UpdateTeacherUseCase(teacherRepository, auditLogRepository);
  const updateTeacherAvailability = new UpdateTeacherAvailabilityUseCase(teacherRepository, auditLogRepository);
  const createManualEnrollment = new CreateManualEnrollmentUseCase(
    enrollmentRepository,
    planPriceLookup,
    enrollmentEmailContextLookup,
    auditLogRepository,
  );
  const submitPublicEnrollment = new SubmitPublicEnrollmentUseCase(
    publicEnrollmentRepository,
    seatHoldRepository,
    receiptUploadRepository,
  );
  const claimSeatHold = new ClaimSeatHoldUseCase(seatHoldRepository, platformSettingsRepository);
  const releaseSeatHold = new ReleaseSeatHoldUseCase(seatHoldRepository);
  const expireSeatHolds = new ExpireSeatHoldsUseCase(seatHoldRepository);
  const requestReceiptUpload = new RequestReceiptUploadUseCase(
    seatHoldRepository,
    receiptUploadRepository,
    receiptStorage,
    config.RECEIPT_MAX_UPLOAD_BYTES,
  );
  const confirmReceiptUpload = new ConfirmReceiptUploadUseCase(receiptUploadRepository, receiptStorage);
  const sendEmailVerification = new SendEmailVerificationCodeUseCase(emailVerificationRepository);
  const confirmEmailVerification = new ConfirmEmailVerificationUseCase(emailVerificationRepository);
  const screenReceiptUpload = new ScreenReceiptUploadUseCase(receiptScreeningRepository);
  const promoteRole = new PromoteUserRoleUseCase(freshAuthVerifier, userRoleRepository, auditLogRepository);
  const createInvite = new CreateStaffInviteUseCase(staffUserLookup, staffInviteRepository, auditLogRepository);
  const renewInvite = new RenewStaffInviteUseCase(staffInviteRepository, auditLogRepository);
  const cancelInvite = new CancelStaffInviteUseCase(staffInviteRepository, auditLogRepository);
  const completeInvite = new CompleteStaffInviteUseCase(staffInviteRepository, staffAccountProvisioner, auditLogRepository);
  const removeAccess = new RemoveStaffAccessUseCase(staffAccessRepository, auditLogRepository);
  const restoreAccess = new RestoreStaffAccessUseCase(staffAccessRepository, auditLogRepository);
  const setTeacherRosterStatus = new SetTeacherRosterStatusUseCase(
    teacherRepository,
    staffAccessRepository,
    auditLogRepository,
  );
  const createPasswordReset = new CreateStaffPasswordResetUseCase(staffPasswordResetRepository, auditLogRepository);
  const renewPasswordReset = new RenewStaffPasswordResetUseCase(staffPasswordResetRepository);
  const cancelPasswordReset = new CancelStaffPasswordResetUseCase(staffPasswordResetRepository);
  const completePasswordReset = new CompleteStaffPasswordResetUseCase(
    staffPasswordResetRepository,
    staffPasswordSetter,
    staffSessionRevoker,
    auditLogRepository,
  );
  const requestPasswordReset = new RequestStaffPasswordResetUseCase(
    staffUserLookup,
    staffPasswordResetRepository,
    new BackofficePasswordResetLinkBuilder(config.BACKOFFICE_PUBLIC_URL),
    auditLogRepository,
  );
  const changeOwnPassword = new ChangeOwnPasswordUseCase(
    freshAuthVerifier,
    staffPasswordSetter,
    staffSessionRevoker,
    auditLogRepository,
  );

  const setFeatureFlag = new SetFeatureFlagOverrideUseCase(featureFlagOverrideRepository, auditLogRepository);
  const updateCheckoutHoldMinutes = new UpdateCheckoutHoldMinutesUseCase(platformSettingsRepository, auditLogRepository);
  const updateReceiptAmountTolerance = new UpdateReceiptAmountToleranceUseCase(platformSettingsRepository, auditLogRepository);
  const updateReceiptRejectBelowPercent = new UpdateReceiptRejectBelowPercentUseCase(platformSettingsRepository, auditLogRepository);

  const retireCatalogEntry = new RetireCatalogEntryUseCase(catalogEntryRepository, auditLogRepository);
  const restoreCatalogEntry = new RestoreCatalogEntryUseCase(catalogEntryRepository, auditLogRepository);
  const createCourse = new CreateCourseUseCase(courseRepository, auditLogRepository);
  const updateCourse = new UpdateCourseUseCase(courseRepository, auditLogRepository);
  const createPlan = new CreatePlanUseCase(courseRepository, planRepository, auditLogRepository);
  const renamePlan = new RenamePlanUseCase(planRepository, auditLogRepository);
  const schedulePlanPrice = new SchedulePlanPriceUseCase(planRepository, auditLogRepository);
  const createPeriod = new CreateAcademicPeriodUseCase(academicPeriodRepository, auditLogRepository);
  const updatePeriod = new UpdateAcademicPeriodUseCase(academicPeriodRepository, auditLogRepository);
  const duplicatePeriod = new DuplicateClassGroupsUseCase(academicPeriodRepository, classGroupRepository, auditLogRepository);
  const createClassGroup = new CreateClassGroupUseCase(
    courseRepository,
    academicPeriodRepository,
    classGroupRepository,
    teacherRepository,
    auditLogRepository,
  );
  const updateClassGroup = new UpdateClassGroupUseCase(
    courseRepository,
    classGroupRepository,
    teacherRepository,
    auditLogRepository,
  );
  const advanceClassGroupStatus = new AdvanceClassGroupStatusUseCase(classGroupRepository, auditLogRepository);
  const joinWaitlist = new JoinWaitlistUseCase(classGroupRepository, waitlistRepository, auditLogRepository);
  const leaveWaitlist = new LeaveWaitlistUseCase(waitlistRepository, auditLogRepository);

  const portalLinkBuilder = new PortalLinkBuilder(config.PORTAL_PUBLIC_URL);
  const settlePayment = new SettlePaymentUseCase(paymentSettlementRepository, enrollmentEmailContextLookup, portalLinkBuilder);

  const portalAccessRepository = new DrizzlePortalAccessRepository(db);
  const portal = {
    resolveSignInEmail: new ResolvePortalSignInEmailUseCase(portalAccessRepository),
    requestPasswordReset: new RequestPortalPasswordResetUseCase(portalAccessRepository, portalLinkBuilder, auditLogRepository),
    completeAccess: new CompletePortalAccessUseCase(
      portalAccessRepository,
      new BetterAuthPortalPasswordSetter(db),
      staffSessionRevoker,
      auditLogRepository,
    ),
    issueAccess: new IssuePortalAccessUseCase(portalAccessRepository, portalLinkBuilder, auditLogRepository),
  };

  const receiptValidationRepository = new DrizzleReceiptValidationRepository(db);
  const validateReceipt = new ValidateReceiptUseCase(
    receiptValidationRepository,
    platformSettingsRepository,
  );

  // Queries (read-only, no domain invariant to protect — see class docs)
  const listStudents = new ListStudentsQuery(db);
  const getStudent = new GetStudentQuery(db);
  const studentPortal = new StudentPortalQuery(db, getStudent);
  const studentEnrollmentHistory = new StudentEnrollmentHistoryQuery(db);
  const studentActivity = new StudentActivityQuery(db);
  const listEnrollments = new ListEnrollmentsQuery(db);
  const listPayments = new ListPaymentsQuery(db);
  const listPaymentReviewQueue = new ListPaymentReviewQueueQuery(db);
  const dashboardSummary = new DashboardSummaryQuery(db);
  const paymentReceiptImage = new PaymentReceiptImageQuery(db, receiptObjectStore);
  const listOpenClassGroups = new ListOpenClassGroupsQuery(db);
  const getPublicCatalog = new GetPublicCatalogQuery(db);
  const listCourses = new ListCoursesQuery(db);
  const getCourse = new GetCourseQuery(db);
  const listPeriods = new ListPeriodsQuery(db);
  const listClassGroups = new ListClassGroupsQuery(db);
  const listTeachers = new ListTeachersQuery(db);
  const getTeacher = new GetTeacherQuery(db, listTeachers, listClassGroups);
  const listTeacherOptions = new ListTeacherOptionsQuery(db);
  const listWaitlist = new ListWaitlistQuery(db);
  const listStaff = new ListStaffQuery(db);
  const listStaffRoleChanges = new ListStaffRoleChangesQuery(db);
  const getPasswordChangedAt = new GetPasswordChangedAtQuery(db);

  return {
    production: config.NODE_ENV === "production",
    config,
    logger,
    auth,
    db,
    edge,
    identity: {
      currentSession,
      freshAuthVerifier,
      userRoleRepository,
      auditLogRepository,
      staffAccessRepository,
      staffAccountProvisioner,
      staffUserLookup,
      staffPasswordSetter,
    },
    notifications: {
      outbox: outboxRepository,
      provider: notificationProvider,
    },
    storage: {
      objectStore: receiptObjectStore,
    },
    repositories: {
      catalogEntry: catalogEntryRepository,
      course: courseRepository,
      academicPeriod: academicPeriodRepository,
      classGroup: classGroupRepository,
      waitlist: waitlistRepository,
      plan: planRepository,
      student: studentRepository,
      guardian: guardianRepository,
      teacher: teacherRepository,
      enrollment: enrollmentRepository,
      publicEnrollment: publicEnrollmentRepository,
      seatHold: seatHoldRepository,
      emailVerification: emailVerificationRepository,
      receiptUpload: receiptUploadRepository,
      receiptExtraction: receiptExtractionRepository,
      planPriceLookup,
      portalAccess: portalAccessRepository,
      staffInvite: staffInviteRepository,
      staffPasswordReset: staffPasswordResetRepository,
      featureFlagOverride: featureFlagOverrideRepository,
      platformSettings: platformSettingsRepository,
    },
    useCases: {
      teacher: {
        register: registerTeacher,
        update: updateTeacher,
        updateAvailability: updateTeacherAvailability,
        setRosterStatus: setTeacherRosterStatus,
      },
      student: {
        register: registerStudent,
        update: updateStudent,
        saveGuardian,
      },
      enrollment: {
        createManual: createManualEnrollment,
        submitPublic: submitPublicEnrollment,
        claimSeatHold,
        releaseSeatHold,
        expireSeatHolds,
        requestReceiptUpload,
        confirmReceiptUpload,
        sendEmailVerification,
        confirmEmailVerification,
        screenReceiptUpload,
        validateReceipt,
      },
      payment: {
        settlePayment,
      },
      staff: {
        promoteRole,
        createInvite,
        renewInvite,
        cancelInvite,
        completeInvite,
        removeAccess,
        restoreAccess,
        createPasswordReset,
        renewPasswordReset,
        cancelPasswordReset,
        completePasswordReset,
        requestPasswordReset,
        changeOwnPassword,
      },
      portal,
      platform: {
        setFeatureFlag,
        updateCheckoutHoldMinutes,
        updateReceiptAmountTolerance,
        updateReceiptRejectBelowPercent,
      },
      catalog: {
        retire: retireCatalogEntry,
        restore: restoreCatalogEntry,
        createCourse,
        updateCourse,
        createPlan,
        renamePlan,
        schedulePlanPrice,
        createPeriod,
        updatePeriod,
        duplicatePeriod,
        createClassGroup,
        updateClassGroup,
        advanceClassGroupStatus,
        joinWaitlist,
        leaveWaitlist,
      },
    },
    queries: {
      listStudents,
      getStudent,
      studentPortal,
      studentEnrollmentHistory,
      studentActivity,
      listTeachers,
      getTeacher,
      listTeacherOptions,
      listEnrollments,
      listPayments,
      listPaymentReviewQueue,
      dashboardSummary,
      paymentReceiptImage,
      listOpenClassGroups,
      getPublicCatalog,
      listCourses,
      getCourse,
      listPeriods,
      listClassGroups,
      listWaitlist,
      listStaff,
      listStaffRoleChanges,
      getPasswordChangedAt,
    },
  };
}

export const container = buildContainer();
