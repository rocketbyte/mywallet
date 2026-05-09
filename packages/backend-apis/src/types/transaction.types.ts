export interface TransactionDTO {
  id: string;
  user_id: string;
  date: string;
  time: string;
  merchant: string;
  amount: number;
  category: string;
  source: string;
  account?: string;
  note?: string;
  is_income: boolean;
  ai_confidence?: number;
  created_at: Date;
}

export interface TransactionFilters {
  limit: number;
  offset: number;
  category?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export interface CreateTransactionInput {
  date: string;
  time?: string;
  merchant: string;
  amount: number;
  category: string;
  source?: string;
  account?: string;
  note?: string;
  is_income?: boolean;
}
