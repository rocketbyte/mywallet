/**
 * Monthly Financial Note Activities (Layer 3 — Interface Adapters)
 *
 * Three activities driving `monthlyFinancialNoteWorkflow`:
 *
 *   aggregateMonthlyContext  — read-only DB work: month numeric totals,
 *                              balance, budget snapshot, the month's daily
 *                              short summaries, the prior month's note, a
 *                              stable sourceHash, and the existing row (if any)
 *                              so the workflow can skip an unchanged month.
 *   analyzeMonthlyContext    — single AI call via the gateway producing
 *                              { note }. Skipped by the workflow when the
 *                              month is unchanged.
 *   persistMonthlyAnalysis   — upsert one MonthlyAnalysis row keyed by
 *                              (userId, year, month).
 *
 * Token discipline: the model only ever sees compact text it already produced
 * (the daily summaries) plus a single numeric block and one prior-month note.
 * It never receives raw transactions or daily full summaries. Numbers come
 * from DB aggregation, not the model.
 */
import { Context } from '@temporalio/activity';
import { DependencyContainer } from 'tsyringe';
import { createHash } from 'node:crypto';

import { Transaction } from '../../../models/transaction.model';
import { Budget } from '../../../models/budget.model';
import { TransactionAnalysis } from '../../../models/transaction-analysis.model';
import { MonthlyAnalysis } from '../../../models/monthly-analysis.model';
import { Tenant } from '../../../models/tenant.model';
import { AIGatewayInterface } from '../../../application/interfaces/gateways/ai-gateway.interface';
import { PipelineStepRepositoryInterface } from '../../../application/interfaces/repositories/pipeline-step-repository.interface';
import {
  MonthlyAnalysisAIResult,
  MonthlyAnalysisContext,
  MonthlyAnalysisBudgetSnapshot,
  PersistMonthlyAnalysisInput,
  PersistMonthlyAnalysisResult,
} from '../../../shared/types';
import {
  PIPELINE_STEP_KEYS,
  MONTHLY_MAX_DAILY_SUMMARIES,
  MONTHLY_NOTE_MAX_CHARS,
} from '../../../shared/constants';

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Current calendar year/month (month 1-based) in UTC. */
function currentYearMonthUTC(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * Coerces incoming year/month to a valid (year, month=1–12). Falls back to the
 * current UTC month when missing or out of range, so a Schedule registered
 * with no args or a manual call with garbage stays safe.
 */
function resolveYearMonth(year: number | undefined, month: number | undefined): { year: number; month: number } {
  const cur = currentYearMonthUTC();
  const y = Number.isInteger(year) && (year as number) >= 1970 && (year as number) <= 9999 ? (year as number) : cur.year;
  const m = Number.isInteger(month) && (month as number) >= 1 && (month as number) <= 12 ? (month as number) : cur.month;
  return { year: y, month: m };
}

function monthStartUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function nextMonthStartUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Days remaining in the target month relative to today. For the current month
 * it is (last day − today's day); for a fully-elapsed past month it is 0; for
 * a future month it is the whole month length.
 */
function daysRemainingInTargetMonth(year: number, month: number): number {
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;
  const lastDay = lastDayOfMonth(year, month);
  if (year === curY && month === curM) return Math.max(0, lastDay - now.getUTCDate());
  const isPast = year < curY || (year === curY && month < curM);
  return isPast ? 0 : lastDay;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncateNote(s: string, max = MONTHLY_NOTE_MAX_CHARS): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** Stable hash over the only things that should force a recompute. */
function computeSourceHash(parts: {
  dailySummaries: string[];
  totals: { income: number; expenses: number; net: number };
  balance: number;
  budgetSnapshot: MonthlyAnalysisBudgetSnapshot | null;
}): string {
  const payload = JSON.stringify({
    s: parts.dailySummaries,
    t: parts.totals,
    b: parts.balance,
    g: parts.budgetSnapshot,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function createMonthlyAnalysisActivities(container: DependencyContainer) {
  const aiGateway = container.resolve<AIGatewayInterface>('AIGatewayInterface');
  const pipelineStepRepo = container.resolve<PipelineStepRepositoryInterface>(
    'PipelineStepRepositoryInterface'
  );

  return {
    /**
     * Step 1: Aggregate the month's context.
     *
     * Numbers are computed by DB aggregation (no AI). The daily summaries are
     * collected as compact narrative input. The existing row + sourceHash let
     * the workflow skip the AI call when nothing changed.
     */
    async aggregateMonthlyContext(input: {
      userId: string;
      year?: number;
      month?: number;
    }): Promise<MonthlyAnalysisContext> {
      Context.current().heartbeat('aggregate-start');

      const { userId } = input;
      const { year, month } = resolveYearMonth(input.year, input.month);
      const monthStart = monthStartUTC(year, month);
      const monthEnd = nextMonthStartUTC(year, month);

      const tenant = await Tenant.findOne({ primaryUserId: userId }).lean();
      const currency = tenant?.currency ?? 'USD';

      // Month totals via aggregation — numeric only, no model involvement.
      const totalRows = await Transaction.aggregate<{ _id: 'credit' | 'debit'; total: number }>([
        { $match: { userId, transactionDate: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: '$transactionType', total: { $sum: '$amount' } } },
      ]);
      let income = 0;
      let expenses = 0;
      for (const row of totalRows) {
        if (row._id === 'credit') income = row.total;
        else if (row._id === 'debit') expenses = row.total;
      }
      const totals = { income: round2(income), expenses: round2(expenses), net: round2(income - expenses) };

      // Balance = lifetime credits − lifetime debits for this user.
      const balanceRows = await Transaction.aggregate<{ _id: 'credit' | 'debit'; total: number }>([
        { $match: { userId } },
        { $group: { _id: '$transactionType', total: { $sum: '$amount' } } },
      ]);
      let credits = 0;
      let debits = 0;
      for (const row of balanceRows) {
        if (row._id === 'credit') credits = row.total;
        else if (row._id === 'debit') debits = row.total;
      }
      const balance = round2(credits - debits);

      // Current-month budget snapshot for the target month.
      const budget = await Budget.findOne({ userId, year, month }).lean();
      const budgetSnapshot: MonthlyAnalysisBudgetSnapshot | null = budget
        ? {
            totalBudget: round2(budget.totalBudget ?? 0),
            totalSpent: round2(budget.totalSpent ?? 0),
            percentUsed:
              budget.totalBudget && budget.totalBudget > 0
                ? round2(((budget.totalSpent ?? 0) / budget.totalBudget) * 100)
                : 0,
            daysRemainingInPeriod: daysRemainingInTargetMonth(year, month),
          }
        : null;

      // The month's daily short summaries, oldest-first. The only narrative
      // input to the model. Bounded to MONTHLY_MAX_DAILY_SUMMARIES.
      const dailyDocs = await TransactionAnalysis.find({
        userId,
        analysisDate: { $gte: monthStart, $lt: monthEnd },
      })
        .sort({ analysisDate: 1 })
        .limit(MONTHLY_MAX_DAILY_SUMMARIES)
        .select({ summary: 1, analysisDate: 1 })
        .lean();
      const dailySummaries = dailyDocs
        .map((d: any) => d.summary)
        .filter((s: string) => typeof s === 'string' && s.length > 0);

      // Prior month's note (single string) for month-over-month context.
      const prevMonthStart = monthStartUTC(year, month);
      prevMonthStart.setUTCMonth(prevMonthStart.getUTCMonth() - 1);
      const priorYear = prevMonthStart.getUTCFullYear();
      const priorMonth = prevMonthStart.getUTCMonth() + 1;
      const priorDoc = await MonthlyAnalysis.findOne({ userId, year: priorYear, month: priorMonth })
        .select({ note: 1, status: 1 })
        .lean();
      const priorMonthNote =
        priorDoc && priorDoc.status === 'ready' && typeof priorDoc.note === 'string' && priorDoc.note.length > 0
          ? priorDoc.note
          : null;

      const sourceHash = computeSourceHash({ dailySummaries, totals, balance, budgetSnapshot });

      // Existing row for this month — lets the workflow skip an unchanged run.
      const existingDoc = await MonthlyAnalysis.findOne({ userId, year, month })
        .select({ 'inputs.sourceHash': 1, status: 1 })
        .lean();
      const existing = existingDoc
        ? {
            analysisId: String(existingDoc._id),
            sourceHash: existingDoc.inputs?.sourceHash ?? '',
            status: existingDoc.status as 'ready' | 'failed',
          }
        : null;

      const step = await pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.ANALYZE_MONTH);

      return {
        userId,
        year,
        month,
        currency,
        dailyCount: dailySummaries.length,
        dailySummaries,
        totals,
        balance,
        budgetSnapshot,
        priorMonthNote,
        sourceHash,
        existing,
        promptVersion: step.version,
      };
    },

    /**
     * Step 2: Call the AI with the rendered prompt.
     *
     * Heartbeats every 20s while the call is in flight. Produces a single
     * short `note`, truncated to MONTHLY_NOTE_MAX_CHARS on a word boundary.
     */
    async analyzeMonthlyContext(context: MonthlyAnalysisContext): Promise<MonthlyAnalysisAIResult> {
      Context.current().heartbeat('analyze-start');

      const step = await pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.ANALYZE_MONTH);

      const userMessage = renderTemplate(step.userPromptTemplate, {
        year: String(context.year),
        month: String(context.month),
        currency: context.currency,
        daily_count: String(context.dailyCount),
        daily_summaries_json: JSON.stringify(context.dailySummaries),
        totals_income: String(context.totals.income),
        totals_expenses: String(context.totals.expenses),
        totals_net: String(context.totals.net),
        balance: String(context.balance),
        budget_snapshot_json: JSON.stringify(context.budgetSnapshot),
        days_remaining: String(context.budgetSnapshot?.daysRemainingInPeriod ?? ''),
        prior_month_note: context.priorMonthNote ?? '',
      });

      const heartbeat = setInterval(() => {
        try { Context.current().heartbeat('ai-call-in-progress'); } catch {}
      }, 20_000);

      let result;
      try {
        result = await aiGateway.extractStructuredData({
          systemPrompt: step.systemPrompt,
          userPrompt: userMessage,
          temperature: step.temperature,
          maxTokens: step.maxTokens,
          responseFormat: 'json',
        });
      } finally {
        clearInterval(heartbeat);
      }

      const data = (result.data ?? {}) as Record<string, unknown>;
      const rawNote = typeof data.note === 'string' ? data.note.trim() : '';
      if (!rawNote) {
        throw new Error('analyze_month produced empty payload');
      }
      const note = truncateNote(rawNote);

      return {
        note,
        modelMeta: {
          model: aiGateway.getModelName(),
          promptVersion: step.version,
          tokensIn: 0,
          tokensOut: result.tokensUsed ?? 0,
        },
      };
    },

    /**
     * Step 3: Upsert the note keyed by (userId, year, month).
     *
     * Idempotent on re-run: the unique compound index on (userId, year, month)
     * means the same month overwrites instead of duplicating, satisfying the
     * "manual rerun" and "failed status" requirements.
     */
    async persistMonthlyAnalysis(
      input: PersistMonthlyAnalysisInput
    ): Promise<PersistMonthlyAnalysisResult> {
      Context.current().heartbeat('persist-start');

      const doc: Record<string, unknown> = {
        userId: input.userId,
        year: input.year,
        month: input.month,
        currency: input.currency,
        inputs: input.inputs,
        status: input.status,
        generatedAt: new Date(),
      };

      if (input.ai) {
        doc.note = input.ai.note;
        doc.modelMeta = input.ai.modelMeta;
        doc.failureReason = undefined;
      } else {
        doc.note = '';
        doc.modelMeta = { model: 'none', promptVersion: 0, tokensIn: 0, tokensOut: 0 };
        doc.failureReason = input.failureReason ?? 'unknown';
      }

      const result = await MonthlyAnalysis.findOneAndUpdate(
        { userId: input.userId, year: input.year, month: input.month },
        { $set: doc },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      return { analysisId: String(result._id) };
    },
  };
}

export type MonthlyAnalysisActivities = ReturnType<typeof createMonthlyAnalysisActivities>;
