import { Transaction } from '../../../temporal-workflows/src/models';
import { normalizeMerchant } from '../../../temporal-workflows/src/shared/normalize-merchant';
import { SUPPORTED_TRANSACTION_CATEGORIES } from '../../../temporal-workflows/src/shared/categories';
import { utcDayRange } from '../utils/date.utils';
import { escapeRegex } from '../utils/request.utils';
import type {
  BalanceDTO,
  BalanceFilters,
  CreateTransactionInput,
  SupportedCategoryDTO,
  TransactionDTO,
  TransactionFilters,
} from '../types/transaction.types';

function toDTO(tx: any): TransactionDTO {
  return {
    id: tx._id.toString(),
    userId: tx.userId,
    transactionDate: new Date(tx.transactionDate).toISOString(),
    merchant: tx.merchant,
    amount: tx.transactionType === 'credit' ? Math.abs(tx.amount) : -Math.abs(tx.amount),
    category: tx.category,
    source: tx.source ?? 'email',
    account: tx.accountNumber
      ? `${tx.bankName ?? ''} •${tx.accountNumber.slice(-4)}`.trim()
      : undefined,
    note: tx.note,
    isIncome: tx.transactionType === 'credit',
    aiConfidence: tx.confidence,
    createdAt: tx.createdAt,
  };
}

export class TransactionService {
  async list(userId: string, filters: TransactionFilters) {
    const { limit, offset, category, search, startDate, endDate } = filters;
    const query: Record<string, any> = { userId };

    if (category && category !== 'all') query.category = category;

    const dateRange = utcDayRange(startDate, endDate);
    if (dateRange) query.transactionDate = dateRange;

    if (search) {
      const safe = escapeRegex(search);
      query.$or = [
        { merchant: { $regex: safe, $options: 'i' } },
        { note: { $regex: safe, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      Transaction.find(query).sort({ transactionDate: -1 }).skip(offset).limit(limit).lean(),
      Transaction.countDocuments(query),
    ]);

    return {
      transactions: docs.map(toDTO),
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    };
  }

  async create(userId: string, input: CreateTransactionInput): Promise<TransactionDTO> {
    const transactionDate = new Date(input.transactionDate);
    const doc = await Transaction.create({
      userId,
      transactionDate,
      merchant: normalizeMerchant(input.merchant),
      amount: Math.abs(input.amount),
      currency: input.currency ?? 'USD',
      category: input.category,
      subcategory: input.subcategory,
      transactionType: resolveTransactionType(input) ?? 'debit',
      source: input.source ?? 'manual',
      accountNumber: input.account,
      note: input.note,
    });
    return toDTO(doc.toObject());
  }

  /** The canonical, supported category taxonomy ({ key, label }), display-ordered. */
  listCategories(): SupportedCategoryDTO[] {
    return SUPPORTED_TRANSACTION_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));
  }

  async getById(userId: string, id: string): Promise<TransactionDTO | null> {
    const doc = await Transaction.findOne({ _id: id, userId }).lean();
    return doc ? toDTO(doc) : null;
  }

  async update(userId: string, id: string, input: Partial<CreateTransactionInput>): Promise<TransactionDTO | null> {
    const updates: Record<string, any> = {};
    if (input.merchant !== undefined) updates.merchant = normalizeMerchant(input.merchant);
    if (input.category !== undefined) updates.category = input.category;
    if (input.subcategory !== undefined) updates.subcategory = input.subcategory;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.note !== undefined) updates.note = input.note;
    if (input.source !== undefined) updates.source = input.source;
    const transactionType = resolveTransactionType(input);
    if (transactionType !== undefined) updates.transactionType = transactionType;
    if (input.amount !== undefined) updates.amount = Math.abs(input.amount);
    if (input.transactionDate) updates.transactionDate = new Date(input.transactionDate);

    const doc = await Transaction.findOneAndUpdate({ _id: id, userId }, { $set: updates }, { new: true }).lean();
    return doc ? toDTO(doc) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await Transaction.findOneAndDelete({ _id: id, userId });
    return result !== null;
  }

  /**
   * Aggregates credit and debit totals for the user over an optional
   * date range. Net balance is `credits - debits`. Amounts in storage
   * are always non-negative; the sign is implied by `transactionType`.
   */
  async getBalance(userId: string, filters: BalanceFilters): Promise<BalanceDTO> {
    const match: Record<string, unknown> = { userId };
    const dateRange = utcDayRange(filters.startDate, filters.endDate);
    if (dateRange) match.transactionDate = dateRange;

    const rows = await Transaction.aggregate<{ _id: 'credit' | 'debit'; total: number; count: number }>([
      { $match: match },
      { $group: { _id: '$transactionType', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    let credits = 0;
    let debits = 0;
    let count = 0;
    for (const row of rows) {
      if (row._id === 'credit') credits = row.total;
      else if (row._id === 'debit') debits = row.total;
      count += row.count;
    }

    return {
      credits: round2(credits),
      debits: round2(debits),
      balance: round2(credits - debits),
      count,
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolves the transaction direction from an input payload. `transactionType`
 * is authoritative; the legacy `isIncome` boolean is honored only as a fallback
 * for older clients. Returns `undefined` when neither field is present (so a
 * partial update leaves the stored value untouched).
 */
function resolveTransactionType(
  input: Partial<CreateTransactionInput>,
): 'debit' | 'credit' | undefined {
  if (input.transactionType !== undefined) return input.transactionType;
  if (input.isIncome !== undefined) return input.isIncome ? 'credit' : 'debit';
  return undefined;
}
