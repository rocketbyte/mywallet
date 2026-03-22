import { Router } from 'express';
import { GmailWebhookController } from '../controllers/gmail-webhook.controller';
import { gmailProvider } from '../providers';

const router = Router();
const controller = new GmailWebhookController(gmailProvider);

/**
 * @openapi
 * /gmail/webhook:
 *   post:
 *     summary: Receive Gmail Pub/Sub notification
 *     description: |
 *       Called by Google Pub/Sub when a new change occurs in a watched Gmail account.
 *       Signals (or starts) the Temporal `gmailSubscriptionWorkflow` for the matching user.
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
 *                     description: Base64-encoded JSON notification `{ emailAddress, historyId }`.
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
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/webhook', (req, res) => controller.handleWebhook(req, res));

/**
 * @openapi
 * /gmail/link:
 *   post:
 *     summary: Link a Gmail account
 *     description: |
 *       Starts the Temporal `gmailSubscriptionWorkflow` for the given user.
 *       Use this for manual linking when `userId` was not passed to `GET /auth/gmail`.
 *     tags: [Gmail]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, email, refreshToken]
 *             properties:
 *               userId:
 *                 type: string
 *                 example: user_123
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@gmail.com
 *               refreshToken:
 *                 type: string
 *               pubSubTopicName:
 *                 type: string
 *                 description: Overrides the default PubSub topic from env.
 *     responses:
 *       201:
 *         description: Account linked and workflow started.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: linked }
 *                 userId: { type: string }
 *                 workflowId: { type: string }
 *                 message: { type: string }
 *       400:
 *         $ref: '#/components/responses/ServerError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/link', (req, res) => controller.linkAccount(req, res));

/**
 * @openapi
 * /gmail/unlink/{userId}:
 *   delete:
 *     summary: Unlink a Gmail account
 *     description: Sends a `stopSync` signal to the Temporal workflow and marks the account inactive.
 *     tags: [Gmail]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: user_123
 *     responses:
 *       200:
 *         description: Account unlinked successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: unlinked }
 *                 userId: { type: string }
 *                 message: { type: string }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/unlink/:userId', (req, res) => controller.unlinkAccount(req, res));

/**
 * @openapi
 * /gmail/status/{userId}:
 *   get:
 *     summary: Get Gmail sync status
 *     description: Returns the MongoDB account record merged with the live Temporal workflow status.
 *     tags: [Gmail]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         example: user_123
 *     responses:
 *       200:
 *         description: Account status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string }
 *                 email: { type: string }
 *                 isActive: { type: boolean }
 *                 workflowId: { type: string }
 *                 workflowStatus: { type: string }
 *                 watchExpiration: { type: string, format: date-time, nullable: true }
 *                 lastSyncAt: { type: string, format: date-time, nullable: true }
 *                 totalEmailsSynced: { type: integer }
 *                 lastError: { type: string, nullable: true }
 *                 errorCount: { type: integer }
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/status/:userId', (req, res) => controller.getStatus(req, res));

export default router;
