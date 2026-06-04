import { Router } from 'express';
import { BudgetController } from '../controllers/budget.controller';

const router = Router();
const controller = new BudgetController();

/**
 * @openapi
 * /budgets/current:
 *   get:
 *     summary: Get the effective budget for the current month
 *     description: >
 *       Returns the budget for the current calendar month. If no row exists for
 *       this month, the most recent earlier budget's limits are carried forward
 *       (`isCarriedForward: true`) with spent/balance recomputed for this month.
 *       Returns `{ budget: null }` only when the user has never set a budget.
 *     tags: [Budgets]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: >
 *           Effective budget with live `totalSpent` and `balance`
 *           (`balance = totalBudget − totalSpent`), or `{ budget: null }`.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/current', controller.getCurrentBudget.bind(controller));

/**
 * @openapi
 * /budgets:
 *   post:
 *     summary: Create or replace the budget for a given month
 *     description: >
 *       Upserts the budget row for the target month. Persisting the current
 *       month makes it the new carry-forward base for later months. Provide
 *       `year`+`month` (preferred) or `periodStart`, and either `limitAmount`
 *       or `categories` (the cap defaults to the sum of category budgets).
 *     tags: [Budgets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               year: { type: integer, example: 2026 }
 *               month: { type: integer, example: 6 }
 *               periodStart: { type: string, format: date, example: '2026-06-01' }
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
 *         description: Budget upserted, returned with live totalSpent and balance.
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
