/**
 * Daily Transaction Analysis Activities (Layer 3 — Interface Adapters)
 *
 * Three activities driving `dailyTransactionAnalysisWorkflow`:
 *
 *   aggregateDailyContext  — read-only DB pull of yesterday's transactions,
 *                            balance, current-month budget snapshot, and
 *                            recent prior short summaries.
 *   analyzeDailyContext    — single AI call via the gateway producing
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
import { randomUUID } from 'node:crypto';

import { Transaction } from '../../../models/transaction.model';
import { Budget } from '../../../models/budget.model';
import { TransactionAnalysis } from '../../../models/transaction-analysis.model';
import { Tenant } from '../../../models/tenant.model';
import { AIGatewayInterface } from '../../../application/interfaces/gateways/ai-gateway.interface';
import { PipelineStepRepositoryInterface } from '../../../application/interfaces/repositories/pipeline-step-repository.interface';
import {
  DailyAnalysisAIResult,
  DailyAnalysisContext,
  PersistDailyAnalysisInput,
  PersistDailyAnalysisResult,
} from '../../../shared/types';
import { PIPELINE_STEP_KEYS, ANALYSIS_PRIOR_SUMMARIES } from '../../../shared/constants';

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
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
  const aiGateway = container.resolve<AIGatewayInterface>('AIGatewayInterface');
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
      analysisDate: string;
    }): Promise<DailyAnalysisContext> {
      Context.current().heartbeat('aggregate-start');

      const { userId, analysisDate } = input;
      const dayStart = startOfUTCDay(analysisDate);
      const dayEnd = nextUTCDay(analysisDate);

      const tenant = await Tenant.findOne({ primaryUserId: userId }).lean();
      const currency = tenant?.currency ?? 'USD';

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
        transactions,
        totals,
        balance,
        budgetSnapshot,
        priorSummaries,
        promptVersion: step.version,
      };
    },

    /**
     * Step 2: Call the AI with the rendered prompt.
     *
     * Heartbeats every 20s while the AI call is in flight so Temporal can
     * detect a hung worker via heartbeatTimeout rather than waiting for
     * startToCloseTimeout.
     */
    async analyzeDailyContext(context: DailyAnalysisContext): Promise<DailyAnalysisAIResult> {
      Context.current().heartbeat('analyze-start');

      const step = await pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.ANALYZE_DAY);

      const userMessage = renderTemplate(step.userPromptTemplate, {
        today: new Date().toISOString().slice(0, 10),
        analysis_date: context.analysisDate,
        currency: context.currency,
        transaction_count: String(context.transactions.length),
        transactions_json: JSON.stringify(context.transactions),
        totals_income: String(context.totals.income),
        totals_expenses: String(context.totals.expenses),
        totals_net: String(context.totals.net),
        balance: String(context.balance),
        budget_snapshot_json: JSON.stringify(context.budgetSnapshot),
        days_remaining: String(context.budgetSnapshot?.daysRemainingInPeriod ?? ''),
        prior_summaries_json: JSON.stringify(context.priorSummaries),
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

      const data = (result.data ?? {}) as Partial<DailyAnalysisAIResult>;
      const summary = typeof data.summary === 'string' ? data.summary.slice(0, 200) : '';
      const fullSummary = typeof data.fullSummary === 'string' ? data.fullSummary : '';
      const suggestions = Array.isArray(data.suggestions)
        ? data.suggestions
            .filter((s: any) => s && typeof s.title === 'string' && typeof s.body === 'string')
            .slice(0, 4)
            .map((s: any) => ({
              id: typeof s.id === 'string' && s.id.length > 0 ? s.id : randomUUID(),
              title: String(s.title).slice(0, 96),
              body: String(s.body),
              urgency: (['info', 'warn', 'urgent'] as const).includes(s.urgency) ? s.urgency : 'info',
              category: typeof s.category === 'string' && s.category.length > 0 ? s.category : undefined,
            }))
        : [];

      if (!summary && !fullSummary && suggestions.length === 0) {
        throw new Error('analyze_day produced empty payload');
      }

      return {
        summary,
        fullSummary,
        suggestions,
        modelMeta: {
          model: aiGateway.getModelName(),
          promptVersion: step.version,
          tokensIn: 0,
          tokensOut: result.tokensUsed ?? 0,
        },
      };
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

      const analysisDate = startOfUTCDay(input.analysisDate);

      const doc: Record<string, unknown> = {
        userId: input.userId,
        analysisDate,
        currency: input.currency,
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
