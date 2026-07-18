import { Alert } from '../models/alert.model';
import { User } from '../models/user.model';
import { monthToDateCategorySpend, resolveCategoryLimit } from './budget-limit';
import { overBudgetAlertCopy, resolveLanguage } from './alert-i18n';

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

    // One read of the data owner: the opt-out gate and the language for the copy.
    const user = await User.findById(c.userId).select('alertPreferences language').lean();
    if (user?.alertPreferences?.overBudget === false) return;

    const spent = await monthToDateCategorySpend(c.userId, c.category, date);
    if (spent < limit) return;

    const percentage = Math.round((spent / limit) * 100);
    const dedupeKey = overBudgetDedupeKey(c.category, year, month);
    // Copy is localized to the data owner's language at generation time; the
    // dedupeKey stays on the raw category so idempotency is language-agnostic.
    const { title, body } = overBudgetAlertCopy(resolveLanguage(user?.language), {
      category: c.category,
      spent,
      limit,
      percentage,
      currency: c.currency,
    });

    await Alert.updateOne(
      { userId: c.userId, dedupeKey },
      {
        $setOnInsert: {
          userId: c.userId,
          kind: 'over',
          title,
          body,
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
