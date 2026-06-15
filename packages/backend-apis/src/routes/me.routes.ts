import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { TenantService } from '../services/tenant.service';
import { getUserId } from '../auth';
import { logger } from '../utils/logger';
import { emailProviders } from '../providers';

const router = Router();
const controller = new AuthController(emailProviders);
const tenantService = new TenantService();

/**
 * @openapi
 * /me:
 *   get:
 *     summary: Get the authenticated user
 *     description: |
 *       Returns the canonical user record for the bearer token's identity,
 *       including all linked IDP identities. The internal `id` is stable
 *       across re-authentication and is what every other endpoint scopes
 *       data on.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Authenticated user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     email: { type: string }
 *                     displayName: { type: string, nullable: true }
 *                     emailVerified: { type: boolean }
 *                     provider:
 *                       type: string
 *                       description: IDP that issued the token for the current request.
 *                       example: firebase
 *                     identities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           provider: { type: string, example: firebase }
 *                           subject: { type: string, description: "Provider-issued user id (OIDC sub)." }
 *                           linkedAt: { type: string, format: date-time }
 *                     lastLoginAt: { type: string, format: date-time, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     tenantId:
 *                       type: string
 *                       nullable: true
 *                       description: Tenant the user currently belongs to.
 *                     role:
 *                       type: string
 *                       enum: [admin, guest]
 *                       description: '`admin` for the tenant primary, `guest` for any other member.'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.getMe.bind(controller));

/**
 * @openapi
 * /me:
 *   patch:
 *     summary: Update the authenticated user's preferences
 *     description: |
 *       Updates mutable fields on the caller's account. Currently only the UI
 *       `language` preference is editable. The value MUST be one of the
 *       supported languages (`en`, `es`); anything else is rejected with 400.
 *       Returns the full, updated user record (same shape as `GET /me`).
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language:
 *                 type: string
 *                 enum: [en, es]
 *                 description: Preferred UI language.
 *     responses:
 *       200:
 *         description: The updated user.
 *       400:
 *         $ref: '#/components/responses/BadRequestError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/', controller.updateMe.bind(controller));

/**
 * @openapi
 * /me/wallets:
 *   get:
 *     summary: List wallets the caller can act in
 *     description: |
 *       Returns every wallet available to the authenticated user — their own
 *       wallet first (`role: owner`), then one entry per active membership
 *       (`role: member`). Pass a wallet id in the `X-Wallet-Id` header on
 *       subsequent requests to act in that wallet (members are read-only).
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallets available to the caller.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, description: "Tenant id — value for the X-Wallet-Id header." }
 *                       name: { type: string, nullable: true }
 *                       ownerName: { type: string, nullable: true }
 *                       role: { type: string, enum: [owner, member] }
 *                       budgetHidden: { type: boolean, description: "True when the wallet hides budget values from members." }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/wallets', async (req, res) => {
  try {
    const wallets = await tenantService.listWalletsForUser(getUserId(req));
    res.json({ wallets });
  } catch (error) {
    logger.error('Failed to list wallets', { error });
    res.status(500).json({ error: 'Failed to list wallets' });
  }
});

export default router;
