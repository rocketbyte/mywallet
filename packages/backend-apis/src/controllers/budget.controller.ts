import { Request, Response } from 'express';
import { BudgetService } from '../services/budget.service';
import { getDataOwnerId, isBudgetHidden } from '../auth';
import { maskBudgetForMember } from '../utils/budget-visibility';
import { logger } from '../utils/logger';

export class BudgetController {
  private service = new BudgetService();

  async getCurrentBudget(req: Request, res: Response) {
    try {
      const budget = await this.service.getCurrent(getDataOwnerId(req));
      const masked = budget && isBudgetHidden(req) ? maskBudgetForMember(budget) : budget;
      res.json({ budget: masked });
    } catch (error) {
      logger.error('Failed to get current budget', { error });
      res.status(500).json({ error: 'Failed to fetch budget' });
    }
  }

  async upsertBudget(req: Request, res: Response) {
    const { year, month, periodStart, limitAmount, categories } = req.body;
    const hasMonth = (year && month) || periodStart;
    const hasAmounts = limitAmount !== undefined || (Array.isArray(categories) && categories.length > 0);
    if (!hasMonth || !hasAmounts) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Provide year+month (or periodStart) and either limitAmount or categories',
      });
    }
    try {
      const budget = await this.service.upsert(getDataOwnerId(req), req.body);
      res.status(201).json({ budget });
    } catch (error) {
      logger.error('Failed to upsert budget', { error });
      res.status(500).json({ error: 'Failed to save budget', detail: String(error) });
    }
  }

  async updateBudget(req: Request, res: Response) {
    try {
      const budget = await this.service.update(getDataOwnerId(req), req.params.id, req.body);
      if (!budget) return res.status(404).json({ error: 'Budget not found' });
      res.json({ budget });
    } catch (error) {
      logger.error('Failed to update budget', { error });
      res.status(500).json({ error: 'Failed to update budget' });
    }
  }
}
