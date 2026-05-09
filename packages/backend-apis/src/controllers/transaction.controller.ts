import { Request, Response } from 'express';
import { TransactionService } from '../services/transaction.service';
import { getDataOwnerId } from '../auth';
import { parsePagination } from '../utils/request.utils';
import { logger } from '../utils/logger';

export class TransactionController {
  private service = new TransactionService();

  async getTransactions(req: Request, res: Response) {
    try {
      const result = await this.service.list(getDataOwnerId(req), {
        ...parsePagination(req.query),
        category: req.query.category as string,
        search: req.query.search as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      });
      res.json(result);
    } catch (error) {
      logger.error('Failed to get transactions', { error });
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  }

  async createTransaction(req: Request, res: Response) {
    const { merchant, amount, category, date } = req.body;
    if (!merchant || amount === undefined || !category || !date) {
      return res.status(400).json({ error: 'merchant, amount, category, and date are required' });
    }
    try {
      const transaction = await this.service.create(getDataOwnerId(req), req.body);
      res.status(201).json({ transaction });
    } catch (error) {
      logger.error('Failed to create transaction', { error });
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  }

  async getTransactionById(req: Request, res: Response) {
    try {
      const transaction = await this.service.getById(getDataOwnerId(req), req.params.id);
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
      res.json({ transaction });
    } catch (error) {
      logger.error('Failed to get transaction', { error });
      res.status(500).json({ error: 'Failed to fetch transaction' });
    }
  }

  async updateTransaction(req: Request, res: Response) {
    try {
      const transaction = await this.service.update(getDataOwnerId(req), req.params.id, req.body);
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
      res.json({ transaction });
    } catch (error) {
      logger.error('Failed to update transaction', { error });
      res.status(500).json({ error: 'Failed to update transaction' });
    }
  }

  async deleteTransaction(req: Request, res: Response) {
    try {
      const deleted = await this.service.delete(getDataOwnerId(req), req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Transaction not found' });
      res.json({ message: 'Transaction deleted' });
    } catch (error) {
      logger.error('Failed to delete transaction', { error });
      res.status(500).json({ error: 'Failed to delete transaction' });
    }
  }
}
