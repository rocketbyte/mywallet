/**
 * Provider registry for the backend-apis layer.
 * Each provider is instantiated once and shared across all route files.
 * To swap Gmail for Outlook (or add more): implement IEmailProvider and register here.
 */
import { GmailProvider } from './gmail/gmail.provider';

export const gmailProvider = new GmailProvider();
