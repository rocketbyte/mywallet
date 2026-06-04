import { Request, Response } from 'express';
import { getDataOwnerId, getUserId } from '../auth';
import {
  AuthState,
  EmailProviderRegistry,
  UnsupportedProviderError,
  type EmailProviderInterface,
} from '../providers';
import { Tenant, User } from '../../../temporal-workflows/src/models';
import { logger } from '../utils/logger';
import {
  renderAutoLinkedPage,
  renderCallbackErrorPage,
  renderErrorPage,
  renderManualTokenPage,
} from './auth.views';
import { EMAIL_REGEX, type ConnectInput, type MeDTO } from '../types/auth.types';
import { BadRequestError } from '../types/errors';

export class AuthController {
  constructor(private readonly registry: EmailProviderRegistry) {}

  async getMe(req: Request, res: Response): Promise<void> {
    try {
      const id = getUserId(req);
      const doc = await User.findById(id).lean();
      if (!doc) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const tenant = doc.tenantId ? await Tenant.findById(doc.tenantId).lean() : null;
      const isPrimary = !!tenant && String(tenant.primaryUserId) === String(doc._id);
      const role: MeDTO['role'] = isPrimary ? 'admin' : 'guest';

      const me: MeDTO = {
        id: String(doc._id),
        email: doc.email,
        displayName: doc.displayName,
        emailVerified: doc.emailVerified ?? false,
        provider: req.user!.provider,
        identities: (doc.identities ?? []).map((i) => ({
          provider: i.provider,
          subject: i.subject,
          linkedAt: i.linkedAt,
        })),
        lastLoginAt: doc.lastLoginAt,
        createdAt: doc.createdAt,
        tenantId: tenant ? String(tenant._id) : undefined,
        role,
      };
      res.json({ user: me });
    } catch (error) {
      logger.error('Failed to get current user', { error });
      res.status(500).json({ error: 'Failed to fetch current user' });
    }
  }

  connect(req: Request, res: Response): void {
    try {
      // Tenant members link Gmail to the primary user so the resulting
      // emails/transactions are visible to everyone in the tenant.
      const userId = getDataOwnerId(req);
      const { email, provider: providerType } = this.parseConnectInput(req.body);
      const provider = this.registry.get(providerType);

      const authUrl = provider.getAuthUrl({ userId, email });

      logger.info('Generated OAuth URL', { provider: provider.type, userId, email });
      res.status(200).json({ authUrl, provider: provider.type, email });
    } catch (error) {
      this.respondWithError(res, error, 'Failed to generate authorization URL');
    }
  }

  async handleCallback(req: Request, res: Response): Promise<void> {
    const providerType = req.params.provider;
    let provider: EmailProviderInterface;
    try {
      provider = this.registry.get(providerType);
    } catch (err) {
      logger.warn('Callback for unknown provider', { providerType });
      res.status(400).send(renderErrorPage((err as Error).message));
      return;
    }

    const { code, error, state } = req.query;
    if (error) {
      logger.error('OAuth authorization failed', { error });
      res.status(400).send(renderErrorPage(String(error)));
      return;
    }
    if (typeof code !== 'string' || !code) {
      res.status(400).send(renderErrorPage('No authorization code provided.'));
      return;
    }

    const decodedState = this.decodeState(state);

    try {
      const { email, refreshToken } = await provider.exchangeCode(code);

      logger.info('OAuth code exchanged successfully', {
        provider: provider.type,
        email,
        autoLink: !!decodedState?.userId,
      });

      if (decodedState?.userId) {
        if (decodedState.email && decodedState.email.toLowerCase() !== email.toLowerCase()) {
          logger.warn('OAuth email mismatch — authorized account differs from requested', {
            requested: decodedState.email,
            authorized: email,
          });
        }
        await this.autoLink(provider, decodedState.userId, email, refreshToken, res);
        return;
      }

      res.send(renderManualTokenPage(provider.type, email, refreshToken));
    } catch (err) {
      logger.error('OAuth callback failed', { err });
      res.status(500).send(renderCallbackErrorPage((err as Error).message));
    }
  }

  private parseConnectInput(body: unknown): ConnectInput {
    const input = (body ?? {}) as Partial<ConnectInput>;
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const provider = typeof input.provider === 'string' ? input.provider.trim().toLowerCase() : '';

    if (!email) throw new BadRequestError('email is required');
    if (!EMAIL_REGEX.test(email)) throw new BadRequestError('email is not a valid email address');
    if (!provider) throw new BadRequestError('provider is required');

    return { email, provider };
  }

  private decodeState(raw: unknown): AuthState | null {
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) as AuthState;
    } catch {
      logger.warn('Could not decode OAuth state', { raw });
      return null;
    }
  }

  private async autoLink(
    provider: EmailProviderInterface,
    userId: string,
    email: string,
    refreshToken: string,
    res: Response,
  ): Promise<void> {
    try {
      const result = await provider.linkAccount({ userId, email, refreshToken });
      logger.info('Account auto-linked after OAuth', { userId, workflowId: result.workflowId });
      res.send(renderAutoLinkedPage(provider.type, email, userId, result.workflowId));
    } catch (linkErr) {
      logger.error('Auto-link failed after OAuth', { userId, error: linkErr });
      // Fall back to manual page so the user still has their token.
      res.send(renderManualTokenPage(provider.type, email, refreshToken, userId, (linkErr as Error).message));
    }
  }

  private respondWithError(res: Response, error: unknown, fallbackMessage: string): void {
    if (error instanceof BadRequestError) {
      res.status(400).json({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof UnsupportedProviderError) {
      res.status(400).json({ error: error.code, message: error.message, supported: this.registry.supported() });
      return;
    }
    logger.error(fallbackMessage, { error });
    res.status(500).json({ error: 'internal_error', message: (error as Error).message });
  }
}
