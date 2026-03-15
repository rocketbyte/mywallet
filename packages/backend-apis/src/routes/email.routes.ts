import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import mongoose from 'mongoose';

const router = Router();

// Initialize controller with MongoDB connection
// Note: This assumes MongoDB is already connected in the worker/app
const controller = new EmailController(mongoose.connection);

/**
 * @openapi
 * /emails:
 *   get:
 *     summary: Get all emails
 *     description: Returns a paginated list of emails with optional filtering.
 *     tags: [Emails]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: isProcessed
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: fromAddress
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: A list of emails.
 */
router.get('/', controller.getAllEmails.bind(controller));

/**
 * @openapi
 * /emails/stats:
 *   get:
 *     summary: Get email statistics
 *     description: Returns overall statistics for emails in the system.
 *     tags: [Emails]
 *     responses:
 *       200:
 *         description: Email statistics.
 */
router.get('/stats', controller.getEmailStats.bind(controller));

/**
 * @openapi
 * /emails/search:
 *   get:
 *     summary: Search emails
 *     description: Full-text search across all emails.
 *     tags: [Emails]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Search results.
 */
router.get('/search', controller.searchEmails.bind(controller));

/**
 * @openapi
 * /emails/{id}:
 *   get:
 *     summary: Get email by ID
 *     description: Returns a single email by its Gmail ID.
 *     tags: [Emails]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The email record.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/:id', controller.getEmailById.bind(controller));

export default router;
