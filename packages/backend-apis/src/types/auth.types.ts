export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ConnectInput {
  email: string;
  provider: string;
}

export type UserRole = 'admin' | 'guest';

/** UI languages the system supports. Extend here as new locales are added. */
export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export interface MeDTO {
  id: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
  provider: string;
  identities: { provider: string; subject: string; linkedAt?: Date }[];
  lastLoginAt?: Date;
  createdAt: Date;
  tenantId?: string;
  role: UserRole;
  /**
   * Preferred UI language ('en' | 'es'). Absent when the user has never
   * chosen one — clients fall back to the device locale, then English.
   */
  language?: Language;
}
