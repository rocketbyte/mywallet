import { Router } from 'express';
import { WorkflowController } from '../controllers/workflow.controller';

const router = Router();
const controller = new WorkflowController();

/**
 * POST /api/workflows/email-processing
 * Start a new email processing workflow
 *
 * Body:
 * {
 *   "searchQuery": "from:no-reply@chase.com subject:transaction",
 *   "maxResults": 50,
 *   "afterDate": "2024-01-01"
 * }
 */
router.post('/email-processing', controller.startEmailProcessing.bind(controller));

/**
 * GET /api/workflows/:workflowId
 * Get workflow status and result
 */
router.get('/:workflowId', controller.getWorkflowStatus.bind(controller));

/**
 * POST /api/workflows/:workflowId/cancel
 * Cancel a running workflow
 */
router.post('/:workflowId/cancel', controller.cancelWorkflow.bind(controller));

export default router;
