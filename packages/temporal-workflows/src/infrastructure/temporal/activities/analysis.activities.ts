/**
 * Daily Transaction Analysis Activities (Layer 3 — Interface Adapters)
 *
 * Three activities driving `dailyTransactionAnalysisWorkflow`:
 *
 *   aggregateDailyContext  — read-only DB pull of yesterday's transactions,
 *                            balance, current-month budget snapshot, recent
 *                            prior short summaries, and the tenant's language.
 *   analyzeDailyContext    — delegates to the 'daily' analyzer strategy
 *                            (tool-driven AI call, localized output) producing
 *                            { summary, fullSummary, suggestions }.
 *   persistDailyAnalysis   — upsert one TransactionAnalysis row keyed by
 *                            (userId, analysisDate).
 *
 * Prior summaries (not full reports) are fed to the AI as compact trend
 * context, intentionally bounded by ANALYSIS_PRIOR_SUMMARIES so prompt
 * tokens stay small.
 */
import { Context } from '@temporalio/activity';
import { DependencyContainer } from 'tsyringe';

import { Transaction } from '../../../models/transaction.model';
import { Budget } from '../../../models/budget.model';
import { TransactionAnalysis } from '../../../models/transaction-analysis.model';
import { Tenant } from '../../../models/tenant.model';
import { User } from '../../../models/user.model';
import { FinancialAnalyzerRegistry } from '../../../application/interfaces/analysis/financial-analyzer.interface';
import { PipelineStepRepositoryInterface } from '../../../application/interfaces/repositories/pipeline-step-repository.interface';
import {
  DailyAnalysisAIResult,
  DailyAnalysisContext,
  PersistDailyAnalysisInput,
  PersistDailyAnalysisResult,
} from '../../../shared/types';
import { PIPELINE_STEP_KEYS, ANALYSIS_PRIOR_SUMMARIES } from '../../../shared/constants';
import { resolveAnalysisLanguage } from '../../../shared/analysis-i18n';

/**
 * Tenant's preferred report language. userId is the User _id; an invalid id
 * or a missing/unset user degrades to English rather than failing the run.
 */
