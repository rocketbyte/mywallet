import { Alert } from '../models/alert.model';
import { User } from '../models/user.model';
import { monthToDateCategorySpend, resolveCategoryLimit } from './budget-limit';

/**
 * Whether the account (the data owner keyed by `userId`) wants over-budget
 * alerts. An account with no stored preference, or an unset `overBudget` key,
 * is treated as opted in — the switches default on. Only an explicit `false`
 * suppresses generation.
 */
async function isOverBudgetAlertEnabled(userId: string): Promise<boolean> {
  const user = await User.findById(userId).select('alertPreferences').lean();
  return user?.alertPreferences?.overBudget !== false;
}

/** A stored transaction relevant to over-budget evaluation. */
export interface BudgetAlertCandidate {
  userId: string;
  category: string;
  transactionType: 'debit' | 'credit';
  /** May arrive as a Date or ISO string (Temporal payload serialization). */
  transactionDate: Date | string;
  /** Currency of the stored transaction, used only for display formatting. */
  currency?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', DOP: 'RD$', MXN: '$', CAD: '$', BRL: 'R$',
};

function formatMoney(amount: number, currency?: string): string {
  const symbol = currency ? CURRENCY_SYMBOLS[currency.toUpperCase()] : undefined;
  const value = amount.toFixed(2);
  if (symbol) return `${symbol}${value}`;
  return currency ? `${value} ${currency.toUpperCase()}` : value;
}

/** Idempotency key for a category's over-budget alert in a given month. */
export function overBudgetDedupeKey(category: string, year: number, month: number): string {
  return `over:budget:${category}:${year}-${month}`;
}

/**
 * Evaluate a just-stored transaction against its category budget and, when the
 * category's month-to-date debit total has reached or exceeded its effective
 * limit, create exactly one `over` alert for that `(tenant, category, year,
 * month)`.
 *
 * Idempotent: a partial unique index on `(userId, dedupeKey)` makes repeated
 * calls (Temporal retries, email replays, every later transaction in the same
 * category/month) converge on a single alert. Safe to call on both genuine
 * inserts and idempotent re-stores.
 *
 * No-ops for credits, unbudgeted categories, and non-positive limits. Never
 * throws — alert generation MUST NOT fail the surrounding store activity.
 */
export async function evaluateBudgetAlert(c: BudgetAlertCandidate): Promise<void> {
  try {
    if (c.transactionType !== 'debit') return;

    const date = c.transactionDate instanceof Date ? c.transactionDate : new Date(c.transactionDate);
    if (Number.isNaN(date.getTime())) return;

    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    const limit = await resolveCategoryLimit(c.userId, c.category, year, month);
    if (limit == null || limit <= 0) return;

    // Respect the account's opt-out before doing the spend aggregation.
    if (!(await isOverBudgetAlertEnabled(c.userId))) return;

    const spent = await monthToDateCategorySpend(c.userId, c.category, date);
    if (spent < limit) return;

    const percentage = Math.round((spent / limit) * 100);
    const dedupeKey = overBudgetDedupeKey(c.category, year, month);

    await Alert.updateOne(
      { userId: c.userId, dedupeKey },
      {
        $setOnInsert: {
          userId: c.userId,
          kind: 'over',
          title: `${c.category} budget exceeded`,
          body:
            `You've spent ${formatMoney(spent, c.currency)} of your ` +
            `${formatMoney(limit, c.currency)} ${c.category} budget this month (${percentage}%).`,
          read: false,
          dedupeKey,
        },
      },
      { upsert: true },
    );
  } catch (err: any) {
    // A concurrent store may win the unique-index race; that is the intended
    // exactly-once outcome, not an error. Any other failure is swallowed so it
    // cannot break transaction storage.
    if (err?.code !== 11000) {
      // eslint-disable-next-line no-console
      console.warn('evaluateBudgetAlert failed', { userId: c.userId, category: c.category, err: err?.message });
    }
  }
}
