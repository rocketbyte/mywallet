/**
 * Monthly Financial Analyzer (Layer 3 — Interface Adapters)
 *
 * Strategy behind the `analyzeMonthlyContext` activity. Keeps the
 * accuracy-critical property of the monthly note: every number and the budget
 * verdict are computed HERE (deterministically) and handed to the model —
 * the model only narrates. The tool loop lets it pull daily summaries,
 * category totals, and prior-month aggregates, never raw transactions
 * (enforced by the monthly toolset itself). Falls back to the single-shot
 * path when the active model rejects tools.
 */
import {
  AIGatewayInterface,
  ToolsUnsupportedError,
} from '../../application/interfaces/gateways/ai-gateway.interface';
import {
  AnalysisToolCallRecord,
  AnalyzerRunOptions,
  FinancialAnalyzerInterface,
} from '../../application/interfaces/analysis/financial-analyzer.interface';
import { PipelineStepRepositoryInterface } from '../../application/interfaces/repositories/pipeline-step-repository.interface';
import { runToolLoop } from '../../application/analysis/tool-loop';
import { parseJsonContent } from '../external/ai/openai/parse-json-content';
import { MonthlyAnalysisAIResult, MonthlyAnalysisContext } from '../../shared/types';
import { MONTHLY_NOTE_MAX_CHARS, PIPELINE_STEP_KEYS } from '../../shared/constants';
import { languageDirectiveName, resolveAnalysisLanguage } from '../../shared/analysis-i18n';
import { createMonthlyAnalysisTools } from './tools/monthly.tools';
import { renderTemplate } from './render-template';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncateNote(s: string, max = MONTHLY_NOTE_MAX_CHARS): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export class MonthlyFinancialAnalyzer
  implements FinancialAnalyzerInterface<MonthlyAnalysisContext, MonthlyAnalysisAIResult>
{
  readonly kind = 'monthly';

  constructor(
    private readonly aiGateway: AIGatewayInterface,
    private readonly pipelineStepRepo: PipelineStepRepositoryInterface
  ) {}

  async analyze(
    context: MonthlyAnalysisContext,
    options?: AnalyzerRunOptions
  ): Promise<MonthlyAnalysisAIResult> {
    const language = resolveAnalysisLanguage(context.language);
    const step = await this.pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.ANALYZE_MONTH);

    // Deterministic budget verdict computed in code — the model MUST NOT do
    // this arithmetic itself. `overBudget`/`status` are the only basis the
    // prompt is allowed to use for any "exceeded/on-track" statement.
    const snap = context.budgetSnapshot;
    const hasBudget = snap !== null && snap.totalBudget > 0;
    const remainingBudget = hasBudget ? round2(snap!.totalBudget - context.totals.expenses) : 0;
    const overBudget = hasBudget && context.totals.expenses > snap!.totalBudget;
    const percentUsed = hasBudget ? round2((context.totals.expenses / snap!.totalBudget) * 100) : 0;
    const budgetStatus = !hasBudget
      ? 'no_budget'
      : overBudget
        ? 'over_budget'
        : percentUsed >= 80
          ? 'near_limit'
          : 'under_budget';
    // Whether we have enough to produce an accurate report at all.
    const hasData =
      context.dailyCount > 0 || context.totals.expenses > 0 || context.totals.income > 0 || hasBudget;

    const userPrompt = renderTemplate(step.userPromptTemplate, {
      year: String(context.year),
      month: String(context.month),
      currency: context.currency,
      language: languageDirectiveName(language),
      daily_count: String(context.dailyCount),
      daily_summaries_json: JSON.stringify(context.dailySummaries),
      totals_income: String(context.totals.income),
      totals_expenses: String(context.totals.expenses),
      totals_net: String(context.totals.net),
      balance: String(context.balance),
      budget_snapshot_json: JSON.stringify(context.budgetSnapshot),
      days_remaining: String(context.budgetSnapshot?.daysRemainingInPeriod ?? ''),
      prior_month_note: context.priorMonthNote ?? '',
      // Pre-computed verdict — the model only narrates these.
      has_budget: String(hasBudget),
      budget_total: hasBudget ? String(snap!.totalBudget) : '',
      budget_spent: hasBudget ? String(context.totals.expenses) : '',
      budget_remaining: hasBudget ? String(remainingBudget) : '',
      budget_percent_used: hasBudget ? String(percentUsed) : '',
      over_budget: String(overBudget),
      budget_status: budgetStatus,
      has_data: String(hasData),
    });
    const systemPrompt = renderTemplate(step.systemPrompt, {
      language: languageDirectiveName(language),
    });

    let raw: unknown = null;
    let toolCalls: AnalysisToolCallRecord[] = [];
    let tokensOut = 0;

    try {
      const loop = await runToolLoop(this.aiGateway, {
        systemPrompt,
        userPrompt,
        tools: createMonthlyAnalysisTools(),
        scope: { userId: context.userId },
        temperature: step.temperature,
        maxTokens: step.maxTokens,
        heartbeat: options?.heartbeat,
      });
      toolCalls = loop.toolCalls;
      tokensOut = loop.tokensUsed;
      if (loop.content.trim()) {
        try {
          raw = parseJsonContent(loop.content);
        } catch {
          raw = null; // prose instead of JSON — retry below without tools
        }
      }
      // Valid JSON but not the expected shape (e.g. leaked reasoning object)
      // is as useless as prose — retry below without tools.
      if (raw !== null && typeof (raw as any)?.note !== 'string') {
        raw = null;
      }
    } catch (err) {
      if (!(err instanceof ToolsUnsupportedError)) throw err;
    }

    // Single-shot fallback: the model has no tool support, the tool loop
    // produced no visible answer (reasoning models can spend the whole token
    // budget on hidden reasoning when tools inflate the conversation), or the
    // answer was not JSON.
    if (raw === null) {
      toolCalls = [];
      const result = await this.aiGateway.extractStructuredData({
        systemPrompt,
        userPrompt,
        temperature: step.temperature,
        maxTokens: step.maxTokens,
        responseFormat: 'json',
      });
      raw = result.data ?? {};
      tokensOut = result.tokensUsed ?? 0;
    }

    const data = (raw ?? {}) as Record<string, unknown>;
    const rawNote = typeof data.note === 'string' ? data.note.trim() : '';
    if (!rawNote) {
      throw new Error('analyze_month produced empty payload');
    }
    const note = truncateNote(rawNote);

    return {
      note,
      modelMeta: {
        model: this.aiGateway.getModelName(),
        promptVersion: step.version,
        tokensIn: 0,
        tokensOut,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    };
  }
}
