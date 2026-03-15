import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';

const router = Router();
const controller = new WorkflowController();

/**
 * @openapi
 * /workflows/email-processing:
 *   post:
 *     summary: Start email processing workflow
 *     description: Manually triggers the Temporal workflow to scan and process emails.
 *     tags: [Workflows]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               searchQuery:
 *                 type: string
 *               maxResults:
 *                 type: integer
 *               afterDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Workflow started.
 */
router.post('/email-processing', controller.startEmailProcessing.bind(controller));

/**
 * @openapi
 * /workflows/{workflowId}:
 *   get:
 *     summary: Get workflow status
 *     description: Returns the execution status and result of a specific Temporal workflow.
 *     tags: [Workflows]
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status returned.
 */
router.get('/:workflowId', controller.getWorkflowStatus.bind(controller));

/**
 * @openapi
 * /workflows/{workflowId}/cancel:
 *   post:
 *     summary: Cancel workflow
 *     description: Cancels a running Temporal workflow.
 *     tags: [Workflows]
 *     parameters:
 *       - in: path
 *         name: workflowId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workflow cancelled.
 */
router.post('/:workflowId/cancel', controller.cancelWorkflow.bind(controller));

export default router;
