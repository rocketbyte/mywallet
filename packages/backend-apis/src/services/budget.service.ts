import { Budget, Transaction } from '../../../temporal-workflows/src/models';
import { periodStart, periodEnd } from '../utils/date.utils';

export interface BudgetCategoryDTO {
  category: string;
  budget: number;
  spent: number;
}

export interface BudgetDTO {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  limit_amount: number;
  categories: BudgetCategoryDTO[];
}

export interface UpsertBudgetInput {
  period_start?: string;
  limit_amount: number;
  categories?: { category: string; budget: number }[];
}

async function getSpentByCategory(userId: string, month: number, year: number): Promise<Record<string, number>> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const rows = await Transaction.aggregate([
    { $match: { userId, transactionType: 'debit', transactionDate: { $gte: start, $lte: end } } },
    { $group: { _id: '$category', total: { $sum: '$amount' } } },
  ]);
  return Object.fromEntries(rows.map((r: any) => [r._id, r.total]));
}

function toDTO(doc: any, spent: Record<string, number>): BudgetDTO {
  return {
    id: doc._id.toString(),
    user_id: doc.userId,
    period_start: periodStart(doc.month, doc.year),
    period_end: periodEnd(doc.month, doc.year),
    limit_amount: doc.totalBudget,
    categories: (doc.categories ?? []).map((c: any) => ({
      category: c.category,
      budget: c.budgetAmount,
      spent: spent[c.category] ?? 0,
    })),
  };
}

export class BudgetService {
  async getCurrent(userId: string): Promise<BudgetDTO | null> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const doc = await Budget.findOne({ userId, month, year }).lean();
    if (!doc) return null;
    const spent = await getSpentByCategory(userId, month, year);
    return toDTO(doc, spent);
  }

  async upsert(userId: string, input: UpsertBudgetInput): Promise<BudgetDTO> {
    const date = new Date(input.period_start);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const categories = (input.categories ?? []).map((c) => ({
      category: c.category,
      budgetAmount: c.budget,
      spentAmount: 0,
      transactionCount: 0,
    }));
    const doc = await Budget.findOneAndUpdate(
      { userId, month, year },
      { $set: { userId, month, year, totalBudget: input.limit_amount, categories, lastCalculatedAt: new Date() } },
      { upsert: true, new: true }
    ).lean();
    const spent = await getSpentByCategory(userId, month, year);
    return toDTO(doc, spent);
  }

  async update(userId: string, id: string, input: Partial<UpsertBudgetInput>): Promise<BudgetDTO | null> {
    const updates: Record<string, any> = { lastCalculatedAt: new Date() };
    if (input.limit_amount !== undefined) updates.totalBudget = input.limit_amount;
    if (input.categories) {
      updates.categories = input.categories.map((c) => ({
        category: c.category,
        budgetAmount: c.budget,
        spentAmount: 0,
        transactionCount: 0,
      }));
    }
    const doc = await Budget.findOneAndUpdate({ _id: id, userId }, { $set: updates }, { new: true }).lean();
    if (!doc) return null;
    const spent = await getSpentByCategory(userId, doc.month ?? 1, doc.year ?? new Date().getFullYear());
    return toDTO(doc, spent);
  }
}
