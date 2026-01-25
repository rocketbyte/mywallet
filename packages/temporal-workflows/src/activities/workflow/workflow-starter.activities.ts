import { Context } from '@temporalio/activity';
import { Client } from '@temporalio/client';
import {
  StartEmailProcessingWorkflowInput,
  StartEmailProcessingWorkflowOutput
} from '../../shared/types';

/**
 * Workflow Starter Activities
 *
 * These activities allow one workflow to start another workflow.
 * Used by gmail-subscription workflow to trigger email-processing workflow.
 */
export const createWorkflowStarterActivities = (temporalClient: Client) => {
  return {
    /**
     * Start Email Processing Workflow
     *
     * Triggers email-processing workflow for newly synced emails.
     * This connects the Gmail sync workflow to the email processing pipeline.
     */
    async startEmailProcessingWorkflow(
      input: StartEmailProcessingWorkflowInput
    ): Promise<StartEmailProcessingWorkflowOutput> {
      Context.current().heartbeat({ userId: input.userId, emailCount: input.emailIds.length });

      // If no emails to process, return early
      if (input.emailIds.length === 0) {
        console.log('[Activity] No emails to process, skipping workflow start');
        return {
          workflowId: '',
          runId: '',
          emailCount: 0
        };
      }

      const workflowId = `${input.workflowIdPrefix}${Date.now()}`;

      console.log(`[Activity] Starting email processing workflow for ${input.emailIds.length} emails`, {
        userId: input.userId,
        workflowId,
        emailIds: input.emailIds
      });

      try {
        // Start email-processing workflow
        const handle = await temporalClient.workflow.start('emailProcessingWorkflow', {
          taskQueue: 'email-processing-queue',
          workflowId,
          args: [{
            userId: input.userId,
            workflowId,
            workflowRunId: '',
            searchQuery: '',              // Not used when processing specific emails
            emailIds: input.emailIds,     // Process these specific emails
            maxResults: input.emailIds.length
          }]
        });

        console.log(`[Activity] Successfully started email processing workflow: ${workflowId}`);

        return {
          workflowId: handle.workflowId,
          runId: handle.firstExecutionRunId,
          emailCount: input.emailIds.length
        };
      } catch (error) {
        console.error(`[Activity] Failed to start email processing workflow:`, error);
        throw error;
      }
    }
  };
};

export type WorkflowStarterActivities = ReturnType<typeof createWorkflowStarterActivities>;
