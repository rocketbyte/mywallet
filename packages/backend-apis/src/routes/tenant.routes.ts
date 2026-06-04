import { Router } from 'express';
import { TenantController } from '../controllers/tenant.controller';

const router = Router();
const controller = new TenantController();

/**
 * @openapi
 * /tenants/me:
 *   get:
 *     summary: Get current tenant (with members)
 *     tags: [Tenants]
 *     responses:
 *       200:
 *         description: Tenant profile incl. members.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/me', controller.getTenant.bind(controller));

/**
 * @openapi
 * /tenants/me:
 *   patch:
 *     summary: Update current tenant profile
 *     tags: [Tenants]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [individual, business] }
 *               currency: { type: string, example: USD }
 *               budgetLimit: { type: number }
 *               notificationsEnabled: { type: boolean }
 *               emailSyncEnabled: { type: boolean }
 *     responses:
 *       200: { description: Updated tenant. }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.patch('/me', controller.updateTenant.bind(controller));

/**
 * @openapi
 * /tenants/me/members:
 *   get:
 *     summary: List members of the current tenant
 *     tags: [Tenants]
 *     responses:
 *       200: { description: Members list. }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.get('/me/members', controller.listMembers.bind(controller));

/**
 * @openapi
 * /tenants/me/members:
 *   post:
 *     summary: Add an existing user to the tenant (primary only)
 *     tags: [Tenants]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       201: { description: Member added. }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { description: Caller is not the primary user. }
 *       404: { description: No user with that email. }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.post('/me/members', controller.addMember.bind(controller));

/**
 * @openapi
 * /tenants/me/members/{userId}:
 *   delete:
 *     summary: Remove a member from the tenant (primary only)
 *     tags: [Tenants]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Member removed. }
 *       400: { description: Cannot remove primary user. }
 *       403: { description: Caller is not the primary user. }
 *       404: { description: Member not found. }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
router.delete('/me/members/:userId', controller.removeMember.bind(controller));

export default router;
