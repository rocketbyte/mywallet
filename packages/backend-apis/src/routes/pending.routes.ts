import { Router } from 'express';
import { PendingController } from '../controllers/pending.controller';

const router = Router();
const controller = new PendingController();

/**
 * @openapi
 * /pending:
 *   get:
 *     summary: List pending transactions awaiting review
 *     tags: [Pending]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: List of pending transactions.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.getPending.bind(controller));

/**
 * @openapi
 * /pending:
 *   post:
 *     summary: Create a pending transaction (used by pipeline)
 *     tags: [Pending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [merchant, amount, category, confidence, source]
 *             properties:
 *               merchant: { type: string }
 *               amount: { type: number }
 *               category: { type: string }
 *               confidence: { type: number }
 *               source: { type: string }
 *               snippet: { type: string }
 *               rawEmail: { type: string }
 *               emailId: { type: string }
 *     responses:
 *       201:
 *         description: Pending transaction created.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', controller.createPending.bind(controller));

/**
 * @openapi
 * /pending/{id}/approve:
 *   post:
 *     summary: Approve pending transaction — converts to a confirmed transaction
 *     tags: [Pending]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Transaction created from approved pending item.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:id/approve', controller.approvePending.bind(controller));

/**
 * @openapi
 * /pending/{id}:
 *   delete:
 *     summary: Reject and remove a pending transaction
 *     tags: [Pending]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pending transaction rejected.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', controller.rejectPending.bind(controller));

export default router;
