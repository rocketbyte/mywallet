import { TransactionAnalysis } from '../../../temporal-workflows/src/models';
import { getTemporalClient } from '../config/temporal-client';
import { TASK_QUEUES } from '../../../temporal-workflows/src/shared/constants';

export interface AnalysisListFilters {
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface AnalysisDTO {
  id: string;
  userId: string;
  analysisDate: string;
  currency: string;
  inputs: any;
  summary: string;
  fullSummary: string;
  suggestions: any[];
  modelMeta: any;
  status: 'ready' | 'failed';
  failureReason?: string;
  generatedAt: string;
}

function toDTO(doc: any): AnalysisDTO {
  return {
    id: String(doc._id),
    userId: doc.userId,
    analysisDate: new Date(doc.analysisDate).toISOString().slice(0, 10),
    currency: doc.currency,
    inputs: doc.inputs,
    summary: doc.summary ?? '',
    fullSummary: doc.fullSummary ?? '',
    suggestions: doc.suggestions ?? [],
    modelMeta: doc.modelMeta,
    status: doc.status,
    failureReason: doc.failureReason,
    generatedAt: new Date(doc.generatedAt).toISOString(),
  };
}

function yesterdayISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export class AnalysisService {
  async list(userId: string, filters: AnalysisListFilters) {
    const query: Record<string, any> = { userId };

    if (filters.from || filters.to) {
      query.analysisDate = {};
      if (filters.from) query.analysisDate.$gte = new Date(`${filters.from}T00:00:00.000Z`);
      if (filters.to) query.analysisDate.$lte = new Date(`${filters.to}T23:59:59.999Z`);
    }

    const [docs, total] = await Promise.all([
      TransactionAnalysis.find(query)
        .sort({ analysisDate: -1 })
        .skip(filters.offset)
        .limit(filters.limit)
        .lean(),
      TransactionAnalysis.countDocuments(query),
    ]);

    return {
      analyses: docs.map(toDTO),
      pagination: { total, limit: filters.limit, offset: filters.offset },
    };
  }

  async getLatest(userId: string): Promise<AnalysisDTO | null> {
    const doc = await TransactionAnalysis.findOne({ userId }).sort({ analysisDate: -1 }).lean();
    return doc ? toDTO(doc) : null;
  }

  async getById(userId: string, id: string): Promise<AnalysisDTO | null> {
    const doc = await TransactionAnalysis.findOne({ _id: id, userId }).lean();
    return doc ? toDTO(doc) : null;
  }

  async runNow(userId: string, analysisDate?: string): Promise<{ workflowId: string; runId: string }> {
    const date = analysisDate ?? yesterdayISO();
    const client = await getTemporalClient();
    const workflowId = `daily-analysis-wf-${userId}-${date}-${Date.now()}`;
    const handle = await client.workflow.start('dailyTransactionAnalysisWorkflow', {
      taskQueue: TASK_QUEUES.PIPELINE,
      workflowId,
      args: [{ userId, analysisDate: date }],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  }
}
