import { PendingTransaction, Transaction } from '../../../temporal-workflows/src/models';
import { TransactionDTO } from './transaction.service';
import { toDateStr, toTimeStr, formatWhen } from '../utils/date.utils';

export interface PendingDTO {
  id: string;
  user_id: string;
  merchant: string;
  amount: number;
  category: string;
  confidence: number;
  source: string;
  when: string;
  snippet: string;
  raw_email?: string;
}

export interface CreatePendingInput {
  merchant: string;
  amount: number;
  category: string;
  confidence: number;
  source: string;
  snippet?: string;
  rawEmail?: string;
  emailId?: string;
}

function toDTO(doc: any): PendingDTO {
  return {
    id: doc._id.toString(),
    user_id: doc.userId,
    merchant: doc.merchant,
    amount: doc.amount,
    category: doc.category,
    confidence: doc.confidence,
    source: doc.source,
    when: formatWhen(new Date(doc.createdAt)),
    snippet: doc.snippet,
    raw_email: doc.rawEmail,
  };
}

export class PendingService {
  async list(userId: string): Promise<PendingDTO[]> {
    const docs = await PendingTransaction.find({ userId }).sort({ createdAt: -1 }).lean();
    return docs.map(toDTO);
  }

  async create(userId: string, input: CreatePendingInput): Promise<PendingDTO> {
    const doc = await PendingTransaction.create({ userId, ...input });
    return toDTO(doc.toObject());
  }

  async approve(userId: string, id: string): Promise<TransactionDTO | null> {
    const item = await PendingTransaction.findOneAndDelete({ _id: id, userId }).lean();
    if (!item) return null;

    const rawAmount = item.amount ?? 0;
    const now = new Date();
    const tx = await Transaction.create({
      userId,
      transactionDate: now,
      merchant: item.merchant,
      amount: Math.abs(rawAmount),
      currency: 'USD',
      category: item.category,
      transactionType: rawAmount >= 0 ? 'credit' : 'debit',
      source: item.source,
      confidence: item.confidence,
      emailId: item.emailId,
      rawEmailText: item.rawEmail,
    });

    return {
      id: tx._id.toString(),
      user_id: tx.userId,
      date: toDateStr(now),
      time: toTimeStr(now),
      merchant: tx.merchant,
      amount: rawAmount,
      category: tx.category,
      source: tx.source ?? 'email',
      is_income: rawAmount >= 0,
      ai_confidence: tx.confidence,
      created_at: tx.createdAt,
    };
  }

  async reject(userId: string, id: string): Promise<boolean> {
    const result = await PendingTransaction.findOneAndDelete({ _id: id, userId });
    return result !== null;
  }
}
