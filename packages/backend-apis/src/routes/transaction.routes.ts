import { Router } from 'express';
import { TransactionController } from '../controllers/transaction.controller';

const router = Router();
const controller = new TransactionController();

/**
 * @openapi
 * /transactions:
 *   get:
 *     summary: List transactions
 *     tags: [Transactions]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - $ref: '#/components/parameters/LimitQuery'
 *       - $ref: '#/components/parameters/OffsetQuery'
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Paginated list of transactions.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.getTransactions.bind(controller));

/**
 * @openapi
 * /transactions:
 *   post:
 *     summary: Create a transaction
 *     tags: [Transactions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [merchant, amount, category, date]
 *             properties:
 *               merchant: { type: string }
 *               amount: { type: number }
 *               category: { type: string }
 *               date: { type: string, format: date }
 *               time: { type: string, example: '14:30' }
 *               source: { type: string, enum: [email, sms, manual, chat] }
 *               account: { type: string }
 *               note: { type: string }
 *               isIncome: { type: boolean }
 *     responses:
 *       201:
 *         description: Created transaction.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', controller.createTransaction.bind(controller));

/**
 * @openapi
 * /transactions/balance:
 *   get:
 *     summary: Get totals (credits, debits, balance) for a date range
 *     description: |
 *       Returns the sum of credit transactions, sum of debit transactions,
 *       and the net balance (credits − debits) over the optional date
 *       range. With no dates supplied, aggregates across all transactions.
 *     tags: [Transactions]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *         description: Inclusive lower bound (ISO YYYY-MM-DD).
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *         description: Inclusive upper bound (ISO YYYY-MM-DD).
 *     responses:
 *       200:
 *         description: Balance summary.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 credits: { type: number, example: 4250.00 }
 *                 debits:  { type: number, example: 1875.42 }
 *                 balance: { type: number, example: 2374.58 }
 *                 count:   { type: integer, example: 37 }
 *                 startDate: { type: string, format: date, nullable: true }
 *                 endDate:   { type: string, format: date, nullable: true }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/balance', controller.getBalance.bind(controller));

/**
 * @openapi
 * /transactions/{id}:
 *   get:
 *     summary: Get transaction by ID
 *     tags: [Transactions]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Transaction record.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id', controller.getTransactionById.bind(controller));

/**
 * @openapi
 * /transactions/{id}:
 *   patch:
 *     summary: Update a transaction
 *     tags: [Transactions]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated transaction.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:id', controller.updateTransaction.bind(controller));

/**
 * @openapi
 * /transactions/{id}:
 *   delete:
 *     summary: Delete a transaction
 *     tags: [Transactions]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted.
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', controller.deleteTransaction.bind(controller));

export default router;
