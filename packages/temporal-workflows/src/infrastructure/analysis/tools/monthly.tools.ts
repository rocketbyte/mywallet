/**
 * Monthly-analysis toolset (Layer 3 — Interface Adapters)
 *
 * Deliberately narrower than the daily toolset: the monthly note derives from
 * daily summaries and pre-aggregated numbers, never raw transaction rows —
 * that requirement (and token discipline) is enforced here by simply not
 * offering a raw-transaction tool. All handlers are read-only and read the
 * tenant from the injected scope only.
 */
import { Transaction } from '../../../models/transaction.model';
import { Budget } from '../../../models/budget.model';
import { TransactionAnalysis } from '../../../models/transaction-analysis.model';
import { AnalysisToolInterface } from '../../../application/interfaces/analysis/financial-analyzer.interface';
import { MONTHLY_MAX_DAILY_SUMMARIES } from '../../../shared/constants';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validYearMonth(args: Record<string, unknown>): { year: number; month: number } | null {
  const year = Number(args.year);
  const month = Number(args.month);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthRangeUTC(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function createMonthlyAnalysisTools(): AnalysisToolInterface[] {
  return [
    {
      definition: {
        name: 'getDailySummariesForMonth',
        description: "Returns the tenant's daily analysis short summaries for one calendar month, oldest first.",
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'integer', description: 'Calendar year, e.g. 2026.' },
            month: { type: 'integer', description: 'Calendar month 1-12.' },
          },
          required: ['year', 'month'],
        },
      },
      async execute(args, scope) {
        const ym = validYearMonth(args);
        if (!ym) return { error: 'year and month (1-12) are required' };
        const { start, end } = monthRangeUTC(ym.year, ym.month);
        const docs = await TransactionAnalysis.find({
          userId: scope.userId,
          analysisDate: { $gte: start, $lt: end },
        })
          .sort({ analysisDate: 1 })
          .limit(MONTHLY_MAX_DAILY_SUMMARIES)
          .select({ summary: 1, analysisDate: 1 })
          .lean();
        return docs
          .filter((d: any) => typeof d.summary === 'string' && d.summary.length > 0)
          .map((d: any) => ({ date: new Date(d.analysisDate).toISOString().slice(0, 10), summary: d.summary }));
      },
    },
    {
      definition: {
        name: 'getMonthTotals',
        description: "Returns the tenant's pre-aggregated income, expenses, and net for one calendar month — use it for month-over-month comparison.",
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'integer', description: 'Calendar year, e.g. 2026.' },
            month: { type: 'integer', description: 'Calendar month 1-12.' },
          },
          required: ['year', 'month'],
        },
      },
      async execute(args, scope) {
        const ym = validYearMonth(args);
        if (!ym) return { error: 'year and month (1-12) are required' };
        const { start, end } = monthRangeUTC(ym.year, ym.month);
        const rows = await Transaction.aggregate<{ _id: 'credit' | 'debit'; total: number }>([
          { $match: { userId: scope.userId, transactionDate: { $gte: start, $lt: end } } },
          { $group: { _id: '$transactionType', total: { $sum: '$amount' } } },
        ]);
        let income = 0;
        let expenses = 0;
        for (const row of rows) {
          if (row._id === 'credit') income = row.total;
          else if (row._id === 'debit') expenses = row.total;
        }
        return { income: round2(income), expenses: round2(expenses), net: round2(income - expenses) };
      },
    },
    {
      definition: {
        name: 'getCategoryTotalsForMonth',
        description: "Returns the tenant's pre-aggregated expense totals per category for one calendar month, biggest first — use it to name spending drivers and budget variance.",
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'integer', description: 'Calendar year, e.g. 2026.' },
            month: { type: 'integer', description: 'Calendar month 1-12.' },
          },
          required: ['year', 'month'],
        },
      },
      async execute(args, scope) {
        const ym = validYearMonth(args);
        if (!ym) return { error: 'year and month (1-12) are required' };
        const { start, end } = monthRangeUTC(ym.year, ym.month);
        const rows = await Transaction.aggregate<{ _id: string; total: number; count: number }>([
          {
            $match: {
              userId: scope.userId,
              transactionType: 'debit',
              transactionDate: { $gte: start, $lt: end },
            },
          },
          { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
          { $limit: 20 },
        ]);
        return rows.map((r) => ({ category: r._id ?? 'Other', total: round2(r.total), count: r.count }));
      },
    },
    {
      definition: {
        name: 'getBudgetSnapshot',
        description: "Returns the tenant's budget for one calendar month (total budget, spent, percent used).",
        parameters: {
          type: 'object',
          properties: {
            year: { type: 'integer', description: 'Calendar year, e.g. 2026.' },
            month: { type: 'integer', description: 'Calendar month 1-12.' },
          },
          required: ['year', 'month'],
        },
      },
      async execute(args, scope) {
        const ym = validYearMonth(args);
        if (!ym) return { error: 'year and month (1-12) are required' };
        const budget = await Budget.findOne({ userId: scope.userId, year: ym.year, month: ym.month })
          .select({ totalBudget: 1, totalSpent: 1 })
          .lean();
        if (!budget) return null;
        const totalBudget = Number(budget.totalBudget ?? 0);
        const totalSpent = Number(budget.totalSpent ?? 0);
        return {
          totalBudget: round2(totalBudget),
          totalSpent: round2(totalSpent),
          percentUsed: totalBudget > 0 ? round2((totalSpent / totalBudget) * 100) : 0,
        };
      },
    },
  ];
}
