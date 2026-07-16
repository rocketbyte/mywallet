/**
 * Daily-analysis toolset (Layer 3 — Interface Adapters)
 *
 * Read-only tools the model may call while writing the daily check-in. Every
 * handler reads the tenant from the injected scope — never from model args —
 * and returns bounded result sets so a chatty model cannot blow the prompt up.
 */
import { Transaction } from '../../../models/transaction.model';
import { Budget } from '../../../models/budget.model';
import { TransactionAnalysis } from '../../../models/transaction-analysis.model';
import { AnalysisToolInterface } from '../../../application/interfaces/analysis/financial-analyzer.interface';
import { ANALYSIS_PRIOR_SUMMARIES } from '../../../shared/constants';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayRangeUTC(isoDate: string): { start: Date; end: Date } | null {
  if (typeof isoDate !== 'string' || !ISO_DATE_RE.test(isoDate)) return null;
  const start = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function createDailyAnalysisTools(): AnalysisToolInterface[] {
  return [
    {
      definition: {
        name: 'getTransactionsForDay',
        description: "Returns the tenant's transactions for one UTC day (merchant, amount, type, category, date).",
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Day to fetch, formatted YYYY-MM-DD (UTC).' },
          },
          required: ['date'],
        },
      },
      async execute(args, scope) {
        const range = dayRangeUTC(String(args.date ?? ''));
        if (!range) return { error: 'date must be YYYY-MM-DD' };
        const rows = await Transaction.find({
          userId: scope.userId,
          transactionDate: { $gte: range.start, $lt: range.end },
        })
          .sort({ transactionDate: 1 })
          .limit(100)
          .select({ merchant: 1, amount: 1, transactionType: 1, category: 1, transactionDate: 1 })
          .lean();
        return rows.map((t: any) => ({
          merchant: t.merchant,
          amount: Math.abs(Number(t.amount) || 0),
          transactionType: t.transactionType,
          category: t.category,
          transactionDate: new Date(t.transactionDate).toISOString(),
        }));
      },
    },
    {
      definition: {
        name: 'getMerchantHistory',
        description: 'Returns the tenant\'s most recent charges for one merchant — use it to judge whether an amount is unusual or a charge looks duplicated.',
        parameters: {
          type: 'object',
          properties: {
            merchant: { type: 'string', description: 'Merchant name to look up (case-insensitive exact match).' },
            limit: { type: 'integer', description: 'Max rows to return (default 10, max 25).' },
          },
          required: ['merchant'],
        },
      },
      async execute(args, scope) {
        const merchant = String(args.merchant ?? '').trim();
        if (!merchant) return { error: 'merchant is required' };
        const rows = await Transaction.find({
          userId: scope.userId,
          merchant: { $regex: `^${merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        })
          .sort({ transactionDate: -1 })
          .limit(clampLimit(args.limit, 10, 25))
          .select({ merchant: 1, amount: 1, transactionType: 1, category: 1, transactionDate: 1 })
          .lean();
        return rows.map((t: any) => ({
          merchant: t.merchant,
          amount: Math.abs(Number(t.amount) || 0),
          transactionType: t.transactionType,
          category: t.category,
          transactionDate: new Date(t.transactionDate).toISOString(),
        }));
      },
    },
    {
      definition: {
        name: 'getPriorDailySummaries',
        description: "Returns the tenant's most recent prior daily analysis short summaries, oldest first — trend context.",
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: `Max summaries (default ${ANALYSIS_PRIOR_SUMMARIES}, max 14).` },
          },
        },
      },
      async execute(args, scope) {
        const docs = await TransactionAnalysis.find({ userId: scope.userId })
          .sort({ analysisDate: -1 })
          .limit(clampLimit(args.limit, ANALYSIS_PRIOR_SUMMARIES, 14))
          .select({ summary: 1, analysisDate: 1 })
          .lean();
        return docs
          .filter((d: any) => typeof d.summary === 'string' && d.summary.length > 0)
          .map((d: any) => ({ date: new Date(d.analysisDate).toISOString().slice(0, 10), summary: d.summary }))
          .reverse();
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
        const year = Number(args.year);
        const month = Number(args.month);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
          return { error: 'year and month (1-12) are required' };
        }
        const budget = await Budget.findOne({ userId: scope.userId, year, month })
          .select({ totalBudget: 1, totalSpent: 1 })
          .lean();
        if (!budget) return null;
        const totalBudget = Number(budget.totalBudget ?? 0);
        const totalSpent = Number(budget.totalSpent ?? 0);
        return {
          totalBudget,
          totalSpent,
          percentUsed: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 10000) / 100 : 0,
        };
      },
    },
  ];
}
