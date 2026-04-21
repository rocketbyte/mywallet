import { Request, Response } from 'express';
import { AlertService } from '../services/alert.service';
import { getUserId } from '../utils/request.utils';
import { logger } from '../utils/logger';

export class AlertController {
  private service = new AlertService();

  async getAlerts(req: Request, res: Response) {
    try {
      const alerts = await this.service.list(getUserId(req));
      res.json({ alerts });
    } catch (error) {
      logger.error('Failed to get alerts', { error });
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  }

  async createAlert(req: Request, res: Response) {
    const { kind, title, body } = req.body;
    if (!kind || !title || !body) {
      return res.status(400).json({ error: 'kind, title, and body are required' });
    }
    try {
      const alert = await this.service.create(getUserId(req), { kind, title, body });
      res.status(201).json({ alert });
    } catch (error) {
      logger.error('Failed to create alert', { error });
      res.status(500).json({ error: 'Failed to create alert' });
    }
  }

  async markAlertRead(req: Request, res: Response) {
    try {
      const alert = await this.service.markRead(getUserId(req), req.params.id);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });
      res.json({ alert });
    } catch (error) {
      logger.error('Failed to mark alert read', { error });
      res.status(500).json({ error: 'Failed to update alert' });
    }
  }

  async deleteAlert(req: Request, res: Response) {
    try {
      const deleted = await this.service.delete(getUserId(req), req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Alert not found' });
      res.json({ message: 'Alert deleted' });
    } catch (error) {
      logger.error('Failed to delete alert', { error });
      res.status(500).json({ error: 'Failed to delete alert' });
    }
  }
}
