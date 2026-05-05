/**
 * Transaction Repository Interface (Layer 2 - Application)
 * Defines contract for transaction persistence
 * Follows Dependency Inversion Principle
 */
import { Transaction } from '../../../domain/entities/transaction.entity';

export interface TransactionRepositoryInterface {
  /**
   * Save a transaction to persistence
   */
  save(transaction: Transaction): Promise<Transaction>;

  /**
   * Find transaction by its ID
   */
  findById(id: string): Promise<Transaction | null>;

  /**
   * Find transaction by email ID scoped to a tenant (used for idempotency)
   */
  findByEmailId(userId: string, emailId: string): Promise<Transaction | null>;

  /**
   * Find a recently-stored transaction matching the same exact amount, currency,
   * and direction for the same tenant. Used to skip duplicate ingestion (e.g.
   * the bank sends the same notification twice, or two providers deliver it).
   */
  findRecentDuplicate(criteria: RecentDuplicateCriteria): Promise<Transaction | null>;

  /**
   * Find all transactions matching filters
   */
  findAll(filters?: TransactionFilters): Promise<Transaction[]>;

  /**
   * Get transaction statistics
   */
  getStats(params: StatsParams): Promise<TransactionStats>;
}

export interface RecentDuplicateCriteria {
  userId: string;
  amount: number;
  currency: string;
  transactionType: 'debit' | 'credit';
  /** Anchor date for the lookback window — typically the new transaction's date. */
  near: Date;
  /** Window size in hours, applied symmetrically around `near`. */
  windowHours: number;
}

export interface TransactionFilters {
  startDate?: Date;
  endDate?: Date;
  category?: string;
  minAmount?: number;
  maxAmount?: number;
  bankName?: string;
  transactionType?: 'debit' | 'credit';
}

export interface StatsParams {
  startDate?: Date;
  endDate?: Date;
  groupBy?: 'category' | 'month' | 'bank';
}

export interface TransactionStats {
  totalCount: number;
  totalAmount: number;
  averageAmount: number;
  categories?: CategoryStat[];
  monthlyStats?: MonthlyStat[];
}

export interface CategoryStat {
  category: string;
  count: number;
  totalAmount: number;
  percentage: number;
}

export interface MonthlyStat {
  month: number;
  year: number;
  count: number;
  totalAmount: number;
}
