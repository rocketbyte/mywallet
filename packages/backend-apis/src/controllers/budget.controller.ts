import { Request, Response } from 'express';
import { BudgetService } from '../services/budget.service';
import { getUserId } from '../auth';
import { logger } from '../utils/logger';

export class BudgetController {
  private service = new BudgetService();

  async getCurrentBudget(req: Request, res: Response) {
    try {
      const budget = await this.service.getCurrent(getUserId(req));
      res.json({ budget });
    } catch (error) {
      logger.error('Failed to get current budget', { error });
      res.status(500).json({ error: 'Failed to fetch budget' });
    }
  }

  async upsertBudget(req: Request, res: Response) {
    const { period_start, limit_amount } = req.body;
    if (!period_start || limit_amount === undefined) {
      return res.status(400).json({ error: 'period_start and limit_amount are required' });
    }
    try {
      const budget = await this.service.upsert(getUserId(req), req.body);
      res.status(201).json({ budget });
    } catch (error) {
      logger.error('Failed to upsert budget', { error });
      res.status(500).json({ error: 'Failed to save budget', detail: String(error) });
    }
  }

  async updateBudget(req: Request, res: Response) {
    try {
      const budget = await this.service.update(getUserId(req), req.params.id, req.body);
      if (!budget) return res.status(404).json({ error: 'Budget not found' });
      res.json({ budget });
    } catch (error) {
      logger.error('Failed to update budget', { error });
      res.status(500).json({ error: 'Failed to update budget' });
    }
  }
}
