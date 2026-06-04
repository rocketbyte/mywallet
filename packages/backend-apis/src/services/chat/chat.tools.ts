import { Transaction, Tenant, Budget } from '../../../../temporal-workflows/src/models';
import { escapeRegex } from '../../utils/request.utils';
import { utcDayRange } from '../../utils/date.utils';
import type { ToolExecutor } from '../../types/chat.types';

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  async query_transactions(userId, input) {
    const limit = clampInt(input.limit, 1, 20, 10);
    const query: Record<string, unknown> = { userId };

    const range = buildDateRange(input.startDate, input.endDate);
    if (range) query.transactionDate = range;

    if (typeof input.category === 'string' && input.category) query.category = input.category;
    if (input.type === 'income') query.transactionType = 'credit';
    if (input.type === 'expense') query.transactionType = 'debit';
    if (typeof input.merchantContains === 'string' && input.merchantContains.trim()) {
      query.merchant = { $regex: escapeRegex(input.merchantContains.trim()), $options: 'i' };
    }

    const docs = await Transaction.find(query)
      .sort({ transactionDate: -1 })
      .limit(limit)
      .select('_id transactionDate merchant amount currency category transactionType bankName note')
      .lean();

    return {
      count: docs.length,
      transactions: docs.map((d) => ({
        id: String(d._id),
        date: toIsoDate(d.transactionDate),
        merchant: d.merchant,
        amount: d.transactionType === 'credit' ? Math.abs(d.amount) : -Math.abs(d.amount),
        currency: d.currency,
        category: d.category,
        type: d.transactionType === 'credit' ? 'income' : 'expense',
        bank: d.bankName,
        note: d.note,
      })),
    };
  },

  async get_spending_summary(userId, input) {
    const range = buildDateRange(input.startDate, input.endDate);
    if (!range) throw new Error('startDate and endDate are required');

    const groupBy = (input.groupBy as 'category' | 'merchant' | 'day' | undefined) ?? 'category';
    const groupExpr =
      groupBy === 'merchant'
        ? '$merchant'
        : groupBy === 'day'
        ? { $dateToString: { format: '%Y-%m-%d', date: '$transactionDate' } }
        : '$category';

    const rows = await Transaction.aggregate([
      { $match: { userId, transactionDate: range } },
      {
        $group: {
          _id: groupExpr,
          income: {
            $sum: { $cond: [{ $eq: ['$transactionType', 'credit'] }, '$amount', 0] },
          },
          expense: {
            $sum: { $cond: [{ $eq: ['$transactionType', 'debit'] }, '$amount', 0] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { expense: -1 } },
      { $limit: 25 },
    ]);

    const totals = rows.reduce(
      (acc, r) => {
        acc.income += r.income;
        acc.expense += r.expense;
        acc.count += r.count;
        return acc;
      },
      { income: 0, expense: 0, count: 0 },
    );

    return {
      groupBy,
      total: { ...totals, net: totals.income - totals.expense },
      groups: rows.map((r) => ({
        key: r._id,
        income: round2(r.income),
        expense: round2(r.expense),
        net: round2(r.income - r.expense),
        count: r.count,
      })),
    };
  },

  async get_budget(userId) {
    const [tenant, budget] = await Promise.all([
      Tenant.findOne({ userId }).lean(),
      Budget.findOne({ userId }).sort({ createdAt: -1 }).lean(),
    ]);

    const monthStart = startOfCurrentMonth();
    const [agg] = await Transaction.aggregate([
      {
        $match: {
          userId,
          transactionDate: { $gte: monthStart },
          transactionType: 'debit',
        },
      },
      { $group: { _id: null, spent: { $sum: '$amount' } } },
    ]);
    const spent = round2(agg?.spent ?? 0);

    return {
      currency: tenant?.currency ?? 'USD',
      monthlyLimit: tenant?.budgetLimit ?? 0,
      spentThisMonth: spent,
      remaining: round2((tenant?.budgetLimit ?? 0) - spent),
      hasCustomBudget: !!budget,
    };
  },
};

function buildDateRange(start: unknown, end: unknown): { $gte?: Date; $lte?: Date } | null {
  const s = typeof start === 'string' && start ? start : undefined;
  const e = typeof end === 'string' && end ? end : undefined;
  return utcDayRange(s, e);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function toIsoDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}
