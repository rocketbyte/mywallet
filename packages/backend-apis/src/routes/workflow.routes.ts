import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';

const router = Router();
const controller = new WorkflowController();

/**
 * @openapi
 * /workflows/email-processing:
 *   post:
 *     summary: Start email processing workflow
 *     description: Manually triggers a Temporal workflow to scan Gmail and extract transactions from matching emails.
 *     tags: [Workflows]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [searchQuery]
 *             properties:
 *               searchQuery:
 *                 type: string
 *                 description: Gmail search query to filter emails.
 *                 example: 'subject:"Usaste tu tarjeta de credito"'
 *               maxResults:
 *                 type: integer
 *                 description: Maximum number of emails to process.
 *                 default: 50
 *                 example: 50
 *               afterDate:
 *                 type: string
 *                 format: date
 *                 description: Only process emails received after this date.
 *                 example: '2024-01-01'
 *     responses:
 *       202:
 *         description: Workflow started successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userId: { type: string, example: 'user_123' }
 *                 workflowId: { type: string, example: 'email-processing-user_123-1711234567' }
 *                 runId: { type: string, example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }
 *                 status: { type: string, example: 'started' }
 *                 message: { type: string, example: 'Email processing workflow started successfully' }
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/email-processing', controller.startEmailProcessing.bind(controller));

/**
 * @openapi
 * /workflows/{workflowId}:
 *   get:
 *     summary: Get workflow status
 *     description: Returns the current execution status and result of a specific Temporal workflow.
 *     tags: [Workflows]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'email-processing-user_123-1711234567'
 *     responses:
 *       200:
 *         description: Workflow status returned.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkflowStatus'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:workflowId', controller.getWorkflowStatus.bind(controller));

/**
 * @openapi
 * /workflows/{workflowId}/cancel:
 *   post:
 *     summary: Cancel workflow
 *     description: Cancels a running Temporal workflow. Has no effect if already completed or failed.
 *     tags: [Workflows]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *         example: 'email-processing-user_123-1711234567'
 *     responses:
 *       200:
 *         description: Workflow cancelled.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workflowId: { type: string, example: 'email-processing-user_123-1711234567' }
 *                 status: { type: string, example: 'cancelled' }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:workflowId/cancel', controller.cancelWorkflow.bind(controller));

export default router;
