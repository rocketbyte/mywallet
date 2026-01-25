import { Request, Response } from 'express';
import { getTemporalClient } from '../config/temporal-client';
import { emailProcessingWorkflow } from '../../../temporal-workflows/src/workflows';
import { TASK_QUEUES, WORKFLOW_IDS } from '../../../temporal-workflows/src/shared/constants';
import { EmailProcessingInput } from '../../../temporal-workflows/src/shared/types';
import { logger } from '../utils/logger';

export class WorkflowController {
  async startEmailProcessing(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const { searchQuery, maxResults, afterDate } = req.body;

      if (!searchQuery) {
        return res.status(400).json({
          error: 'searchQuery is required'
        });
      }

      const client = await getTemporalClient();

      const workflowId = `${WORKFLOW_IDS.EMAIL_PROCESSING_PREFIX}${userId}-${Date.now()}`;

      const handle = await client.workflow.start(emailProcessingWorkflow, {
        taskQueue: TASK_QUEUES.EMAIL_PROCESSING,
        workflowId,
        args: [{
          userId,
          workflowId,
          workflowRunId: '',
          searchQuery,
          maxResults,
          afterDate: afterDate ? new Date(afterDate) : undefined
        } as EmailProcessingInput]
      });

      logger.info('Started email processing workflow', { workflowId, userId });

      res.status(202).json({
        userId,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
        status: 'started',
        message: 'Email processing workflow started successfully'
      });

    } catch (error) {
      logger.error('Failed to start workflow', { error });
      res.status(500).json({
        error: 'Failed to start workflow',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async getWorkflowStatus(req: Request, res: Response) {
    try {
      const { workflowId } = req.params;

      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(workflowId);

      const description = await handle.describe();

      let result = null;
      if (description.status.name === 'COMPLETED') {
        result = await handle.result();
      }

      res.json({
        workflowId: handle.workflowId,
        runId: description.runId,
        status: description.status.name,
        startTime: description.startTime,
        closeTime: description.closeTime,
        result
      });

    } catch (error) {
      logger.error('Failed to get workflow status', { error });
      res.status(500).json({
        error: 'Failed to get workflow status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async cancelWorkflow(req: Request, res: Response) {
    try {
      const { workflowId } = req.params;

      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(workflowId);

      await handle.cancel();

      res.json({
        workflowId,
        status: 'cancelled'
      });

    } catch (error) {
      logger.error('Failed to cancel workflow', { error });
      res.status(500).json({
        error: 'Failed to cancel workflow',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
