import { randomUUID } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import errorHandlerPlugin from "@/infra/plugins/errorHandler.js";
import authorizationPlugin from "@/infra/plugins/authorization.js";
import clientIpPlugin from "@/infra/plugins/clientIp.js";
import rateLimitPlugin from "@/infra/plugins/rateLimit.js";
import swaggerPlugin from "@/infra/plugins/swagger.js";
import { mergeAuthIntoSwagger } from "@/infra/plugins/authSwagger.js";
import { rootRoute } from "@/http/RootRoute.js";
import { healthCheckRoute } from "@/http/HealthCheckRoute.js";
import { registerAuthRoutes } from "@/http/auth/AuthCatchAllRoute.js";
import { portalSignInRoute } from "@/http/portal/PortalSignInRoute.js";
import { requestPortalPasswordResetRoute } from "@/http/portal/RequestPortalPasswordResetRoute.js";
import { getPortalAccessTokenRoute, completePortalAccessTokenRoute } from "@/http/portal/PortalAccessTokenRoutes.js";
import { getPortalMeRoute } from "@/http/portal/GetPortalMeRoute.js";
import { getPortalOverviewRoute } from "@/http/portal/GetPortalOverviewRoute.js";
import { getPortalPaymentReceiptRoute } from "@/http/portal/GetPortalPaymentReceiptRoute.js";
import { registerStudentRoute } from "@/http/student/RegisterStudentRoute.js";
import { exportStudentsRoute } from "@/http/student/ExportStudentsRoute.js";
import { listStudentsRoute } from "@/http/student/ListStudentsRoute.js";
import { searchStudentsRoute } from "@/http/student/SearchStudentsRoute.js";
import { getStudentRoute } from "@/http/student/GetStudentRoute.js";
import { updateStudentRoute } from "@/http/student/UpdateStudentRoute.js";
import { listTeachersRoute } from "@/http/teacher/ListTeachersRoute.js";
import { getTeacherRoute } from "@/http/teacher/GetTeacherRoute.js";
import { listOwnClassGroupsRoute } from "@/http/teaching/ListOwnClassGroupsRoute.js";
import { getOwnClassGroupRoute } from "@/http/teaching/GetOwnClassGroupRoute.js";
import { listOwnClassGroupStudentsRoute } from "@/http/teaching/ListOwnClassGroupStudentsRoute.js";
import { getTeachingSummaryRoute } from "@/http/teaching/GetTeachingSummaryRoute.js";
import { registerTeacherRoute } from "@/http/teacher/RegisterTeacherRoute.js";
import { updateTeacherRoute } from "@/http/teacher/UpdateTeacherRoute.js";
import { updateTeacherAvailabilityRoute } from "@/http/teacher/UpdateTeacherAvailabilityRoute.js";
import { setTeacherRosterStatusRoute } from "@/http/teacher/SetTeacherRosterStatusRoute.js";
import { generateTeacherContractRoute } from "@/http/teacher/GenerateTeacherContractRoute.js";
import { getDocumentTemplateRoute } from "@/http/document/GetDocumentTemplateRoute.js";
import { saveDocumentTemplateDraftRoute } from "@/http/document/SaveDocumentTemplateDraftRoute.js";
import { previewDocumentTemplateRoute } from "@/http/document/PreviewDocumentTemplateRoute.js";
import { publishDocumentTemplateRoute } from "@/http/document/PublishDocumentTemplateRoute.js";
import { requestTeacherContractUploadRoute } from "@/http/teacher/RequestTeacherContractUploadRoute.js";
import { fileTeacherContractRoute } from "@/http/teacher/FileTeacherContractRoute.js";
import { openTeacherContractRoute } from "@/http/teacher/OpenTeacherContractRoute.js";
import { saveGuardianRoute } from "@/http/student/SaveGuardianRoute.js";
import { listStudentActivityRoute } from "@/http/student/ListStudentActivityRoute.js";
import { issuePortalAccessRoute } from "@/http/student/IssuePortalAccessRoute.js";
import { createManualEnrollmentRoute } from "@/http/enrollment/CreateManualEnrollmentRoute.js";
import { listPaymentsRoute } from "@/http/payment/ListPaymentsRoute.js";
import { listPaymentReviewQueueRoute } from "@/http/payment/ListPaymentReviewQueueRoute.js";
import { getDashboardSummaryRoute } from "@/http/dashboard/GetDashboardSummaryRoute.js";
import { getPaymentReceiptRoute } from "@/http/payment/GetPaymentReceiptRoute.js";
import { approvePaymentRoute, rejectPaymentRoute } from "@/http/payment/SettlePaymentRoute.js";
import { rereadPaymentReceiptRoute } from "@/http/payment/RereadPaymentReceiptRoute.js";
import { listEnrollmentsRoute } from "@/http/enrollment/ListEnrollmentsRoute.js";
import { submitPublicEnrollmentRoute } from "@/http/enrollment/SubmitPublicEnrollmentRoute.js";
import { claimSeatHoldRoute } from "@/http/enrollment/ClaimSeatHoldRoute.js";
import { releaseSeatHoldRoute } from "@/http/enrollment/ReleaseSeatHoldRoute.js";
import { requestReceiptUploadRoute } from "@/http/enrollment/RequestReceiptUploadRoute.js";
import { confirmReceiptUploadRoute } from "@/http/enrollment/ConfirmReceiptUploadRoute.js";
import { sendEmailVerificationRoute } from "@/http/enrollment/SendEmailVerificationRoute.js";
import { confirmEmailVerificationRoute } from "@/http/enrollment/ConfirmEmailVerificationRoute.js";
import { listOpenClassGroupsRoute } from "@/http/catalog/ListOpenClassGroupsRoute.js";
import { getPublicCatalogRoute } from "@/http/catalog/GetPublicCatalogRoute.js";
import { retireCatalogEntryRoute } from "@/http/catalog/RetireCatalogEntryRoute.js";
import { restoreCatalogEntryRoute } from "@/http/catalog/RestoreCatalogEntryRoute.js";
import { listCoursesRoute } from "@/http/catalog/ListCoursesRoute.js";
import { getCourseRoute } from "@/http/catalog/GetCourseRoute.js";
import { createCourseRoute } from "@/http/catalog/CreateCourseRoute.js";
import { updateCourseRoute } from "@/http/catalog/UpdateCourseRoute.js";
import { updateCourseOptionsRoute } from "@/http/catalog/UpdateCourseOptionsRoute.js";
import { createPlanRoute } from "@/http/catalog/CreatePlanRoute.js";
import { renamePlanRoute } from "@/http/catalog/RenamePlanRoute.js";
import { schedulePlanPriceRoute } from "@/http/catalog/SchedulePlanPriceRoute.js";
import { listPeriodsRoute } from "@/http/catalog/ListPeriodsRoute.js";
import { createPeriodRoute } from "@/http/catalog/CreatePeriodRoute.js";
import { updatePeriodRoute } from "@/http/catalog/UpdatePeriodRoute.js";
import { duplicatePeriodRoute } from "@/http/catalog/DuplicatePeriodRoute.js";
import { listClassGroupsRoute } from "@/http/catalog/ListClassGroupsRoute.js";
import { getClassGroupRoute } from "@/http/catalog/GetClassGroupRoute.js";
import { createClassGroupRoute } from "@/http/catalog/CreateClassGroupRoute.js";
import { updateClassGroupRoute } from "@/http/catalog/UpdateClassGroupRoute.js";
import { listTeacherOptionsRoute } from "@/http/catalog/ListTeacherOptionsRoute.js";
import { advanceClassGroupStatusRoute } from "@/http/catalog/AdvanceClassGroupStatusRoute.js";
import { getClassGroupRosterRoute } from "@/http/catalog/GetClassGroupRosterRoute.js";
import { listWaitlistRoute } from "@/http/catalog/ListWaitlistRoute.js";
import { joinWaitlistRoute } from "@/http/catalog/JoinWaitlistRoute.js";
import { leaveWaitlistRoute } from "@/http/catalog/LeaveWaitlistRoute.js";
import { getCurrentStaffRoute } from "@/http/identity/GetCurrentStaffRoute.js";
import { getOwnPasswordRoute } from "@/http/identity/GetOwnPasswordRoute.js";
import { changeOwnPasswordRoute } from "@/http/identity/ChangeOwnPasswordRoute.js";
import { getOwnMfaRoute } from "@/http/identity/GetOwnMfaRoute.js";
import { startOwnMfaEnrollmentRoute } from "@/http/identity/StartOwnMfaEnrollmentRoute.js";
import { confirmOwnMfaEnrollmentRoute } from "@/http/identity/ConfirmOwnMfaEnrollmentRoute.js";
import { regenerateOwnRecoveryCodesRoute } from "@/http/identity/RegenerateOwnRecoveryCodesRoute.js";
import { disableOwnMfaRoute } from "@/http/identity/DisableOwnMfaRoute.js";
import { listStaffRoute } from "@/http/identity/ListStaffRoute.js";
import { listStaffRoleChangesRoute } from "@/http/identity/ListStaffRoleChangesRoute.js";
import { exportAuditLogRoute } from "@/http/audit/ExportAuditLogRoute.js";
import { listAuditActorsRoute } from "@/http/audit/ListAuditActorsRoute.js";
import { listAuditLogRoute } from "@/http/audit/ListAuditLogRoute.js";
import { createStaffInviteRoute } from "@/http/identity/CreateStaffInviteRoute.js";
import { renewStaffInviteRoute } from "@/http/identity/RenewStaffInviteRoute.js";
import { cancelStaffInviteRoute } from "@/http/identity/CancelStaffInviteRoute.js";
import { listInvitableTeachersRoute } from "@/http/identity/ListInvitableTeachersRoute.js";
import { getStaffInviteRoute } from "@/http/identity/GetStaffInviteRoute.js";
import { completeStaffInviteRoute } from "@/http/identity/CompleteStaffInviteRoute.js";
import { promoteStaffRoleRoute } from "@/http/identity/PromoteStaffRoleRoute.js";
import { removeStaffAccessRoute } from "@/http/identity/RemoveStaffAccessRoute.js";
import { restoreStaffAccessRoute } from "@/http/identity/RestoreStaffAccessRoute.js";
import { createStaffPasswordResetRoute } from "@/http/identity/CreateStaffPasswordResetRoute.js";
import { renewStaffPasswordResetRoute } from "@/http/identity/RenewStaffPasswordResetRoute.js";
import { cancelStaffPasswordResetRoute } from "@/http/identity/CancelStaffPasswordResetRoute.js";
import { getStaffPasswordResetRoute } from "@/http/identity/GetStaffPasswordResetRoute.js";
import { completeStaffPasswordResetRoute } from "@/http/identity/CompleteStaffPasswordResetRoute.js";
import { requestStaffPasswordResetRoute } from "@/http/identity/RequestStaffPasswordResetRoute.js";
import { getFeatureFlagStateRoute } from "@/http/platform/GetFeatureFlagStateRoute.js";
import { listFeatureFlagsRoute } from "@/http/platform/ListFeatureFlagsRoute.js";
import { setFeatureFlagRoute } from "@/http/platform/SetFeatureFlagRoute.js";
import { getPlatformSettingsRoute } from "@/http/platform/GetPlatformSettingsRoute.js";
import { updatePlatformSettingsRoute } from "@/http/platform/UpdatePlatformSettingsRoute.js";
import { container } from "@/container.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({ loggerInstance: container.logger, genReqId: () => randomUUID() });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);

  if (!container.production) {
    await app.register(swaggerPlugin);
    await mergeAuthIntoSwagger(app, container.auth);
  }

  // Registered after swagger-ui — its own /docs routes are added during
  // swaggerPlugin's registration above and must not go through the
  // deny-by-default onRoute check below (CLAUDE.md §6 targets application
  // routes; the swagger UI's internal routes aren't built via RouteBuilder
  // and are dev-only in the first place, container.production gated above).
  // Same reasoning for the rate limit's onRoute check. Order matters below:
  // the client IP is resolved first, per-IP limits run before the session
  // lookup in authorization (a burst never reaches the database).
  await app.register(clientIpPlugin, { proxySecret: container.config.API_PROXY_SECRET });
  await app.register(rateLimitPlugin, { limiter: container.edge.rateLimiter });
  await app.register(authorizationPlugin);

  app.after(() => {
    const provider = app.withTypeProvider<ZodTypeProvider>();

    // common routes
    provider.route(rootRoute);
    provider.route(healthCheckRoute);

    // auth routes
    registerAuthRoutes(app, container.auth);

    // api routes, prefixed with /api/v1
    provider.register(
      (instance, _opts, done) => {
        instance.withTypeProvider<ZodTypeProvider>().route(portalSignInRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(requestPortalPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPortalAccessTokenRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(completePortalAccessTokenRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPortalMeRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPortalOverviewRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPortalPaymentReceiptRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(registerStudentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStudentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(exportStudentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(searchStudentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getStudentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updateStudentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(saveGuardianRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStudentActivityRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(issuePortalAccessRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listTeachersRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getTeacherRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(registerTeacherRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updateTeacherRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updateTeacherAvailabilityRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(setTeacherRosterStatusRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(generateTeacherContractRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getDocumentTemplateRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(saveDocumentTemplateDraftRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(previewDocumentTemplateRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(publishDocumentTemplateRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(requestTeacherContractUploadRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(fileTeacherContractRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(openTeacherContractRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listOwnClassGroupsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getOwnClassGroupRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listOwnClassGroupStudentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getTeachingSummaryRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createManualEnrollmentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listEnrollmentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listPaymentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listPaymentReviewQueueRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getDashboardSummaryRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPaymentReceiptRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(approvePaymentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(rejectPaymentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(rereadPaymentReceiptRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(submitPublicEnrollmentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(claimSeatHoldRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(releaseSeatHoldRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(requestReceiptUploadRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(confirmReceiptUploadRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(sendEmailVerificationRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(confirmEmailVerificationRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listOpenClassGroupsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPublicCatalogRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(retireCatalogEntryRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(restoreCatalogEntryRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listCoursesRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getCourseRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createCourseRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updateCourseRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updateCourseOptionsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createPlanRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(renamePlanRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(schedulePlanPriceRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listPeriodsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createPeriodRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updatePeriodRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(duplicatePeriodRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listClassGroupsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getClassGroupRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createClassGroupRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updateClassGroupRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listTeacherOptionsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(advanceClassGroupStatusRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getClassGroupRosterRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listWaitlistRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(joinWaitlistRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(leaveWaitlistRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getCurrentStaffRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getOwnPasswordRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(changeOwnPasswordRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getOwnMfaRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(startOwnMfaEnrollmentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(confirmOwnMfaEnrollmentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(regenerateOwnRecoveryCodesRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(disableOwnMfaRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStaffRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStaffRoleChangesRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listAuditLogRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listAuditActorsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(exportAuditLogRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(renewStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(cancelStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listInvitableTeachersRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(completeStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(promoteStaffRoleRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(removeStaffAccessRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(restoreStaffAccessRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createStaffPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(renewStaffPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(cancelStaffPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getStaffPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(completeStaffPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(requestStaffPasswordResetRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getFeatureFlagStateRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listFeatureFlagsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(setFeatureFlagRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPlatformSettingsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(updatePlatformSettingsRoute);
        done();
      },
      { prefix: "/api/v1" },
    );
  });

  await app.ready();

  return app;
}
