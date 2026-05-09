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
 *     summary: List emails
 *     description: Returns a paginated list of stored emails with optional filters.
 *     tags: [Emails]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - $ref: '#/components/parameters/LimitQuery'
 *       - $ref: '#/components/parameters/OffsetQuery'
 *       - in: query
 *         name: isProcessed
 *         schema:
 *           type: boolean
 *         description: Filter by processing status.
 *       - in: query
 *         name: fromAddress
 *         schema:
 *           type: string
 *         description: Filter by sender email address.
 *         example: 'alertas@chase.com'
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Return emails received on or after this date.
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Return emails received on or before this date.
 *     responses:
 *       200:
 *         description: Paginated list of emails.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string, example: 'user_123' }
 *                 emails:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Email'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.getAllEmails.bind(controller));

/**
 * @openapi
 * /emails/search:
 *   get:
 *     summary: Search emails
 *     description: Full-text search across subject, body, snippet, and sender fields.
 *     tags: [Emails]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term.
 *         example: 'Chase'
 *       - $ref: '#/components/parameters/LimitQuery'
 *       - $ref: '#/components/parameters/OffsetQuery'
 *     responses:
 *       200:
 *         description: Matching emails.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string, example: 'user_123' }
 *                 searchTerm: { type: string, example: 'Chase' }
 *                 emails:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Email'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         description: Search term is required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/search', controller.searchEmails.bind(controller));

/**
 * @openapi
 * /emails/{id}:
 *   get:
 *     summary: Get email by ID
 *     description: Returns a single email record by its Gmail message ID.
 *     tags: [Emails]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Gmail message ID.
 *         example: '18f3c2a1b9e4d7f0'
 *     responses:
 *       200:
 *         description: The email record.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string, example: 'user_123' }
 *                 email:
 *                   $ref: '#/components/schemas/Email'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id', controller.getEmailById.bind(controller));

export default router;
