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

export interface BalanceDTO {
  credits: number;
  debits: number;
  balance: number;
  count: number;
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
  /** @deprecated Use `transactionType`. Retained for backward compatibility. */
  isIncome?: boolean;
}

export interface SupportedCategoryDTO {
  key: string;
  label: string;
}
