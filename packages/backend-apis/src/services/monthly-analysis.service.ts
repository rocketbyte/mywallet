import { MonthlyAnalysis } from '../../../temporal-workflows/src/models';
import { getTemporalClient } from '../config/temporal-client';
import { TASK_QUEUES } from '../../../temporal-workflows/src/shared/constants';

export interface MonthlyAnalysisDTO {
  id: string;
  userId: string;
  year: number;
  month: number;
  currency: string;
  inputs: any;
  note: string;
  modelMeta: any;
  status: 'ready' | 'failed';
  failureReason?: string;
  generatedAt: string;
}

function toDTO(doc: any): MonthlyAnalysisDTO {
  return {
    id: String(doc._id),
    userId: doc.userId,
    year: doc.year,
    month: doc.month,
    currency: doc.currency,
    inputs: doc.inputs,
    note: doc.note ?? '',
    modelMeta: doc.modelMeta,
    status: doc.status,
    failureReason: doc.failureReason,
    generatedAt: new Date(doc.generatedAt).toISOString(),
  };
}

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export class MonthlyAnalysisService {
  async getLatest(userId: string): Promise<MonthlyAnalysisDTO | null> {
    const doc = await MonthlyAnalysis.findOne({ userId })
      .sort({ year: -1, month: -1 })
      .lean();
    return doc ? toDTO(doc) : null;
  }

  async getByMonth(userId: string, year: number, month: number): Promise<MonthlyAnalysisDTO | null> {
    const doc = await MonthlyAnalysis.findOne({ userId, year, month }).lean();
    return doc ? toDTO(doc) : null;
  }

  async runNow(
    userId: string,
    year?: number,
    month?: number
  ): Promise<{ workflowId: string; runId: string }> {
    const resolved = currentYearMonth();
    const y = year ?? resolved.year;
    const m = month ?? resolved.month;
    const client = await getTemporalClient();
    const workflowId = `monthly-note-wf-${userId}-${y}-${m}-${Date.now()}`;
    const handle = await client.workflow.start('monthlyFinancialNoteWorkflow', {
      taskQueue: TASK_QUEUES.PIPELINE,
      workflowId,
      args: [{ userId, year: y, month: m }],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  }
}
