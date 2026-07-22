import './hookPayloads';
export type { PreEmailSendPayload, PostEmailSendPayload } from './hookPayloads';

export { sendEmail } from './sendEmail';
export type { SendEmailInput } from './sendEmail';
export { renderEmailLayout } from './renderEmailLayout';
export type { RenderEmailLayoutInput, RenderedEmail } from './renderEmailLayout';
export {
  registerEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  resetEmailTemplatesForTests,
} from './templates';
export type { EmailTemplate } from './templates';
export { getBuiltInEmailTemplate, listBuiltInEmailTemplates } from './builtInTemplates';
export type { PasswordResetTemplateData, EmailChangeTemplateData } from './builtInTemplates';

export { ConsoleSender } from './adapters/console';
export { ResendSender } from './adapters/resend';
export { SmtpSender } from './adapters/smtp';
export { autoSelectEmailSender } from './autoSelect';
export type { AutoSelectEmailSenderOptions } from './autoSelect';

export {
  registerEmailConfig,
  getEmailConfig,
  DEFAULT_EMAIL_CONFIG,
} from './emailConfig';
export type {
  EmailConfig,
  EmailConfigInput,
  EmailLoggingConfig,
  EmailEnvVarsConfig,
  EmailDefaultsConfig,
} from './emailConfig';

//? Re-exports of the registry surface so consumers can do everything from
//? one import path: `import { ConsoleSender, registerEmailSenders } from '@luckystack/email';`
export {
  registerEmailSender,
  registerEmailSenders,
  getEmailSender,
  getEmailSenderByName,
  listEmailSenderNames,
  isEmailSenderRegistered,
} from '@luckystack/core';
export type {
  EmailDeliveryOutcome,
  EmailSendContext,
  EmailSender,
  EmailMessage,
  EmailResult,
  EmailSenderRegistry,
} from '@luckystack/core';
