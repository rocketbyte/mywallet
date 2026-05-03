import { Request, Response } from 'express';
import { getTemporalClient } from '../config/temporal-client';
import { PipelineStep } from '../../../temporal-workflows/src/models/pipeline-step.model';
import { TASK_QUEUES, WORKFLOW_IDS } from '../../../temporal-workflows/src/shared/constants';
import { logger } from '../utils/logger';

/**
 * Pipeline Controller
 *
 * CRUD for pipeline step configurations (prompt management).
 * Steps are identified by their stepKey (e.g. "classify_email").
 *
 * Routes:
 *   GET    /api/pipeline/steps            — list all steps
 *   GET    /api/pipeline/steps/:stepKey   — get a single step
 *   PUT    /api/pipeline/steps/:stepKey   — create or update a step
 *   POST   /api/pipeline/steps/:stepKey/test — test a prompt against sample email
 *   POST   /api/pipeline/run/:emailId     — manually trigger pipeline for an email
 */

// ─── List all steps ──────────────────────────────────────────────────────────

export async function listPipelineSteps(req: Request, res: Response): Promise<void> {
  try {
    const steps = await PipelineStep.find().sort({ order: 1 }).lean();
    res.json({ steps });
  } catch (err) {
    logger.error('Failed to list pipeline steps', { err });
    res.status(500).json({ error: 'Failed to list pipeline steps' });
  }
}

// ─── Get single step ─────────────────────────────────────────────────────────

export async function getPipelineStep(req: Request, res: Response): Promise<void> {
  try {
    const { stepKey } = req.params;
    const step = await PipelineStep.findOne({ stepKey }).lean();

    if (!step) {
      res.status(404).json({ error: `Pipeline step not found: ${stepKey}` });
      return;
    }

    res.json({ step });
  } catch (err) {
    logger.error('Failed to get pipeline step', { err });
    res.status(500).json({ error: 'Failed to get pipeline step' });
  }
}

// ─── Create or update step ───────────────────────────────────────────────────

export async function upsertPipelineStep(req: Request, res: Response): Promise<void> {
  try {
    const { stepKey } = req.params;
    const {
      name,
      description,
      order,
      systemPrompt,
      userPromptTemplate,
      model,
      temperature,
      maxTokens,
      isActive
    } = req.body;

    if (!systemPrompt && !userPromptTemplate && !name) {
      res.status(400).json({ error: 'At least one field must be provided for update' });
      return;
    }

    const updateFields: Record<string, any> = {};
    if (name) updateFields.name = name;
    if (description) updateFields.description = description;
    if (order) updateFields.order = order;
    if (systemPrompt) updateFields.systemPrompt = systemPrompt;
    if (userPromptTemplate) updateFields.userPromptTemplate = userPromptTemplate;
    if (model) updateFields.model = model;
    if (temperature) updateFields.temperature = temperature;
    if (maxTokens) updateFields.maxTokens = maxTokens;
    if (isActive) updateFields.isActive = isActive;

    const step = await PipelineStep.findOneAndUpdate(
      { stepKey },
      {
        $set: { ...updateFields, stepKey },
        $inc: { version: 1 }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ step });
  } catch (err) {
    logger.error('Failed to upsert pipeline step', { err });
    res.status(500).json({ error: 'Failed to upsert pipeline step' });
  }
}

// ─── Manually trigger pipeline for a single email ────────────────────────────

export async function runPipelineForEmail(req: Request, res: Response): Promise<void> {
  try {
    const { emailId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId is required in the request body' });
      return;
    }

    const { transactionPipelineWorkflow } = await import(
      '../../../temporal-workflows/src/workflows/transaction-pipeline.workflow'
    );

    const { Email } = await import('../../../temporal-workflows/src/models/email.model');
    const email = await Email.findOne({ userId, emailId }).lean();

    if (!email) {
      res.status(404).json({ error: `Email not found: ${emailId}` });
      return;
    }

    const client = await getTemporalClient();
    const workflowId = `${WORKFLOW_IDS.PIPELINE_PREFIX}-${emailId}-manual`;

    const handle = await client.workflow.start(transactionPipelineWorkflow, {
      taskQueue: TASK_QUEUES.PIPELINE,
      workflowId,
      args: [{
        userId,
        emailId,
        subject: email.subject,
        from: email.from,
        body: email.body,
        date: email.date,
        workflowId
      }]
    });

    res.status(202).json({
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      emailId,
      status: 'started'
    });
  } catch (err) {
    logger.error('Failed to start pipeline workflow', { err });
    res.status(500).json({ error: 'Failed to start pipeline workflow' });
  }
}
