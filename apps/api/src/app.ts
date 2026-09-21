import { randomUUID } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import errorHandlerPlugin from "@/infra/plugins/errorHandler.js";
import authorizationPlugin from "@/infra/plugins/authorization.js";
import swaggerPlugin from "@/infra/plugins/swagger.js";
import { mergeAuthIntoSwagger } from "@/infra/plugins/authSwagger.js";
import { rootRoute } from "@/http/RootRoute.js";
import { healthCheckRoute } from "@/http/HealthCheckRoute.js";
import { registerAuthRoutes } from "@/http/auth/AuthCatchAllRoute.js";
import { registerStudentRoute } from "@/http/student/RegisterStudentRoute.js";
import { listStudentsRoute } from "@/http/student/ListStudentsRoute.js";
import { getStudentRoute } from "@/http/student/GetStudentRoute.js";
import { createManualEnrollmentRoute } from "@/http/enrollment/CreateManualEnrollmentRoute.js";
import { listEnrollmentsRoute } from "@/http/enrollment/ListEnrollmentsRoute.js";
import { submitPublicEnrollmentRoute } from "@/http/enrollment/SubmitPublicEnrollmentRoute.js";
import { listOpenClassGroupsRoute } from "@/http/catalog/ListOpenClassGroupsRoute.js";
import { getPublicCatalogRoute } from "@/http/catalog/GetPublicCatalogRoute.js";
import { getCurrentStaffRoute } from "@/http/identity/GetCurrentStaffRoute.js";
import { listStaffRoute } from "@/http/identity/ListStaffRoute.js";
import { listStaffRoleChangesRoute } from "@/http/identity/ListStaffRoleChangesRoute.js";
import { createStaffInviteRoute } from "@/http/identity/CreateStaffInviteRoute.js";
import { renewStaffInviteRoute } from "@/http/identity/RenewStaffInviteRoute.js";
import { cancelStaffInviteRoute } from "@/http/identity/CancelStaffInviteRoute.js";
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
import { getFeatureFlagStateRoute } from "@/http/platform/GetFeatureFlagStateRoute.js";
import { listFeatureFlagsRoute } from "@/http/platform/ListFeatureFlagsRoute.js";
import { setFeatureFlagRoute } from "@/http/platform/SetFeatureFlagRoute.js";
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
        instance.withTypeProvider<ZodTypeProvider>().route(registerStudentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStudentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getStudentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createManualEnrollmentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listEnrollmentsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(submitPublicEnrollmentRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listOpenClassGroupsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getPublicCatalogRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(getCurrentStaffRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStaffRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listStaffRoleChangesRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(createStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(renewStaffInviteRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(cancelStaffInviteRoute);
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
        instance.withTypeProvider<ZodTypeProvider>().route(getFeatureFlagStateRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(listFeatureFlagsRoute);
        instance.withTypeProvider<ZodTypeProvider>().route(setFeatureFlagRoute);
        done();
      },
      { prefix: "/api/v1" },
    );
  });

  await app.ready();

  return app;
}
