import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import mongoose from 'mongoose';

const router = Router();

// Initialize controller with MongoDB connection
// Note: This assumes MongoDB is already connected in the worker/app
const controller = new EmailController(mongoose.connection);

/**
 * GET /api/emails
 * Get all emails with pagination and filters
 *
 * Query params:
 * - limit: number (default: 50)
 * - offset: number (default: 0)
 * - isProcessed: boolean
 * - fromAddress: string
 * - startDate: ISO date string
 * - endDate: ISO date string
 */
router.get('/', controller.getAllEmails.bind(controller));

/**
 * GET /api/emails/stats
 * Get email statistics
 */
router.get('/stats', controller.getEmailStats.bind(controller));

/**
 * GET /api/emails/search
 * Search emails by text
 *
 * Query params:
 * - q: search term (required)
 * - limit: number (default: 50)
 * - offset: number (default: 0)
 */
router.get('/search', controller.searchEmails.bind(controller));

/**
 * GET /api/emails/:id
 * Get a specific email by Gmail ID
 */
router.get('/:id', controller.getEmailById.bind(controller));

export default router;
