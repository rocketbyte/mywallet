/**
 * Canonical transaction category taxonomy — the single backend-owned source of
 * truth for the category contract. Stored values are the lowercase `key`s; the
 * `label`s are display-ready names served to clients so a picker never drifts
 * from what the write endpoints accept. Keep this list in sync with the paired
 * presentation map in `mintly-app/constants/categories.ts`.
 */
export interface SupportedCategory {
  /** Stored, lowercase contract value. */
  key: string;
  /** Human-readable display name. */
  label: string;
}

export const SUPPORTED_TRANSACTION_CATEGORIES: readonly SupportedCategory[] = [
  { key: 'food', label: 'Food & Dining' },
  { key: 'groceries', label: 'Groceries' },
  { key: 'transport', label: 'Transport' },
  { key: 'travel', label: 'Travel' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'bills', label: 'Bills & Utilities' },
  { key: 'housing', label: 'Housing & Rent' },
  { key: 'health', label: 'Health' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'education', label: 'Education' },
  { key: 'personal', label: 'Personal' },
  { key: 'income', label: 'Income' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'other', label: 'Other' },
] as const;

export const SUPPORTED_CATEGORY_KEYS: readonly string[] =
  SUPPORTED_TRANSACTION_CATEGORIES.map((c) => c.key);

/** True when `value` is one of the canonical category keys. */
export function isTransactionCategoryKey(value: unknown): value is string {
  return typeof value === 'string' && SUPPORTED_CATEGORY_KEYS.includes(value);
}

export const TRANSACTION_TYPES = ['debit', 'credit'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** True when `value` is a valid transaction direction. */
export function isTransactionType(value: unknown): value is TransactionType {
  return value === 'debit' || value === 'credit';
}
