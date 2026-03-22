import { Router } from 'express';
import { ScheduleController } from '../controllers/schedule.controller';
import mongoose from 'mongoose';

const router = Router();

// Initialize controller with MongoDB connection
const controller = new ScheduleController(mongoose.connection);

/**
 * @openapi
 * /schedules/email-processing:
 *   post:
 *     summary: Create a recurring email processing schedule
 *     description: |
 *       Creates a Temporal schedule that automatically runs the email processing
 *       workflow on a cron interval. Use standard cron syntax for `cronExpression`.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, searchQuery]
 *             properties:
 *               name:
 *                 type: string
 *                 example: 'Daily Chase Emails'
 *               description:
 *                 type: string
 *                 example: 'Process Chase credit card alerts every day at 8am'
 *               searchQuery:
 *                 type: string
 *                 example: 'subject:"Usaste tu tarjeta de credito"'
 *               cronExpression:
 *                 type: string
 *                 description: Standard cron expression.
 *                 default: '* * * * *'
 *                 example: '0 8 * * *'
 *               maxResults:
 *                 type: integer
 *                 default: 50
 *                 example: 50
 *               afterDate:
 *                 type: string
 *                 format: date
 *                 example: '2024-01-01'
 *     responses:
 *       201:
 *         description: Schedule created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string, example: 'user_123' }
 *                 scheduleId: { type: string, example: 'sched_chase_daily' }
 *                 name: { type: string, example: 'Daily Chase Emails' }
 *                 searchQuery: { type: string }
 *                 cronExpression: { type: string, example: '0 8 * * *' }
 *                 maxResults: { type: integer, example: 50 }
 *                 status: { type: string, example: 'created' }
 *                 message: { type: string, example: 'Email processing schedule created successfully' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/email-processing', controller.createSchedule.bind(controller));

/**
 * @openapi
 * /schedules:
 *   get:
 *     summary: List all schedules
 *     description: Returns all email processing schedules for the user, including run stats and next execution time.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: List of schedules.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string, example: 'user_123' }
 *                 total: { type: integer, example: 2 }
 *                 schedules:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Schedule'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.listSchedules.bind(controller));

/**
 * @openapi
 * /schedules/{scheduleId}:
 *   get:
 *     summary: Get schedule details
 *     description: Returns full configuration, status, and run statistics for a specific schedule.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'sched_chase_daily'
 *     responses:
 *       200:
 *         description: Schedule details.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Schedule'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:scheduleId', controller.getSchedule.bind(controller));

/**
 * @openapi
 * /schedules/{scheduleId}:
 *   patch:
 *     summary: Update schedule configuration
 *     description: Updates the search query, name, maxResults, or afterDate of an existing schedule.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'sched_chase_daily'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: 'Updated Chase Schedule' }
 *               description: { type: string }
 *               searchQuery: { type: string, example: 'subject:"transaction alert"' }
 *               maxResults: { type: integer, example: 100 }
 *               afterDate: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Schedule updated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string }
 *                 scheduleId: { type: string }
 *                 name: { type: string }
 *                 searchQuery: { type: string }
 *                 maxResults: { type: integer }
 *                 message: { type: string, example: 'Schedule configuration updated successfully' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:scheduleId', controller.updateSchedule.bind(controller));

/**
 * @openapi
 * /schedules/{scheduleId}:
 *   delete:
 *     summary: Delete a schedule
 *     description: Stops and permanently deletes the schedule and its Temporal workflow.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'sched_chase_daily'
 *     responses:
 *       200:
 *         description: Schedule deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string }
 *                 scheduleId: { type: string }
 *                 status: { type: string, example: 'deleted' }
 *                 message: { type: string, example: 'Schedule deleted successfully' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:scheduleId', controller.deleteSchedule.bind(controller));

/**
 * @openapi
 * /schedules/{scheduleId}/pause:
 *   post:
 *     summary: Pause a schedule
 *     description: Temporarily stops the schedule from triggering new runs. Use `/unpause` to resume.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'sched_chase_daily'
 *     responses:
 *       200:
 *         description: Schedule paused.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string }
 *                 scheduleId: { type: string }
 *                 status: { type: string, example: 'paused' }
 *                 message: { type: string, example: 'Schedule paused successfully' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:scheduleId/pause', controller.pauseSchedule.bind(controller));

/**
 * @openapi
 * /schedules/{scheduleId}/unpause:
 *   post:
 *     summary: Resume a paused schedule
 *     description: Resumes a previously paused schedule. The next run will fire at the next cron interval.
 *     tags: [Schedules]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: scheduleId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'sched_chase_daily'
 *     responses:
 *       200:
 *         description: Schedule resumed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string }
 *                 scheduleId: { type: string }
 *                 status: { type: string, example: 'active' }
 *                 message: { type: string, example: 'Schedule resumed successfully' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:scheduleId/unpause', controller.unpauseSchedule.bind(controller));

export default router;
