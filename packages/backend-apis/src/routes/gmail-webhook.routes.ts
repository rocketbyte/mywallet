import { Router } from 'express';
import { GmailWebhookController } from '../controllers/gmail-webhook.controller';
import mongoose from 'mongoose';

const router = Router();

// Initialize controller with MongoDB connection
const controller = new GmailWebhookController(mongoose.connection);

/**
 * @openapi
 * /gmail/webhook:
 *   post:
 *     summary: Receive Gmail Pub/Sub notification
 *     description: Endpoint called by Google Pub/Sub when a new change occurs in a watched Gmail account.
 *     tags: [Gmail]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: object
 *                 properties:
 *                   data:
 *                     type: string
 *                     description: Base64 encoded JSON notification.
 *                   messageId:
 *                     type: string
 *                   publishTime:
 *                     type: string
 *               subscription:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook received and processed (or ignored if account not found).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [processed, ignored]
 *                 workflowId:
 *                   type: string
 */
router.post('/webhook', (req, res) => controller.handleWebhook(req, res));

/**
 * @openapi
 * /gmail/link:
 *   post:
 *     summary: Link a Gmail account
 *     description: Starts the Temporal synchronization workflow for a new Gmail account.
 *     tags: [Gmail]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, email, refreshToken, pubSubTopicName]
 *             properties:
 *               userId:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               refreshToken:
 *                 type: string
 *               pubSubTopicName:
 *                 type: string
 *     responses:
 *       201:
 *         description: Account linked and workflow started.
 *       400:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/link', (req, res) => controller.linkAccount(req, res));

/**
 * @openapi
 * /gmail/unlink/{userId}:
 *   delete:
 *     summary: Unlink a Gmail account
 *     description: Stops the Temporal synchronization and removes the account.
 *     tags: [Gmail]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account unlinked successfully.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.delete('/unlink/:userId', (req, res) => controller.unlinkAccount(req, res));

/**
 * @openapi
 * /gmail/status/{userId}:
 *   get:
 *     summary: Get Gmail sync status
 *     description: Returns the current status of the Temporal sync workflow and account metadata.
 *     tags: [Gmail]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/status/:userId', (req, res) => controller.getStatus(req, res));

export default router;
