/**
 * Financial Analyzer Interfaces (Layer 2 - Application)
 *
 * The analyzer strategy contract behind the daily/monthly analysis activities.
 * Each analysis kind is one interchangeable implementation resolved by kind
 * from the FinancialAnalyzerRegistry — adding a new kind (weekly, quarterly,
 * category deep-dive) never touches workflow orchestration or other analyzers.
 */
import { ToolDefinition } from '../gateways/ai-gateway.interface';

export type AnalyzerKind = 'daily' | 'monthly' | string;

/**
 * One executed tool call, recorded on the persisted row's modelMeta for
 * observability and prompt debugging.
 */
export interface AnalysisToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ms: number;
}

/**
 * Scope injected server-side into every tool execution. Tool arguments coming
 * from the model can never select the tenant — handlers MUST read the tenant
 * from this scope only.
 */
export interface AnalysisToolScope {
  userId: string;
}

/** One read-only, tenant-scoped tool the model may call during analysis. */
export interface AnalysisToolInterface {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, scope: AnalysisToolScope): Promise<unknown>;
}

/**
 * Hooks the owning Temporal activity passes down so the analyzer stays free
 * of Temporal APIs: the activity owns heartbeats/timeouts, the analyzer owns
 * prompting, the tool loop, and output validation.
 */
export interface AnalyzerRunOptions {
  heartbeat?: () => void;
}

export interface FinancialAnalyzerInterface<TContext, TResult> {
  readonly kind: AnalyzerKind;
  analyze(context: TContext, options?: AnalyzerRunOptions): Promise<TResult>;
}

/**
 * Keyed registry of analyzer strategies. Registered once in the DI container;
 * activities resolve their analyzer by kind.
 */
export class FinancialAnalyzerRegistry {
  private readonly analyzers = new Map<AnalyzerKind, FinancialAnalyzerInterface<any, any>>();

  register(analyzer: FinancialAnalyzerInterface<any, any>): void {
    if (this.analyzers.has(analyzer.kind)) {
      throw new Error(`Analyzer already registered for kind: ${analyzer.kind}`);
    }
    this.analyzers.set(analyzer.kind, analyzer);
  }

  get<TContext, TResult>(kind: AnalyzerKind): FinancialAnalyzerInterface<TContext, TResult> {
    const analyzer = this.analyzers.get(kind);
    if (!analyzer) {
      throw new Error(`No analyzer registered for kind: ${kind}`);
    }
    return analyzer;
  }

  kinds(): AnalyzerKind[] {
    return [...this.analyzers.keys()];
  }
}
