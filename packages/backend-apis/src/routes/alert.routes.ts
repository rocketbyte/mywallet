import { Router } from 'express';
import { AlertController } from '../controllers/alert.controller';

const router = Router();
const controller = new AlertController();

/**
 * @openapi
 * /alerts:
 *   get:
 *     summary: List alerts
 *     tags: [Alerts]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: List of alerts sorted by creation date.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.getAlerts.bind(controller));

/**
 * @openapi
 * /alerts:
 *   post:
 *     summary: Create an alert
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, title, body]
 *             properties:
 *               kind: { type: string, enum: [over, large, low, tip] }
 *               title: { type: string }
 *               body: { type: string }
 *     responses:
 *       201:
 *         description: Alert created.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', controller.createAlert.bind(controller));

/**
 * @openapi
 * /alerts/{id}/read:
 *   patch:
 *     summary: Mark alert as read
 *     tags: [Alerts]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Alert marked as read.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:id/read', controller.markAlertRead.bind(controller));

/**
 * @openapi
 * /alerts/{id}:
 *   delete:
 *     summary: Delete an alert
 *     tags: [Alerts]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Alert deleted.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', controller.deleteAlert.bind(controller));

export default router;
