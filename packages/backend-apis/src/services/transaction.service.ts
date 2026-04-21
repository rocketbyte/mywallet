import { Transaction } from '../../../temporal-workflows/src/models';
import { toDateStr, toTimeStr } from '../utils/date.utils';
import { escapeRegex } from '../utils/request.utils';

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

function toDTO(tx: any): TransactionDTO {
  const date = new Date(tx.transactionDate);
  return {
    id: tx._id.toString(),
    user_id: tx.userId,
    date: toDateStr(date),
    time: toTimeStr(date),
    merchant: tx.merchant,
    amount: tx.transactionType === 'credit' ? Math.abs(tx.amount) : -Math.abs(tx.amount),
    category: tx.category,
    source: tx.source ?? 'email',
    account: tx.accountNumber
      ? `${tx.bankName ?? ''} •${tx.accountNumber.slice(-4)}`.trim()
      : undefined,
    note: tx.note,
    is_income: tx.transactionType === 'credit',
    ai_confidence: tx.confidence,
    created_at: tx.createdAt,
  };
}

export class TransactionService {
  async list(userId: string, filters: TransactionFilters) {
    const { limit, offset, category, search, startDate, endDate } = filters;
    const query: Record<string, any> = { userId };

    if (category && category !== 'all') query.category = category;

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

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
    const transactionDate = new Date(`${input.date}T${input.time ?? '00:00'}:00`);
    const doc = await Transaction.create({
      userId,
      transactionDate,
      merchant: input.merchant,
      amount: Math.abs(input.amount),
      currency: 'USD',
      category: input.category,
      transactionType: input.is_income ? 'credit' : 'debit',
      source: input.source ?? 'manual',
      accountNumber: input.account,
      note: input.note,
    });
    return toDTO(doc.toObject());
  }

  async getById(userId: string, id: string): Promise<TransactionDTO | null> {
    const doc = await Transaction.findOne({ _id: id, userId }).lean();
    return doc ? toDTO(doc) : null;
  }

  async update(userId: string, id: string, input: Partial<CreateTransactionInput>): Promise<TransactionDTO | null> {
    const updates: Record<string, any> = {};
    if (input.merchant !== undefined) updates.merchant = input.merchant;
    if (input.category !== undefined) updates.category = input.category;
    if (input.note !== undefined) updates.note = input.note;
    if (input.source !== undefined) updates.source = input.source;
    if (input.is_income !== undefined) updates.transactionType = input.is_income ? 'credit' : 'debit';
    if (input.amount !== undefined) updates.amount = Math.abs(input.amount);
    if (input.date) updates.transactionDate = new Date(`${input.date}T${input.time ?? '00:00'}:00`);

    const doc = await Transaction.findOneAndUpdate({ _id: id, userId }, { $set: updates }, { new: true }).lean();
    return doc ? toDTO(doc) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await Transaction.findOneAndDelete({ _id: id, userId });
    return result !== null;
  }
}
