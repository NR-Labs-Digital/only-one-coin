import type { FastifyBaseLogger } from "fastify";
import {
  CancelStaffInviteUseCase,
  CancelStaffPasswordResetUseCase,
  CompleteStaffInviteUseCase,
  CompleteStaffPasswordResetUseCase,
  CreateManualEnrollmentUseCase,
  CreateStaffInviteUseCase,
  CreateStaffPasswordResetUseCase,
  PromoteUserRoleUseCase,
  RegisterStudentUseCase,
  RetireCatalogEntryUseCase,
  RemoveStaffAccessUseCase,
  RenewStaffInviteUseCase,
  RenewStaffPasswordResetUseCase,
  RestoreCatalogEntryUseCase,
  RestoreStaffAccessUseCase,
  SetFeatureFlagOverrideUseCase,
  SubmitPublicEnrollmentUseCase,
  type IAuditLogRepository,
  type ICatalogEntryRepository,
  type ICurrentSessionPort,
  type IEnrollmentRepository,
  type IFeatureFlagOverrideRepository,
  type IFreshAuthVerifier,
  type IGuardianRepository,
  type IPlanPriceLookup,
  type IPublicEnrollmentRepository,
  type IStaffAccessRepository,
  type IStaffAccountProvisioner,
  type IStaffInviteRepository,
  type IStaffPasswordResetRepository,
  type IStaffPasswordSetter,
  type IStaffUserLookup,
  type IStudentRepository,
  type IUserRoleRepository,
} from "@ooc/domain";
import { loadConfig, type Config } from "./config.js";
import { createLogger } from "./infra/logger.js";
import { createAuth, type Auth } from "./infra/auth/betterAuth.js";
import { BetterAuthCurrentSessionPort } from "./infra/identity/BetterAuthCurrentSessionPort.js";
import { BetterAuthFreshAuthVerifier } from "./infra/identity/BetterAuthFreshAuthVerifier.js";
import { BetterAuthStaffAccountProvisioner } from "./infra/identity/BetterAuthStaffAccountProvisioner.js";
import { BetterAuthStaffPasswordSetter } from "./infra/identity/BetterAuthStaffPasswordSetter.js";
import { DrizzleAuditLogRepository } from "./infra/identity/DrizzleAuditLogRepository.js";
import { DrizzleStaffAccessRepository } from "./infra/identity/DrizzleStaffAccessRepository.js";
import { DrizzleStaffInviteRepository } from "./infra/identity/DrizzleStaffInviteRepository.js";
import { DrizzleStaffPasswordResetRepository } from "./infra/identity/DrizzleStaffPasswordResetRepository.js";
import { DrizzleStaffUserLookup } from "./infra/identity/DrizzleStaffUserLookup.js";
import { DrizzleUserRoleRepository } from "./infra/identity/DrizzleUserRoleRepository.js";
import { createDb, type Db } from "./infra/db/client.js";
import { DrizzleStudentRepository } from "./infra/persistence/student/DrizzleStudentRepository.js";
import { DrizzleGuardianRepository } from "./infra/persistence/student/DrizzleGuardianRepository.js";
import { DrizzleEnrollmentRepository } from "./infra/persistence/enrollment/DrizzleEnrollmentRepository.js";
import { DrizzlePublicEnrollmentRepository } from "./infra/persistence/enrollment/DrizzlePublicEnrollmentRepository.js";
import { DrizzlePlanPriceLookup } from "./infra/persistence/enrollment/DrizzlePlanPriceLookup.js";
import { ListStudentsQuery } from "./infra/persistence/student/ListStudentsQuery.js";
import { GetStudentQuery } from "./infra/persistence/student/GetStudentQuery.js";
import { ListEnrollmentsQuery } from "./infra/persistence/enrollment/ListEnrollmentsQuery.js";
import { ListOpenClassGroupsQuery } from "./infra/persistence/catalog/ListOpenClassGroupsQuery.js";
import { GetPublicCatalogQuery } from "./infra/persistence/catalog/GetPublicCatalogQuery.js";
import { DrizzleCatalogEntryRepository } from "./infra/persistence/catalog/DrizzleCatalogEntryRepository.js";
import { ListStaffQuery } from "./infra/persistence/identity/ListStaffQuery.js";
import { ListStaffRoleChangesQuery } from "./infra/persistence/identity/ListStaffRoleChangesQuery.js";
import { DrizzleFeatureFlagOverrideRepository } from "./infra/persistence/platform/DrizzleFeatureFlagOverrideRepository.js";

export interface AppRepositories {
  catalogEntry: ICatalogEntryRepository;
  student: IStudentRepository;
  guardian: IGuardianRepository;
  enrollment: IEnrollmentRepository;
  publicEnrollment: IPublicEnrollmentRepository;
  planPriceLookup: IPlanPriceLookup;
  staffInvite: IStaffInviteRepository;
  staffPasswordReset: IStaffPasswordResetRepository;
  featureFlagOverride: IFeatureFlagOverrideRepository;
}

export interface AppUseCases {
  student: {
    register: RegisterStudentUseCase;
  };
  enrollment: {
    createManual: CreateManualEnrollmentUseCase;
    submitPublic: SubmitPublicEnrollmentUseCase;
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
  };
  platform: {
    setFeatureFlag: SetFeatureFlagOverrideUseCase;
  };
  catalog: {
    retire: RetireCatalogEntryUseCase;
    restore: RestoreCatalogEntryUseCase;
  };
}

