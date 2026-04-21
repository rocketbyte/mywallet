import { Router } from 'express';
import { TenantController } from '../controllers/tenant.controller';

const router = Router();
const controller = new TenantController();

/**
 * @openapi
 * /tenants/me:
 *   get:
 *     summary: Get current tenant profile
 *     tags: [Tenants]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: Tenant profile.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/me', controller.getTenant.bind(controller));

/**
 * @openapi
 * /tenants:
 *   post:
 *     summary: Create or replace a tenant profile
 *     tags: [Tenants]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *               full_name: { type: string }
 *               currency: { type: string, example: USD }
 *               budget_limit: { type: number }
 *               notifications_enabled: { type: boolean }
 *               email_sync_enabled: { type: boolean }
 *     responses:
 *       201:
 *         description: Tenant upserted.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', controller.upsertTenant.bind(controller));

/**
 * @openapi
 * /tenants/me:
 *   patch:
 *     summary: Update current tenant profile
 *     tags: [Tenants]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: Updated tenant profile.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/me', controller.updateTenant.bind(controller));

export default router;
