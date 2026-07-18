/**
 * Localized copy for generated alerts.
 *
 * Alerts are short, deterministic templated strings, so — like the analysis
 * reports (`analysis-i18n.ts`) — they are localized at generation time from a
 * literal catalog rather than a runtime i18n library. Two supported languages
 * (`en` | `es`); English is the default for any unset/unknown value.
 */
import { localizedCategoryLabel } from './categories';

export type AlertLanguage = 'en' | 'es';

/** Coerce any stored/user value to a supported language, defaulting to English. */
export function resolveLanguage(value: unknown): AlertLanguage {
  return value === 'es' ? 'es' : 'en';
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', DOP: 'RD$', MXN: '$', CAD: '$', BRL: 'R$',
};

/** Format a money amount for alert copy (symbol-prefixed, two decimals). */
export function formatMoney(amount: number, currency?: string): string {
  const symbol = currency ? CURRENCY_SYMBOLS[currency.toUpperCase()] : undefined;
  const value = amount.toFixed(2);
  if (symbol) return `${symbol}${value}`;
  return currency ? `${value} ${currency.toUpperCase()}` : value;
}

export interface OverBudgetCopyParams {
  category: string;
  spent: number;
  limit: number;
  percentage: number;
  currency?: string;
}

/** Localized `{ title, body }` for an over-budget alert. */
export function overBudgetAlertCopy(
  language: AlertLanguage,
  params: OverBudgetCopyParams,
): { title: string; body: string } {
  const category = localizedCategoryLabel(params.category, language);
  const spent = formatMoney(params.spent, params.currency);
  const limit = formatMoney(params.limit, params.currency);

  if (language === 'es') {
    return {
      title: `Presupuesto de ${category} excedido`,
      body: `Has gastado ${spent} de tu presupuesto de ${limit} para ${category} este mes (${params.percentage}%).`,
    };
  }
  return {
    title: `${category} budget exceeded`,
    body: `You've spent ${spent} of your ${limit} ${category} budget this month (${params.percentage}%).`,
  };
}
