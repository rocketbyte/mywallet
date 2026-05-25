import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { emailProviders } from '../providers';

const router = Router();
const controller = new AuthController(emailProviders);

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

export default router;
