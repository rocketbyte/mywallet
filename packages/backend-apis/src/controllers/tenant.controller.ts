import { Request, Response } from 'express';
import { TenantService } from '../services/tenant.service';
import { getUserId } from '../auth';
import { logger } from '../utils/logger';
import {
  CannotRemovePrimaryError,
  MemberNotFoundError,
  NotPrimaryUserError,
} from '../types/errors';

export class TenantController {
  private service = new TenantService();

  async getTenant(req: Request, res: Response) {
    try {
      const tenant = await this.service.getForUser(getUserId(req));
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      res.json({ tenant });
    } catch (error) {
      logger.error('Failed to get tenant', { error });
      res.status(500).json({ error: 'Failed to fetch tenant' });
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

  async listMembers(req: Request, res: Response) {
    try {
      const members = await this.service.listMembersForUser(getUserId(req));
      res.json({ members });
    } catch (error) {
      logger.error('Failed to list tenant members', { error });
      res.status(500).json({ error: 'Failed to list members' });
    }
  }

  async addMember(req: Request, res: Response) {
    const { email } = req.body ?? {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    try {
      const member = await this.service.addMember(getUserId(req), { email });
      res.status(201).json({ member });
    } catch (error) {
      if (error instanceof NotPrimaryUserError) {
        return res.status(403).json({ error: error.code, message: error.message });
      }
      if (error instanceof MemberNotFoundError) {
        return res.status(404).json({ error: error.code, message: error.message });
      }
      logger.error('Failed to add tenant member', { error });
      res.status(500).json({ error: 'Failed to add member' });
    }
  }

  async removeMember(req: Request, res: Response) {
    try {
      await this.service.removeMember(getUserId(req), req.params.userId);
      res.json({ status: 'removed' });
    } catch (error) {
      if (error instanceof NotPrimaryUserError) {
        return res.status(403).json({ error: error.code, message: error.message });
      }
      if (error instanceof CannotRemovePrimaryError) {
        return res.status(400).json({ error: error.code, message: error.message });
      }
      if (error instanceof MemberNotFoundError) {
        return res.status(404).json({ error: error.code, message: error.message });
      }
      logger.error('Failed to remove tenant member', { error });
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }
}
