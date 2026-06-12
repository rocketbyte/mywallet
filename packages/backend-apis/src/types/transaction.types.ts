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
  /** User-marked recurrent transaction, re-created monthly by the recurring job. */
  isRecurrent: boolean;
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
   * Sum of debit transactions in the range that are NOT flagged `isFixedExpense`
   * — the period's variable/discretionary spend. Powers the dashboard's daily
   * average. Non-negative magnitude; `0` when none.
   */
  variableExpenses: number;
  startDate?: string;
  endDate?: string;
}

/** Whether the projected variable spend is under / slightly over / well over the variable budget. */
export type SpendingPaceStatus = 'under' | 'near' | 'over' | 'none';

/**
 * Backend-computed spending pace for a period — powers the dashboard's
 * "Projected" figure and the colour of the daily-average. See the change's
 * design.md for the model.
 */
export interface SpendingPaceDTO {
  /** Variable (non-fixed) spend ÷ days elapsed. */
  dailyAverage: number;
  /** Sustainable daily rate = variableBudget ÷ daysInMonth. Null when budget values are hidden from the requesting member. */
  expectedDailyAverage: number | null;
  /**
   * Projected month-end TOTAL spend = (dailyAverage × daysInMonth) + the
   * recurring fixed-expense total. The colour `status` still reflects only the
   * variable projection vs the variable budget.
   */
  projectedExpenses: number;
  /** Budget available for variable spend = max(0, budget − recurring fixed-expense total). Null when budget values are hidden from the requesting member. */
  variableBudget: number | null;
  /**
   * Signed budget variance: how far the daily average is over (+) or under (−)
   * the expected daily average, as a whole-number percent. `null` when there is
   * no target (no budget / zero variable budget).
   */
  variancePct: number | null;
  /** Variable budget still available this month (`max(0, variableBudget − variableExpenses)`); null when no budget. */
  safeToSpendRemaining: number | null;
  /**
   * Go-forward guidance: variable budget still available ÷ days remaining in the
   * month. `0` when the variable budget is spent; `null` when no budget.
   */
  safeToSpendPerDay: number | null;
  /**
   * Fixed costs still due this month (recurring commitment minus the fixed
   * already posted in range) — the amount pending to pay. Budget-independent;
   * `0` when nothing is pending.
   */
  reservedForFixed: number;
  status: SpendingPaceStatus;
  daysElapsed: number;
  daysInMonth: number;
  /** True when budget-derived fields were masked for a member of this wallet. */
  budgetHidden?: boolean;
}

/**
 * Recurring fixed-expense summary — a rolling view of the user's committed costs,
 * deliberately a separate resource from the range-scoped balance.
 */
export interface FixedExpensesSummaryDTO {
  /**
   * Sum over distinct fixed-expense signatures (category+amount+merchant) of
   * `isFixedExpense` debits across the previous and current calendar month, each
   * counted once. Anchored on the server date. Non-negative; `0` when none.
   */
  total: number;
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
  /** Marks the transaction recurrent (re-created monthly by the recurring job). */
  isRecurrent?: boolean;
  /** @deprecated Use `transactionType`. Retained for backward compatibility. */
  isIncome?: boolean;
}

export interface SupportedCategoryDTO {
  key: string;
  label: string;
}
