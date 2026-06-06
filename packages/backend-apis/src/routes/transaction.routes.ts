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
 *     description: |
 *       Manually record a transaction (e.g. cash spending, or any entry not
 *       ingested from email). `category` must be one of the keys from
 *       `GET /transactions/categories`; `transactionType` ('credit' = income,
 *       'debit' = expense) sets the direction. `source` defaults to 'manual'
 *       when omitted. An unknown `category`, an invalid `transactionType`, or an
 *       unrecognized `source` is rejected with 400.
 *     tags: [Transactions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [merchant, amount, category, transactionDate]
 *             properties:
 *               merchant: { type: string }
 *               amount: { type: number, description: Non-negative; direction comes from transactionType. }
 *               category: { type: string, example: food }
 *               transactionDate: { type: string, format: date-time }
 *               transactionType: { type: string, enum: [debit, credit] }
 *               currency: { type: string, example: USD }
 *               source: { type: string, enum: [email, sms, manual, chat], default: manual }
 *               account: { type: string }
 *               note: { type: string }
 *               isIncome: { type: boolean, deprecated: true, description: Legacy; prefer transactionType. }
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
 *                 byCategory:
 *                   type: array
 *                   description: Debit totals grouped by category (sorted desc); sums to `debits`.
 *                   items:
 *                     type: object
 *                     properties:
 *                       category: { type: string, example: food }
 *                       spent:    { type: number, example: 612.80 }
 *                 fixedExpenses: { type: number, example: 1200.00, description: Sum of debit transactions in range flagged isFixedExpense; 0 when none. }
 *                 startDate: { type: string, format: date, nullable: true }
 *                 endDate:   { type: string, format: date, nullable: true }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/balance', controller.getBalance.bind(controller));

/**
 * @openapi
 * /transactions/categories:
 *   get:
 *     summary: List supported transaction categories
 *     description: |
 *       Returns the canonical, backend-owned category taxonomy. The `key`s are
 *       the stored contract values and the only category values the create and
 *       update endpoints accept; `label`s are display-ready names. The list is
 *       returned in a stable display order.
 *     tags: [Transactions]
 *     responses:
 *       200:
 *         description: Supported categories.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 categories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:   { type: string, example: food }
 *                       label: { type: string, example: 'Food & Dining' }
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/categories', controller.getCategories.bind(controller));

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
 *     description: |
 *       Partial update. `transactionType` ('credit' = income, 'debit' = expense)
 *       is honored directly; `category` must be one of the keys from
 *       `GET /transactions/categories`. An invalid `transactionType` or unknown
 *       `category` is rejected with 400. AI-only fields are read-only.
 *     tags: [Transactions]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               merchant: { type: string }
 *               amount: { type: number }
 *               currency: { type: string }
 *               category: { type: string, example: subscriptions }
 *               subcategory: { type: string }
 *               transactionType: { type: string, enum: [debit, credit] }
 *               note: { type: string }
 *               transactionDate: { type: string, format: date-time }
 *               isFixedExpense: { type: boolean, description: Marks the transaction as a recurring fixed expense; the value is propagated to every transaction sharing the same category/amount/merchant. }
 *     responses:
 *       200:
 *         description: Updated transaction.
 *       400:
 *         $ref: '#/components/responses/ValidationError'
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
