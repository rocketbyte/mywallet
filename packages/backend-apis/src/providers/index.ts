/**
 * Provider registry for the backend-apis layer.
 * Each provider is instantiated once and shared across all route files.
 * To support a new email provider: implement IEmailProvider and add a
 * `.register(new YourProvider())` call below — no other call sites change.
 */
import { EmailProviderRegistry } from './email-provider.registry';
import { GmailProvider } from './gmail/gmail.provider';

export const emailProviders = new EmailProviderRegistry()
  .register(new GmailProvider());

// Backward-compat handle for call sites that still depend on the Gmail
// provider directly (the Pub/Sub webhook is Gmail-specific by definition).
export const gmailProvider = emailProviders.get('gmail');

export { EmailProviderRegistry } from './email-provider.registry';
export { UnsupportedProviderError } from './errors';
export type {
  AuthorizationContext,
  AuthState,
  EmailProviderType,
  IEmailProvider,
  LinkAccountInput,
  LinkAccountResult,
  AccountStatus,
} from './types';
