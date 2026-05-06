import { Request, Response } from 'express';
import { User } from '../../../temporal-workflows/src/models';
import { getUserId } from '../auth';
import { logger } from '../utils/logger';

export interface MeDTO {
  id: string;
  email: string;
  display_name?: string;
  email_verified: boolean;
  provider: string;
  identities: { provider: string; subject: string; linked_at?: Date }[];
  last_login_at?: Date;
  created_at: Date;
}

export class MeController {
  async getMe(req: Request, res: Response) {
    try {
      const id = getUserId(req);
      const doc = await User.findById(id).lean();
      if (!doc) return res.status(404).json({ error: 'User not found' });

      const me: MeDTO = {
        id: String(doc._id),
        email: doc.email,
        display_name: doc.displayName,
        email_verified: doc.emailVerified ?? false,
        provider: req.user!.provider,
        identities: (doc.identities ?? []).map((i) => ({
          provider: i.provider,
          subject: i.subject,
          linked_at: i.linkedAt,
        })),
        last_login_at: doc.lastLoginAt,
        created_at: doc.createdAt,
      };
      res.json({ user: me });
    } catch (error) {
      logger.error('Failed to get current user', { error });
      res.status(500).json({ error: 'Failed to fetch current user' });
    }
  }
}
