export interface TransactionDTO {
  id: string;
  userId: string;
  /** UTC ISO 8601 instant. Clients format in their own timezone. */
  transactionDate: string;
  merchant: string;
  amount: number;
  category: string;
  source: string;
  account?: string;
  note?: string;
  isIncome: boolean;
  /** User-marked recurring fixed expense (e.g. rent, a subscription). */
  isFixedExpense: boolean;
  aiConfidence?: number;
  createdAt: Date;
}

export interface TransactionFilters {
  limit: number;
  offset: number;
  category?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface BalanceFilters {
  startDate?: string;
  endDate?: string;
}

/** Per-category expense (debit) total over the balance's date range. */
export interface CategorySpendDTO {
  category: string;
  spent: number;
}

export interface BalanceDTO {
  credits: number;
  debits: number;
  balance: number;
  count: number;
  /**
   * Debit totals grouped by category over the same range, sorted by spend desc.
   * Sums to `debits`, so a client can render a category breakdown that matches
   * the balance total without re-aggregating (or capping) rows itself.
   */
  byCategory: CategorySpendDTO[];
  /**
   * Sum of expense (debit) transactions in the range flagged `isFixedExpense`.
   * Non-negative magnitude, consistent with `debits`. `0` when none.
   */
  fixedExpenses: number;
  startDate?: string;
  endDate?: string;
}

export interface CreateTransactionInput {
  /** UTC ISO 8601 instant from the client. */
  transactionDate: string;
  merchant: string;
  amount: number;
  category: string;
  currency?: string;
  subcategory?: string;
  /**
   * Transaction direction. Preferred over the legacy `isIncome` boolean; when
   * both are present, `transactionType` wins.
   */
  transactionType?: 'debit' | 'credit';
  source?: string;
  account?: string;
  note?: string;
  /**
   * Marks the transaction as a recurring fixed expense. On update this is
   * propagated to every transaction sharing the same category/amount/merchant.
   */
  isFixedExpense?: boolean;
  /** @deprecated Use `transactionType`. Retained for backward compatibility. */
  isIncome?: boolean;
}

export interface SupportedCategoryDTO {
  key: string;
  label: string;
}
