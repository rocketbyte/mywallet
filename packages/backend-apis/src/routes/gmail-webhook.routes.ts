import { Router } from 'express';
import { GmailWebhookController } from '../controllers/gmail-webhook.controller';
import mongoose from 'mongoose';

const router = Router();

// Initialize controller with MongoDB connection
const controller = new GmailWebhookController(mongoose.connection);

/**
 * POST /api/gmail/webhook
 * Webhook endpoint called by Google Pub/Sub
 *
 * Body (Pub/Sub format):
 * {
 *   "message": {
 *     "data": "base64_encoded_json",
 *     "messageId": "...",
 *     "publishTime": "..."
 *   },
 *   "subscription": "..."
 * }
 */
router.post('/webhook', (req, res) => controller.handleWebhook(req, res));

/**
 * POST /api/gmail/link
 * Link a new Gmail account
 *
 * Body:
 * {
 *   "userId": "user123",
 *   "email": "user@gmail.com",
 *   "refreshToken": "...",
 *   "pubSubTopicName": "projects/PROJECT_ID/topics/TOPIC_NAME"
 * }
 */
router.post('/link', (req, res) => controller.linkAccount(req, res));

/**
 * DELETE /api/gmail/unlink/:userId
 * Unlink Gmail account and stop sync
 */
router.delete('/unlink/:userId', (req, res) => controller.unlinkAccount(req, res));

/**
 * GET /api/gmail/status/:userId
 * Get Gmail sync status for a user
 */
router.get('/status/:userId', (req, res) => controller.getStatus(req, res));

export default router;
