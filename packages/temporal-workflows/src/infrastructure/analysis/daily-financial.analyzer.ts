/**
 * Daily Financial Analyzer (Layer 3 — Interface Adapters)
 *
 * Strategy behind the `analyzeDailyContext` activity: renders the analyze_day
 * prompt (with the tenant's language directive), runs the bounded tool loop so
 * the model can drill into merchant history / prior summaries / budget, and
 * validates the structured report. Falls back to the single-shot
 * extractStructuredData path when the active model rejects tools, so the
 * provider fallback chain keeps working.
 */
import { randomUUID } from 'node:crypto';

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
import { DailyAnalysisAIResult, DailyAnalysisContext } from '../../shared/types';
import { PIPELINE_STEP_KEYS } from '../../shared/constants';
import {
  emptyDayFullSummary,
  emptyDaySummary,
  languageDirectiveName,
  resolveAnalysisLanguage,
} from '../../shared/analysis-i18n';
import { createDailyAnalysisTools } from './tools/daily.tools';
import { renderTemplate } from './render-template';

export class DailyFinancialAnalyzer
  implements FinancialAnalyzerInterface<DailyAnalysisContext, DailyAnalysisAIResult>
{
  readonly kind = 'daily';

  constructor(
    private readonly aiGateway: AIGatewayInterface,
    private readonly pipelineStepRepo: PipelineStepRepositoryInterface
  ) {}

  async analyze(
    context: DailyAnalysisContext,
    options?: AnalyzerRunOptions
  ): Promise<DailyAnalysisAIResult> {
    const language = resolveAnalysisLanguage(context.language);

    // Token discipline: a day with no transactions has nothing for the model
    // to reason about — return the localized deterministic result, no AI call.
    if (context.transactions.length === 0) {
      return {
        summary: emptyDaySummary(language),
        fullSummary: emptyDayFullSummary(language, context.analysisDate),
        suggestions: [],
        modelMeta: { model: 'none', promptVersion: 0, tokensIn: 0, tokensOut: 0 },
      };
    }

    const step = await this.pipelineStepRepo.getActiveStep(PIPELINE_STEP_KEYS.ANALYZE_DAY);

    const userPrompt = renderTemplate(step.userPromptTemplate, {
      today: new Date().toISOString().slice(0, 10),
      analysis_date: context.analysisDate,
      currency: context.currency,
      language: languageDirectiveName(language),
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
        tools: createDailyAnalysisTools(),
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
      if (raw !== null) {
        const d = raw as any;
        const usable = typeof d?.summary === 'string' || typeof d?.fullSummary === 'string' || Array.isArray(d?.suggestions);
        if (!usable) raw = null;
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

    const data = raw as Partial<DailyAnalysisAIResult>;
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
        model: this.aiGateway.getModelName(),
        promptVersion: step.version,
        tokensIn: 0,
        tokensOut,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    };
  }
}
