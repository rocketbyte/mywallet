import { Request, Response } from 'express';
import { Connection } from 'mongoose';
import { createEmailActivities } from '../../../temporal-workflows/src/activities/database/email.activities';
import { getDataOwnerId } from '../auth';
import { logger } from '../utils/logger';

export class EmailController {
  private emailActivities: ReturnType<typeof createEmailActivities>;

  constructor(mongoConnection: Connection) {
    this.emailActivities = createEmailActivities(mongoConnection);
  }

  async getAllEmails(req: Request, res: Response) {
    try {
      const userId = getDataOwnerId(req);

      const {
        limit = '50',
        offset = '0',
        isProcessed,
        fromAddress,
        startDate,
        endDate
      } = req.query;

      const queryInput = {
        userId,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        isProcessed: isProcessed === 'true' ? true : isProcessed === 'false' ? false : undefined,
        fromAddress: fromAddress as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      };

      const result = await this.emailActivities.queryEmails(queryInput);

      res.json({
        userId,
        emails: result.emails,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.limit < result.total
        }
      });

    } catch (error) {
      logger.error('Failed to get emails', { error });
      res.status(500).json({
        error: 'Failed to fetch emails',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async getEmailById(req: Request, res: Response) {
    try {
      const userId = getDataOwnerId(req);

      const { id } = req.params;

      const email = await this.emailActivities.getEmailById(userId, id);

      if (!email) {
        return res.status(404).json({
          error: 'Email not found',
          message: `No email found with ID: ${id}`
        });
      }

      res.json({ userId, email });

    } catch (error) {
      logger.error('Failed to get email by ID', { error });
      res.status(500).json({
        error: 'Failed to fetch email',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async searchEmails(req: Request, res: Response) {
    try {
      const userId = getDataOwnerId(req);

      const {
        q: searchTerm,
        limit = '50',
        offset = '0'
      } = req.query;

      if (!searchTerm || typeof searchTerm !== 'string') {
        return res.status(400).json({
          error: 'Search term is required',
          message: 'Please provide a search term using the "q" query parameter'
        });
      }

      const result = await this.emailActivities.queryEmails({
        userId,
        searchTerm,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });

      res.json({
        userId,
        emails: result.emails,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.limit < result.total
        },
        searchTerm
      });

    } catch (error) {
      logger.error('Failed to search emails', { error });
      res.status(500).json({
        error: 'Failed to search emails',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

}
