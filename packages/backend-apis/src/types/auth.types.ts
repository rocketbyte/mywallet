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

/** UI color themes the system supports. */
export const SUPPORTED_THEMES = ['light', 'dark'] as const;
export type Theme = (typeof SUPPORTED_THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (SUPPORTED_THEMES as readonly string[]).includes(value);
}

/** Alert kinds that carry a per-account on/off preference. */
export const ALERT_PREFERENCE_KEYS = [
  'overBudget', 'largeTransaction', 'lowBalance', 'weeklySummary',
] as const;
export type AlertPreferenceKey = (typeof ALERT_PREFERENCE_KEYS)[number];
/** Fully-resolved preferences as returned to clients (every key present). */
export type AlertPreferencesDTO = Record<AlertPreferenceKey, boolean>;

/**
 * Resolve a stored (possibly partial/absent) preferences object into a full DTO
 * where every key is present. An unset key defaults to `true` — the switches
 * default on.
 */
export function resolveAlertPreferences(
  stored: Partial<Record<AlertPreferenceKey, unknown>> | null | undefined,
): AlertPreferencesDTO {
  const out = {} as AlertPreferencesDTO;
  for (const key of ALERT_PREFERENCE_KEYS) {
    out[key] = stored?.[key] !== false;
  }
  return out;
}

/**
 * Validate a client-supplied partial `alertPreferences` patch: it must be a
 * plain object whose known keys are booleans. Returns the sanitized patch
 * (unknown keys dropped), or an `error` message when the shape is invalid.
 */
export function parseAlertPreferencesPatch(
  value: unknown,
): { patch: Partial<Record<AlertPreferenceKey, boolean>> } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'alertPreferences must be an object' };
  }
  const patch: Partial<Record<AlertPreferenceKey, boolean>> = {};
  for (const key of ALERT_PREFERENCE_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') {
      return { error: `alertPreferences.${key} must be a boolean` };
    }
    patch[key] = v;
  }
  return { patch };
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
  /**
   * Preferred UI color theme ('light' | 'dark'). Absent when the user has
   * never chosen one — clients render light (the dark switch defaults off).
   */
  theme?: Theme;
  /**
   * Per-account alert on/off flags, fully resolved: every key is present, with
   * an unset stored preference reported as `true` (switches default on).
   */
  alertPreferences: AlertPreferencesDTO;
}
