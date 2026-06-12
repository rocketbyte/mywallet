import type { Request, Response, NextFunction } from 'express';
import { Tenant, TenantMembership } from '../../../temporal-workflows/src/models';
import { logger } from '../utils/logger';

export const WALLET_HEADER = 'x-wallet-id';

export type WalletRole = 'owner' | 'member';

declare module 'express-serve-static-core' {
  interface Request {
    /** Role of the caller within the acting wallet for this request. */
    walletRole?: WalletRole;
    /** True when the acting wallet hides budget values from members. */
    walletBudgetHidden?: boolean;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolves the acting wallet for the request from the `X-Wallet-Id` header.
 *
 * - Header absent or equal to the caller's own tenant: owner context,
 *   request proceeds untouched.
 * - Header names another tenant: requires an active TenantMembership,
 *   otherwise 404 (non-shared wallets are invisible). On success the
 *   request runs with a *cloned* req.user repointed at the acting wallet
 *   (the resolver caches AuthUser across requests — mutating it would leak
 *   member context into unrelated requests), and all mutating verbs are
 *   rejected: members are read-only.
 *
 * Mounted after requireAuth; no-ops for unauthenticated (open) paths.
 */
export async function walletContext(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return next();

  const headerValue = req.header(WALLET_HEADER)?.trim();
  if (!headerValue || headerValue === user.tenantId) {
    req.walletRole = 'owner';
    return next();
  }

  try {
    const membership = await TenantMembership.findOne({
      tenantId: headerValue,
      userId: user.id,
      status: 'active',
    }).lean();
    if (!membership) {
      return res.status(404).json({ error: 'WALLET_NOT_FOUND', message: 'Wallet not found' });
    }

    const tenant = await Tenant.findById(headerValue).lean();
    if (!tenant) {
      return res.status(404).json({ error: 'WALLET_NOT_FOUND', message: 'Wallet not found' });
    }

    if (MUTATING_METHODS.has(req.method)) {
      return res.status(403).json({
        error: 'READ_ONLY_MEMBER',
        message: 'Members have read-only access to this wallet',
      });
    }

    req.user = {
      ...user,
      tenantId: String(tenant._id),
      dataOwnerId: String(tenant.primaryUserId),
    };
    req.walletRole = 'member';
    req.walletBudgetHidden = tenant.showBudgetToMembers === false;
    return next();
  } catch (error) {
    // Malformed ids (CastError) mean the wallet can't exist for this caller.
    if ((error as { name?: string })?.name === 'CastError') {
      return res.status(404).json({ error: 'WALLET_NOT_FOUND', message: 'Wallet not found' });
    }
    logger.error('Failed to resolve wallet context', { error });
    return next(error);
  }
}

export function getWalletRole(req: Request): WalletRole {
  return req.walletRole ?? 'owner';
}

export function isMemberContext(req: Request): boolean {
  return getWalletRole(req) === 'member';
}

/** True when budget values must be masked: member context + wallet hides them. */
export function isBudgetHidden(req: Request): boolean {
  return isMemberContext(req) && req.walletBudgetHidden === true;
}
