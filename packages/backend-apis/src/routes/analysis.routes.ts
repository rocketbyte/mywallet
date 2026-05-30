import { Router } from 'express';
import { AnalysisController } from '../controllers/analysis.controller';

const router = Router();
const controller = new AnalysisController();

/**
 * @openapi
 * /analyses:
 *   get:
 *     summary: List daily transaction analyses for the caller
 *     tags: [Analyses]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Paged list.
 */
router.get('/', controller.list.bind(controller));

/**
 * @openapi
 * /analyses/latest:
 *   get:
 *     summary: Get the most recent analysis for the caller
 *     tags: [Analyses]
 *     responses:
 *       200:
 *         description: Latest analysis.
 *       204:
 *         description: No analysis yet.
 */
router.get('/latest', controller.getLatest.bind(controller));

/**
 * @openapi
 * /analyses/run:
 *   post:
 *     summary: Trigger an analysis run for the caller
 *     description: Owner-only. Defaults analysisDate to yesterday when omitted.
 *     tags: [Analyses]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               analysisDate: { type: string, format: date }
 *     responses:
 *       202:
 *         description: Workflow started.
 *       403:
 *         description: Caller is not the tenant owner.
 */
router.post('/run', controller.runNow.bind(controller));

/**
 * @openapi
 * /analyses/{id}:
 *   get:
 *     summary: Get an analysis by id
 *     tags: [Analyses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Analysis.
 *       404:
 *         description: Not found or cross-tenant.
 */
router.get('/:id', controller.getById.bind(controller));

export default router;
