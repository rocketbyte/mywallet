import { Request, Response } from 'express';
import { PendingService } from '../services/pending.service';
import { getUserId } from '../utils/request.utils';
import { logger } from '../utils/logger';

export class PendingController {
  private service = new PendingService();

  async getPending(req: Request, res: Response) {
    try {
      const pending = await this.service.list(getUserId(req));
      res.json({ pending });
    } catch (error) {
      logger.error('Failed to get pending transactions', { error });
      res.status(500).json({ error: 'Failed to fetch pending transactions' });
    }
  }

  async createPending(req: Request, res: Response) {
    const { merchant, amount, category, confidence, source } = req.body;
    if (!merchant || amount === undefined || !category || confidence === undefined || !source) {
      return res.status(400).json({ error: 'merchant, amount, category, confidence, and source are required' });
    }
    try {
      const pending = await this.service.create(getUserId(req), req.body);
      res.status(201).json({ pending });
    } catch (error) {
      logger.error('Failed to create pending transaction', { error });
      res.status(500).json({ error: 'Failed to create pending transaction' });
    }
  }

  async approvePending(req: Request, res: Response) {
    try {
      const transaction = await this.service.approve(getUserId(req), req.params.id);
      if (!transaction) return res.status(404).json({ error: 'Pending transaction not found' });
      res.status(201).json({ transaction });
    } catch (error) {
      logger.error('Failed to approve pending transaction', { error });
      res.status(500).json({ error: 'Failed to approve pending transaction' });
    }
  }

  async rejectPending(req: Request, res: Response) {
    try {
      const deleted = await this.service.reject(getUserId(req), req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Pending transaction not found' });
      res.json({ message: 'Pending transaction rejected' });
    } catch (error) {
      logger.error('Failed to reject pending transaction', { error });
      res.status(500).json({ error: 'Failed to reject pending transaction' });
    }
  }
}
