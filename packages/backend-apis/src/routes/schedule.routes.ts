import { Router } from 'express';
import { ScheduleController } from '../controllers/schedule.controller';
import mongoose from 'mongoose';

const router = Router();

// Initialize controller with MongoDB connection
const controller = new ScheduleController(mongoose.connection);

/**
 * POST /api/schedules/email-processing
 * Create and start a scheduled email processing workflow
 *
 * Body:
 * {
 *   "name": "Daily Chase Emails",
 *   "description": "Process Chase credit card emails",
 *   "searchQuery": "subject:\"Usaste tu tarjeta de credito\"",
 *   "cronExpression": "* * * * *",  // Every minute
 *   "maxResults": 50,
 *   "afterDate": "2024-01-01"
 * }
 */
router.post('/email-processing', controller.createSchedule.bind(controller));

/**
 * GET /api/schedules
 * List all schedules
 */
router.get('/', controller.listSchedules.bind(controller));

/**
 * GET /api/schedules/:scheduleId
 * Get schedule information and status
 */
router.get('/:scheduleId', controller.getSchedule.bind(controller));

/**
 * PATCH /api/schedules/:scheduleId
 * Update schedule configuration
 *
 * Body:
 * {
 *   "name": "Updated name",
 *   "searchQuery": "new query",
 *   "maxResults": 100
 * }
 */
router.patch('/:scheduleId', controller.updateSchedule.bind(controller));

/**
 * DELETE /api/schedules/:scheduleId
 * Stop and delete a schedule
 */
router.delete('/:scheduleId', controller.deleteSchedule.bind(controller));

/**
 * POST /api/schedules/:scheduleId/pause
 * Pause a running schedule
 */
router.post('/:scheduleId/pause', controller.pauseSchedule.bind(controller));

/**
 * POST /api/schedules/:scheduleId/unpause
 * Resume a paused schedule
 */
router.post('/:scheduleId/unpause', controller.unpauseSchedule.bind(controller));

export default router;
