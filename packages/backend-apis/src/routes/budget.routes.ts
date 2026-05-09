import { Router } from 'express';
import { BudgetController } from '../controllers/budget.controller';

const router = Router();
const controller = new BudgetController();

/**
 * @openapi
 * /budgets/current:
 *   get:
 *     summary: Get current month budget
 *     tags: [Budgets]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: Current budget with live spent amounts per category.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/current', controller.getCurrentBudget.bind(controller));

/**
 * @openapi
 * /budgets:
 *   post:
 *     summary: Create or replace the budget for a given month
 *     tags: [Budgets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [periodStart, limitAmount]
 *             properties:
 *               periodStart: { type: string, format: date, example: '2026-04-01' }
 *               limitAmount: { type: number, example: 3800 }
 *               categories:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     category: { type: string }
 *                     budget: { type: number }
 *     responses:
 *       201:
 *         description: Budget upserted.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', controller.upsertBudget.bind(controller));

/**
 * @openapi
 * /budgets/{id}:
 *   patch:
 *     summary: Update a budget
 *     tags: [Budgets]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated budget.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:id', controller.updateBudget.bind(controller));

export default router;
