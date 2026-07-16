/**
 * Localized deterministic strings for the analysis reports.
 *
 * Only strings produced WITHOUT an AI call live here (the empty-day result,
 * failure placeholders); AI-generated text is localized by the prompt's
 * language directive instead. The backend has no i18n runtime — with two
 * supported languages a literal catalog is the whole solution.
 */

export type AnalysisLanguage = 'en' | 'es';

/** Coerces any stored/user value to a supported language, defaulting to English. */
export function resolveAnalysisLanguage(value: unknown): AnalysisLanguage {
  return value === 'es' ? 'es' : 'en';
}

/** Human-readable language name for the prompt's "write in <X>" directive. */
export function languageDirectiveName(language: AnalysisLanguage): string {
  return language === 'es' ? 'Spanish (español)' : 'English';
}

export function emptyDaySummary(language: AnalysisLanguage): string {
  return language === 'es' ? 'Sin transacciones ayer.' : 'No transactions yesterday.';
}

export function emptyDayFullSummary(language: AnalysisLanguage, analysisDate: string): string {
  return language === 'es'
    ? `No se registraron transacciones el ${analysisDate}. No hay nada que revisar hoy.`
    : `No transactions were recorded on ${analysisDate}. Nothing to act on today.`;
}
