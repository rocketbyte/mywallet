import { Router } from 'express';
import {
  listPipelineSteps,
  getPipelineStep,
  upsertPipelineStep,
  runPipelineForEmail
} from '../controllers/pipeline.controller';

const router = Router();

/**
 * @openapi
 * /pipeline/steps:
 *   get:
 *     summary: List all pipeline steps
 *     description: Returns all AI pipeline step configurations ordered by execution order (classify → extract → store).
 *     tags: [Pipeline]
 *     responses:
 *       200:
 *         description: List of pipeline steps
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 steps:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PipelineStep'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/steps', listPipelineSteps);

/**
 * @openapi
 * /pipeline/steps/{stepKey}:
 *   get:
 *     summary: Get a single pipeline step
 *     description: Returns the full configuration and prompts for a specific pipeline step.
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: stepKey
 *         required: true
 *         schema:
 *           type: string
 *           enum: [classify_email, extract_transaction, store_transaction]
 *         example: classify_email
 *     responses:
 *       200:
 *         description: Pipeline step configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 step:
 *                   $ref: '#/components/schemas/PipelineStep'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/steps/:stepKey', getPipelineStep);

/**
 * @openapi
 * /pipeline/steps/{stepKey}:
 *   put:
 *     summary: Create or update a pipeline step
 *     description: |
 *       Upserts the pipeline step configuration. Use this to tune prompts, swap the model, or
 *       adjust temperature/maxTokens without redeploying.
 *
 *       **Template variables** available in `userPromptTemplate`:
 *       - `{{email_from}}` — sender address
 *       - `{{email_subject}}` — email subject
 *       - `{{email_body}}` — full email body
 *       - `{{email_date}}` — ISO date
 *       - `{{transaction_type}}` — hint from classify step (extract step only)
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: stepKey
 *         required: true
 *         schema:
 *           type: string
 *           enum: [classify_email, extract_transaction, store_transaction]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               systemPrompt:
 *                 type: string
 *               userPromptTemplate:
 *                 type: string
 *               model:
 *                 type: string
 *                 example: qwen3:4b
 *               temperature:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 2
 *               maxTokens:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *           example:
 *             model: qwen3:4b
 *             temperature: 0.1
 *             maxTokens: 300
 *             systemPrompt: "You are a financial email classifier..."
 *             userPromptTemplate: "Classify this email:\n\nFrom: {{email_from}}\nSubject: {{email_subject}}\n\nBody:\n{{email_body}}"
 *     responses:
 *       200:
 *         description: Updated pipeline step
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 step:
 *                   $ref: '#/components/schemas/PipelineStep'
 *       400:
 *         description: No fields provided for update
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/steps/:stepKey', upsertPipelineStep);

/**
 * @openapi
 * /pipeline/run/{emailId}:
 *   post:
 *     summary: Manually trigger the pipeline for a stored email
 *     description: |
 *       Starts a `transactionPipelineWorkflow` for an email already stored in MongoDB.
 *       Useful for reprocessing, testing, or backfilling transactions without waiting for a
 *       new Gmail notification.
 *
 *       The sender watchlist is enforced here too: if the email's sender is not
 *       in the user's watchlist the request is rejected with 403 — add the
 *       sender via `POST /senders` first, then reprocess.
 *
 *       The pipeline runs 3 steps asynchronously via Temporal:
 *       1. **classify_email** — AI determines if it's a bank transaction
 *       2. **extract_transaction** — AI extracts merchant, amount, currency, date, etc.
 *       3. **store_transaction** — persists the result to the `transactions` collection
 *     tags: [Pipeline]
 *     parameters:
 *       - in: path
 *         name: emailId
 *         required: true
 *         description: Gmail message ID (the `emailId` field on the email document)
 *         schema:
 *           type: string
 *         example: 19d11f9c396c2763
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *                 example: "14"
 *     responses:
 *       202:
 *         description: Pipeline workflow started
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PipelineRunResponse'
 *       400:
 *         description: Missing userId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: The email's sender is not in the user's watchlist.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/run/:emailId', runPipelineForEmail);

export default router;