export async function resolveUserLanguage(userId: string): Promise<'en' | 'es'> {
  try {
    const user = await User.findById(userId).select({ language: 1 }).lean();
    return resolveAnalysisLanguage(user?.language);
  } catch {
    return 'en';
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns YYYY-MM-DD for yesterday in UTC. Used as the default when no
 * explicit analysisDate is supplied (the recurring Schedule case).
 */
function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Coerces an incoming analysisDate to a valid YYYY-MM-DD. Falls back to
 * `yesterdayUTC()` when missing, malformed, or producing an Invalid Date.
 * Returning a guaranteed-valid string here keeps every downstream date
 * computation (`startOfUTCDay`, `daysRemainingInMonth`) safe even if a
 * Schedule was registered with a bad arg or a manual call sent garbage.
 */
function resolveAnalysisDate(input: string | undefined): string {
  if (typeof input === 'string' && ISO_DATE_RE.test(input)) {
    const probe = new Date(`${input}T00:00:00.000Z`);
    if (!Number.isNaN(probe.getTime())) return input;
  }
  return yesterdayUTC();
}

function startOfUTCDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function nextUTCDay(isoDate: string): Date {
  const d = startOfUTCDay(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function daysRemainingInMonth(referenceISODate: string): number {
  const d = startOfUTCDay(referenceISODate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return lastDay - d.getUTCDate();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function createAnalysisActivities(container: DependencyContainer) {
  const analyzerRegistry = container.resolve<FinancialAnalyzerRegistry>('FinancialAnalyzerRegistry');
  const pipelineStepRepo = container.resolve<PipelineStepRepositoryInterface>(
    'PipelineStepRepositoryInterface'
  );

  return {
    /**
     * Step 1: Aggregate the day's context.
     *
     * Pulls yesterday's transactions, current balance, current-month budget
     * snapshot, and the last N short summaries from prior analyses. Returns
     * a typed context that the AI step will render into its prompt.
     */
    async aggregateDailyContext(input: {
      userId: string;
      analysisDate?: string;
    }): Promise<DailyAnalysisContext> {
      Context.current().heartbeat('aggregate-start');

      const { userId } = input;
      const analysisDate = resolveAnalysisDate(input.analysisDate);
      const dayStart = startOfUTCDay(analysisDate);
      const dayEnd = nextUTCDay(analysisDate);

      const tenant = await Tenant.findOne({ primaryUserId: userId }).lean();
      const currency = tenant?.currency ?? 'USD';
      const language = await resolveUserLanguage(userId);

      const transactionsDocs = await Transaction.find({
        userId,
        transactionDate: { $gte: dayStart, $lt: dayEnd },
      })
        .sort({ transactionDate: 1 })
        .lean();

      let income = 0;
      let expenses = 0;
      const transactions = transactionsDocs.map((t: any) => {
        const amount = Math.abs(Number(t.amount) || 0);
        if (t.transactionType === 'credit') income += amount;
        else expenses += amount;
        return {
          id: String(t._id),
          merchant: t.merchant,
          amount,
          currency: t.currency,
          transactionType: t.transactionType,
          category: t.category,
          transactionDate: new Date(t.transactionDate).toISOString(),
        };
      });
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

      // Current-month budget snapshot.
      const ref = dayStart;
      const month = ref.getUTCMonth() + 1;
      const year = ref.getUTCFullYear();
      const budget = await Budget.findOne({ userId, year, month }).lean();
      const budgetSnapshot = budget
        ? {
            totalBudget: round2(budget.totalBudget ?? 0),
            totalSpent: round2(budget.totalSpent ?? 0),
            percentUsed:
              budget.totalBudget && budget.totalBudget > 0
                ? round2(((budget.totalSpent ?? 0) / budget.totalBudget) * 100)
                : 0,
            daysRemainingInPeriod: daysRemainingInMonth(analysisDate),
          }
        : null;

      // Prior summaries, oldest-first.
      const priorDocs = await TransactionAnalysis.find({ userId })
        .sort({ analysisDate: -1 })
        .limit(ANALYSIS_PRIOR_SUMMARIES)
        .select({ summary: 1, analysisDate: 1 })
        .lean();
      const priorSummaries = priorDocs
        .map((d: any) => d.summary)
        .filter((s: string) => typeof s === 'string' && s.length > 0)
        .reverse();

      const step = await pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.ANALYZE_DAY);

      return {
        userId,
        analysisDate,
        currency,
        language,
        transactions,
        totals,
        balance,
        budgetSnapshot,
        priorSummaries,
        promptVersion: step.version,
      };
    },

    /**
     * Step 2: Delegate to the daily analyzer strategy.
     *
     * The activity owns the Temporal concerns (heartbeat cadence so a hung
     * worker is detected via heartbeatTimeout); the analyzer owns prompting,
     * the bounded tool loop, localization, and output validation. All tools
     * are read-only, so a retried attempt restarts the loop safely.
     */
    async analyzeDailyContext(context: DailyAnalysisContext): Promise<DailyAnalysisAIResult> {
      Context.current().heartbeat('analyze-start');

      const analyzer = analyzerRegistry.get<DailyAnalysisContext, DailyAnalysisAIResult>('daily');

      const heartbeat = setInterval(() => {
        try { Context.current().heartbeat('ai-call-in-progress'); } catch {}
      }, 20_000);

      try {
        return await analyzer.analyze(context, {
          heartbeat: () => {
            try { Context.current().heartbeat('tool-loop'); } catch {}
          },
        });
      } finally {
        clearInterval(heartbeat);
      }
    },

    /**
     * Step 3: Upsert the report keyed by (userId, analysisDate).
     *
     * Idempotent on re-run: the unique compound index on (userId, analysisDate)
     * means the same day overwrites instead of duplicating, satisfying the
     * "manual rerun" and "failed status" requirements.
     */
    async persistDailyAnalysis(
      input: PersistDailyAnalysisInput
    ): Promise<PersistDailyAnalysisResult> {
      Context.current().heartbeat('persist-start');

      const analysisDate = startOfUTCDay(resolveAnalysisDate(input.analysisDate));

      const doc: Record<string, unknown> = {
        userId: input.userId,
        analysisDate,
        currency: input.currency,
        language: resolveAnalysisLanguage(input.language),
        inputs: input.inputs,
        status: input.status,
        generatedAt: new Date(),
      };

      if (input.ai) {
        doc.summary = input.ai.summary;
        doc.fullSummary = input.ai.fullSummary;
        doc.suggestions = input.ai.suggestions;
        doc.modelMeta = input.ai.modelMeta;
        doc.failureReason = undefined;
      } else {
        doc.summary = '';
        doc.fullSummary = '';
        doc.suggestions = [];
        doc.modelMeta = { model: 'none', promptVersion: 0, tokensIn: 0, tokensOut: 0 };
        doc.failureReason = input.failureReason ?? 'unknown';
      }

      const result = await TransactionAnalysis.findOneAndUpdate(
        { userId: input.userId, analysisDate },
        { $set: doc },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      return { analysisId: String(result._id) };
    },
  };
}

export type AnalysisActivities = ReturnType<typeof createAnalysisActivities>;