export interface AppQueries {
  listStudents: ListStudentsQuery;
  listEnrollments: ListEnrollmentsQuery;
  getStudent: GetStudentQuery;
  listOpenClassGroups: ListOpenClassGroupsQuery;
  getPublicCatalog: GetPublicCatalogQuery;
  listStaff: ListStaffQuery;
  listStaffRoleChanges: ListStaffRoleChangesQuery;
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

export interface AppContainer {
  production: boolean;
  config: Config;
  logger: FastifyBaseLogger;
  auth: Auth;
  db: Db;
  identity: AppIdentity;
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

  // Persistence
  const db = createDb(config);
  const freshAuthVerifier = new BetterAuthFreshAuthVerifier(auth, db);

  // Repositories
  const studentRepository = new DrizzleStudentRepository(db);
  const guardianRepository = new DrizzleGuardianRepository(db);
  const enrollmentRepository = new DrizzleEnrollmentRepository(db);
  const publicEnrollmentRepository = new DrizzlePublicEnrollmentRepository(db);
  const planPriceLookup = new DrizzlePlanPriceLookup(db);
  const userRoleRepository = new DrizzleUserRoleRepository(db);
  const auditLogRepository = new DrizzleAuditLogRepository(db);
  const staffInviteRepository = new DrizzleStaffInviteRepository(db);
  const staffAccessRepository = new DrizzleStaffAccessRepository(db);
  const staffAccountProvisioner = new BetterAuthStaffAccountProvisioner(auth, db);
  const staffUserLookup = new DrizzleStaffUserLookup(db);
  const staffPasswordResetRepository = new DrizzleStaffPasswordResetRepository(db);
  const staffPasswordSetter = new BetterAuthStaffPasswordSetter(db);
  const featureFlagOverrideRepository = new DrizzleFeatureFlagOverrideRepository(db);
  const catalogEntryRepository = new DrizzleCatalogEntryRepository(db);

  // Use cases
  const registerStudent = new RegisterStudentUseCase(studentRepository, guardianRepository);
  const createManualEnrollment = new CreateManualEnrollmentUseCase(enrollmentRepository, planPriceLookup);
  const submitPublicEnrollment = new SubmitPublicEnrollmentUseCase(publicEnrollmentRepository);
  const promoteRole = new PromoteUserRoleUseCase(freshAuthVerifier, userRoleRepository, auditLogRepository);
  const createInvite = new CreateStaffInviteUseCase(staffUserLookup, staffInviteRepository, auditLogRepository);
  const renewInvite = new RenewStaffInviteUseCase(staffInviteRepository, auditLogRepository);
  const cancelInvite = new CancelStaffInviteUseCase(staffInviteRepository, auditLogRepository);
  const completeInvite = new CompleteStaffInviteUseCase(staffInviteRepository, staffAccountProvisioner, auditLogRepository);
  const removeAccess = new RemoveStaffAccessUseCase(staffAccessRepository, auditLogRepository);
  const restoreAccess = new RestoreStaffAccessUseCase(staffAccessRepository, auditLogRepository);
  const createPasswordReset = new CreateStaffPasswordResetUseCase(staffPasswordResetRepository, auditLogRepository);
  const renewPasswordReset = new RenewStaffPasswordResetUseCase(staffPasswordResetRepository);
  const cancelPasswordReset = new CancelStaffPasswordResetUseCase(staffPasswordResetRepository);
  const completePasswordReset = new CompleteStaffPasswordResetUseCase(
    staffPasswordResetRepository,
    staffPasswordSetter,
    auditLogRepository,
  );

  const setFeatureFlag = new SetFeatureFlagOverrideUseCase(featureFlagOverrideRepository, auditLogRepository);

  const retireCatalogEntry = new RetireCatalogEntryUseCase(catalogEntryRepository, auditLogRepository);
  const restoreCatalogEntry = new RestoreCatalogEntryUseCase(catalogEntryRepository, auditLogRepository);

  // Queries (read-only, no domain invariant to protect — see class docs)
  const listStudents = new ListStudentsQuery(db);
  const getStudent = new GetStudentQuery(db);
  const listEnrollments = new ListEnrollmentsQuery(db);
  const listOpenClassGroups = new ListOpenClassGroupsQuery(db);
  const getPublicCatalog = new GetPublicCatalogQuery(db);
  const listStaff = new ListStaffQuery(db);
  const listStaffRoleChanges = new ListStaffRoleChangesQuery(db);

  return {
    production: config.NODE_ENV === "production",
    config,
    logger,
    auth,
    db,
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
    repositories: {
      catalogEntry: catalogEntryRepository,
      student: studentRepository,
      guardian: guardianRepository,
      enrollment: enrollmentRepository,
      publicEnrollment: publicEnrollmentRepository,
      planPriceLookup,
      staffInvite: staffInviteRepository,
      staffPasswordReset: staffPasswordResetRepository,
      featureFlagOverride: featureFlagOverrideRepository,
    },
    useCases: {
      student: {
        register: registerStudent,
      },
      enrollment: {
        createManual: createManualEnrollment,
        submitPublic: submitPublicEnrollment,
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
      },
      platform: {
        setFeatureFlag,
      },
      catalog: {
        retire: retireCatalogEntry,
        restore: restoreCatalogEntry,
      },
    },
    queries: {
      listStudents,
      getStudent,
      listEnrollments,
      listOpenClassGroups,
      getPublicCatalog,
      listStaff,
      listStaffRoleChanges,
    },
  };
}

export const container = buildContainer();
