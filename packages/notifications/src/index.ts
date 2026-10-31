export {
  EmailDeliveryError,
  RecipientNotAllowedError,
  type NotificationProvider,
  type OutgoingEmail,
} from "./NotificationProvider.js";
export {
  LOCALE_CATALOGS,
  TemplateRenderError,
  renderEmail,
  type LocaleCatalog,
  type RenderedEmail,
} from "./render/renderEmail.js";
export { BrevoNotificationProvider, type BrevoConfig } from "./providers/BrevoNotificationProvider.js";
export { AllowlistGuard, type AllowlistGuardConfig } from "./providers/AllowlistGuard.js";
export { LogNotificationProvider, type NotificationLogger } from "./providers/LogNotificationProvider.js";
export { templateVersion } from "./render/templateVersion.js";
