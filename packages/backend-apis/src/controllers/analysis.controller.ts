import { Request, Response } from 'express';
import { AnalysisService } from '../services/analysis.service';
import { ensureDailyAnalysisScheduleDetached } from '../services/analysis-schedule.service';
import { getDataOwnerId, getUserId } from '../auth';
import { logger } from '../utils/logger';

function parseAnalysisPagination(query: Record<string, any>): { limit: number; offset: number } {
  return {
    limit: Math.min(parseInt(query.limit as string) || 30, 100),
    offset: Math.max(parseInt(query.offset as string) || 0, 0),
  };
}

const service = new AnalysisService();

// Until a roles model exists, "owner" is the user who is their own data owner
// (i.e. the tenant's primary user). Members of a tenant can read analyses
// but cannot trigger reruns.
function isOwner(req: Request): boolean {
  return getUserId(req) === getDataOwnerId(req);
}

export class AnalysisController {
  async list(req: Request, res: Response) {
    try {
      const { limit, offset } = parseAnalysisPagination(req.query);
      const result = await service.list(getDataOwnerId(req), {
        limit,
        offset,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      res.json(result);
    } catch (err) {
      logger.error('Failed to list analyses', { err });
      res.status(500).json({ error: 'Failed to list analyses' });
    }
  }

  async getLatest(req: Request, res: Response) {
    try {
      const userId = getDataOwnerId(req);
      const analysis = await service.getLatest(userId);
      // Lazy schedule registration: first time a tenant opens insights, make
      // sure their nightly Schedule exists. Fire-and-forget — idempotent and
      // never blocks the response.
      ensureDailyAnalysisScheduleDetached(userId);
      if (!analysis) return res.status(204).end();
      res.json({ analysis });
    } catch (err) {
      logger.error('Failed to get latest analysis', { err });
      res.status(500).json({ error: 'Failed to get latest analysis' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const analysis = await service.getById(getDataOwnerId(req), req.params.id);
      if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
      res.json({ analysis });
    } catch (err) {
      logger.error('Failed to get analysis', { err });
      res.status(500).json({ error: 'Failed to get analysis' });
    }
  }

  async runNow(req: Request, res: Response) {
    if (!isOwner(req)) {
      return res.status(403).json({ error: 'Only the tenant owner can trigger an analysis run' });
    }
    try {
      const userId = getDataOwnerId(req);
      const result = await service.runNow(userId, req.body?.analysisDate);
      ensureDailyAnalysisScheduleDetached(userId);
      res.status(202).json(result);
    } catch (err: any) {
      logger.error('Failed to start analysis workflow', { err });
      res.status(500).json({ error: err?.message ?? 'Failed to start analysis workflow' });
    }
  }
}
