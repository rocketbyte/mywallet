import { Request, Response } from 'express';
import { SenderService, CallerSenderSource } from '../services/sender.service';
import { getDataOwnerId } from '../auth';
import { logger } from '../utils/logger';

const CALLER_SOURCES: ReadonlyArray<CallerSenderSource> = ['manual', 'onboarding'];

export class SenderController {
  private service = new SenderService();

  async getSenders(req: Request, res: Response) {
    try {
      const senders = await this.service.list(getDataOwnerId(req));
      res.json({ senders });
    } catch (error) {
      logger.error('Failed to list watched senders', { error });
      res.status(500).json({ error: 'Failed to fetch watched senders' });
    }
  }

  async addSender(req: Request, res: Response) {
    const { value, source } = req.body ?? {};
    if (typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'value is required' });
    }
    if (source !== undefined && !CALLER_SOURCES.includes(source)) {
      return res.status(400).json({ error: "source must be 'manual' or 'onboarding'" });
    }
    try {
      const sender = await this.service.add(getDataOwnerId(req), value, source);
      if (!sender) {
        return res.status(400).json({ error: 'value must be an email address or a domain' });
      }
      res.status(201).json({ sender });
    } catch (error) {
      logger.error('Failed to add watched sender', { error });
      res.status(500).json({ error: 'Failed to add watched sender' });
    }
  }

  async removeSender(req: Request, res: Response) {
    try {
      const removed = await this.service.remove(getDataOwnerId(req), req.params.id);
      if (!removed) return res.status(404).json({ error: 'Watched sender not found' });
      res.json({ message: 'Watched sender removed' });
    } catch (error) {
      logger.error('Failed to remove watched sender', { error });
      res.status(500).json({ error: 'Failed to remove watched sender' });
    }
  }
}
