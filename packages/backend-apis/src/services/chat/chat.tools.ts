import type OpenAI from 'openai';
import { Transaction, Tenant, Budget } from '../../../../temporal-workflows/src/models';
import { escapeRegex } from '../../utils/request.utils';

const CATEGORY_ENUM = [
  'food', 'groceries', 'transport', 'services', 'home',
  'health', 'entertainment', 'shopping', 'income', 'other',
] as const;

/**
 * Tool catalog exposed to the model. Keeping this list intentionally
 * small — each call to the model carries the full schema, so every tool
 * we add is a permanent context tax. Add a tool only when an existing
 * one cannot answer the question.
 */
export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description:
        'Search the user\'s transactions. Use this whenever the user asks about specific spending, merchants, recent activity, or anything that requires looking at concrete records. Resolve relative dates (e.g. "last week", "this month") to ISO YYYY-MM-DD before calling.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startDate: { type: 'string', description: 'Inclusive ISO date (YYYY-MM-DD).' },
          endDate: { type: 'string', description: 'Inclusive ISO date (YYYY-MM-DD).' },
          category: { type: 'string', enum: [...CATEGORY_ENUM] },
          merchantContains: { type: 'string', description: 'Case-insensitive substring match.' },
          type: { type: 'string', enum: ['income', 'expense'] },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_spending_summary',
      description:
        'Aggregate spending over a date range, optionally grouped by category, merchant, or day. Use this for totals, comparisons, or "where did my money go" questions — much cheaper than listing every transaction.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['startDate', 'endDate'],
        properties: {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          groupBy: { type: 'string', enum: ['category', 'merchant', 'day'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_budget',
      description: 'Returns the user\'s current monthly budget limit and the amount spent so far this month.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
];

type ToolExecutor = (userId: string, input: Record<string, unknown>) => Promise<unknown>;

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  async query_transactions(userId, input) {
    const limit = clampInt(input.limit, 1, 50, 20);
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

function buildDateRange(start: unknown, end: unknown): Record<string, Date> | null {
  const range: Record<string, Date> = {};
  if (typeof start === 'string' && start) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) range.$gte = d;
  }
  if (typeof end === 'string' && end) {
    const d = new Date(end);
    if (!isNaN(d.getTime())) {
      // Treat end as inclusive end-of-day so 'YYYY-MM-DD' captures that whole day.
      d.setHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  return Object.keys(range).length > 0 ? range : null;
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
