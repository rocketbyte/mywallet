import { Request, Response } from 'express';
import { TransactionService } from '../services/transaction.service';
import { getDataOwnerId } from '../auth';
import { parsePagination } from '../utils/request.utils';
import { logger } from '../utils/logger';
import {
  isTransactionCategoryKey,
  isTransactionType,
  isTransactionSource,
  TRANSACTION_SOURCES,
} from '../../../temporal-workflows/src/shared/categories';

/**
 * Validates the category/transactionType/source fields of a write payload.
 * Returns an error message when a supplied value is invalid, or `null` when the
 * payload is acceptable. Absent fields are allowed (partial updates); `source`
 * defaults to `manual` in the service when omitted on create.
 */
function validateWritePayload(body: any): string | null {
  if (body.category !== undefined && !isTransactionCategoryKey(body.category)) {
    return 'category must be one of the supported category keys';
  }
  if (body.transactionType !== undefined && !isTransactionType(body.transactionType)) {
    return "transactionType must be 'debit' or 'credit'";
  }
  if (body.source !== undefined && !isTransactionSource(body.source)) {
    return `source must be one of: ${TRANSACTION_SOURCES.join(', ')}`;
  }
  return null;
}

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

  async getCategories(_req: Request, res: Response) {
    res.json({ categories: this.service.listCategories() });
  }

  async createTransaction(req: Request, res: Response) {
    const { merchant, amount, category, transactionDate } = req.body;
    if (!merchant || amount === undefined || !category || !transactionDate) {
      return res.status(400).json({ error: 'merchant, amount, category, and transactionDate are required' });
    }
    const validationError = validateWritePayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
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
    const validationError = validateWritePayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
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

  async getBalance(req: Request, res: Response) {
    try {
      const balance = await this.service.getBalance(getDataOwnerId(req), {
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      });
      res.json(balance);
    } catch (error) {
      logger.error('Failed to compute balance', { error });
      res.status(500).json({ error: 'Failed to compute balance' });
    }
  }
}
