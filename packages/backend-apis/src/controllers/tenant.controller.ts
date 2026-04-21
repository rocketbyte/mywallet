import { Request, Response } from 'express';
import { TenantService } from '../services/tenant.service';
import { getUserId } from '../utils/request.utils';
import { logger } from '../utils/logger';

export class TenantController {
  private service = new TenantService();

  async getTenant(req: Request, res: Response) {
    try {
      const tenant = await this.service.get(getUserId(req));
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      res.json({ tenant });
    } catch (error) {
      logger.error('Failed to get tenant', { error });
      res.status(500).json({ error: 'Failed to fetch tenant' });
    }
  }

  async upsertTenant(req: Request, res: Response) {
    if (!req.body.email) {
      return res.status(400).json({ error: 'email is required' });
    }
    try {
      const tenant = await this.service.upsert(getUserId(req), req.body);
      res.status(201).json({ tenant });
    } catch (error) {
      logger.error('Failed to upsert tenant', { error });
      res.status(500).json({ error: 'Failed to save tenant' });
    }
  }

  async updateTenant(req: Request, res: Response) {
    try {
      const tenant = await this.service.update(getUserId(req), req.body);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      res.json({ tenant });
    } catch (error) {
      logger.error('Failed to update tenant', { error });
      res.status(500).json({ error: 'Failed to update tenant' });
    }
  }
}
