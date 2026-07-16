import { randomUUID } from 'crypto';
import { Transaction } from '../../../temporal-workflows/src/models';
import { normalizeMerchant } from '../../../temporal-workflows/src/shared/normalize-merchant';
import { SUPPORTED_TRANSACTION_CATEGORIES } from '../../../temporal-workflows/src/shared/categories';
import { findInheritedFixedExpense } from '../../../temporal-workflows/src/shared/fixed-expense';
import { fixedExpenseWindowStart, utcDayRange } from '../utils/date.utils';
import { escapeRegex } from '../utils/request.utils';
import type {
  BalanceDTO,
  BalanceFilters,
  CreateTransactionInput,
  FixedExpensesSummaryDTO,
  SpendingPaceDTO,
  SupportedCategoryDTO,
  TransactionDTO,
  TransactionFilters,
} from '../types/transaction.types';

/** Amber once projected spend passes the variable budget; red past this ratio. */
const SPENDING_PACE_NEAR_RATIO = 1.15;

/**
 * Pure spending-pace computation (no IO → unit-testable). Given the period's
 * variable + total expenses, the budget cap, and the current date, derives the
 * daily average, the projected month-end spend, and a colour status. See the
 * change's design.md for the model.
 */
export function computeSpendingPace(input: {
  variableExpenses: number;
  /** All expense (debit) total in range — used to derive fixed already posted. */
  debits: number;
  budgetLimit: number;
  /** Recurring fixed-expense total (reused from computeFixedExpensesTotal). */
  fixedExpenses: number;
  now: Date;
}): SpendingPaceDTO {
  const { variableExpenses, debits, budgetLimit, fixedExpenses, now } = input;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.max(1, now.getDate());

  // Subtract the recurring fixed commitment (deduped previous+current month) —
  // not just the fixed charges posted so far this range — so the discretionary
  // budget reflects what is actually fixed, including charges not yet posted.
  const variableBudget = Math.max(0, budgetLimit - Math.max(0, fixedExpenses));

  const dailyAverage = variableExpenses / daysElapsed;
  const expectedDailyAverage = variableBudget / daysInMonth;
  // The variable projection drives the colour/status; the displayed projection
  // also adds committed fixed costs for the realistic month-end total.
  const projectedVariable = dailyAverage * daysInMonth;
  const projectedExpenses = projectedVariable + Math.max(0, fixedExpenses);

  // Discretionary money still available this month, and that spread over the
  // remaining days (today included, so day-1-fresh equals the flat target). The
  // reserve is the fixed commitment not yet posted — why this is below the raw
  // budget balance.
  const remainingDays = Math.max(1, daysInMonth - daysElapsed + 1);
  const remainingVariable = Math.max(0, variableBudget - variableExpenses);
  const fixedPosted = Math.max(0, debits - variableExpenses);
  const safeToSpendRemaining = budgetLimit > 0 ? round2(remainingVariable) : null;
  const safeToSpendPerDay = budgetLimit > 0 ? round2(remainingVariable / remainingDays) : null;
  // Fixed still pending to pay — budget-independent (it's about fixed commitments).
  const reservedForFixed = round2(Math.max(0, Math.max(0, fixedExpenses) - fixedPosted));

  // Signed budget variance vs the expected daily rate (null when no target).
  const variancePct =
    expectedDailyAverage > 0
      ? Math.round(((dailyAverage - expectedDailyAverage) / expectedDailyAverage) * 100)
      : null;

  let status: SpendingPaceDTO['status'];
  if (budgetLimit <= 0) {
    status = 'none';
  } else if (variableBudget <= 0) {
    // No room for variable spend — anything but zero is over.
    status = projectedVariable > 0 ? 'over' : 'under';
  } else {
    const ratio = projectedVariable / variableBudget;
    status = ratio <= 1 ? 'under' : ratio <= SPENDING_PACE_NEAR_RATIO ? 'near' : 'over';
  }

  return {
    dailyAverage: round2(dailyAverage),
    expectedDailyAverage: round2(expectedDailyAverage),
    projectedExpenses: round2(projectedExpenses),
    variableBudget: round2(variableBudget),
    variancePct,
    safeToSpendRemaining,
    safeToSpendPerDay,
    reservedForFixed,
    status,
    daysElapsed,
    daysInMonth,
  };
}

/**
 * Thrown when a write would mark a credit (income) transaction as a fixed
 * expense. A fixed expense is by definition an expense (debit). The controller
 * maps this to HTTP 400.
 */
export class FixedExpenseOnIncomeError extends Error {
  constructor() {
    super('isFixedExpense can only be set on expense (debit) transactions');
    this.name = 'FixedExpenseOnIncomeError';
  }
}

function toDTO(tx: any): TransactionDTO {
  return {
    id: tx._id.toString(),
    userId: tx.userId,
    transactionDate: new Date(tx.transactionDate).toISOString(),
    merchant: tx.merchant,
    amount: tx.transactionType === 'credit' ? Math.abs(tx.amount) : -Math.abs(tx.amount),
    category: tx.category,
    source: tx.source ?? 'email',
    account: tx.accountNumber
      ? `${tx.bankName ?? ''} •${tx.accountNumber.slice(-4)}`.trim()
      : undefined,
    note: tx.note,
    isIncome: tx.transactionType === 'credit',
    isFixedExpense: tx.isFixedExpense ?? false,
    isRecurrent: tx.isRecurrent ?? false,
    aiConfidence: tx.confidence,
    createdAt: tx.createdAt,
  };
}

export class TransactionService {
  async list(userId: string, filters: TransactionFilters) {
    const { limit, offset, category, search, startDate, endDate, isFixedExpense, isRecurrent } =
      filters;
    const query: Record<string, any> = { userId };

    if (category && category !== 'all') query.category = category;

    // Rows persisted before the flags existed have no field at all — `$ne: true`
    // makes a `false` filter match them, while `true` naturally excludes them.
    if (isFixedExpense !== undefined) {
      query.isFixedExpense = isFixedExpense ? true : { $ne: true };
    }
    if (isRecurrent !== undefined) {
      query.isRecurrent = isRecurrent ? true : { $ne: true };
    }

    const dateRange = utcDayRange(startDate, endDate);
    if (dateRange) query.transactionDate = dateRange;

    if (search) {
      const safe = escapeRegex(search);
      query.$or = [
        { merchant: { $regex: safe, $options: 'i' } },
        { note: { $regex: safe, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      Transaction.find(query).sort({ transactionDate: -1 }).skip(offset).limit(limit).lean(),
      Transaction.countDocuments(query),
    ]);

    return {
      transactions: docs.map(toDTO),
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    };
  }

  async create(userId: string, input: CreateTransactionInput): Promise<TransactionDTO> {
    const transactionDate = new Date(input.transactionDate);
    const merchant = normalizeMerchant(input.merchant);
    const amount = Math.abs(input.amount);
    const category = input.category;
    const transactionType = resolveTransactionType(input) ?? 'debit';

    // A fixed expense is by definition an expense — reject marking income.
    if (input.isFixedExpense === true && transactionType === 'credit') {
      throw new FixedExpenseOnIncomeError();
    }

    // A new expense inherits the fixed-expense flag from a matching one in the
    // previous month, so recurring costs stay flagged without re-marking. An
    // explicit `isFixedExpense: true` from the caller always wins. Income never
    // qualifies, so the flag (and the inheritance lookup) is debit-only.
    const isFixedExpense =
      transactionType === 'debit' &&
      (input.isFixedExpense === true ||
        (await findInheritedFixedExpense({ userId, category, amount, merchant, transactionDate })));

    const doc = await Transaction.create({
      userId,
      // Synthetic id so the sparse-unique { userId, emailId } index gets a unique
      // value per manual row — a compound sparse index still indexes documents
      // that have `userId`, so omitting emailId would collide on { userId, null }.
      // Future imports can still dedup against real provider message ids.
      emailId: `manual-${randomUUID()}`,
      transactionDate,
      merchant,
      amount,
      currency: input.currency ?? 'USD',
      category,
      subcategory: input.subcategory,
      transactionType,
      source: input.source ?? 'manual',
      accountNumber: input.account,
      note: input.note,
      isFixedExpense,
      isRecurrent: input.isRecurrent ?? false,
    });
    return toDTO(doc.toObject());
  }

  /** The canonical, supported category taxonomy ({ key, label }), display-ordered. */
  listCategories(): SupportedCategoryDTO[] {
    return SUPPORTED_TRANSACTION_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));
  }

  async getById(userId: string, id: string): Promise<TransactionDTO | null> {
    const doc = await Transaction.findOne({ _id: id, userId }).lean();
    return doc ? toDTO(doc) : null;
  }

  async update(userId: string, id: string, input: Partial<CreateTransactionInput>): Promise<TransactionDTO | null> {
    const updates: Record<string, any> = {};
    if (input.merchant !== undefined) updates.merchant = normalizeMerchant(input.merchant);
    if (input.category !== undefined) updates.category = input.category;
    if (input.subcategory !== undefined) updates.subcategory = input.subcategory;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.note !== undefined) updates.note = input.note;
    if (input.source !== undefined) updates.source = input.source;
    if (input.isFixedExpense !== undefined) updates.isFixedExpense = input.isFixedExpense;
    if (input.isRecurrent !== undefined) updates.isRecurrent = input.isRecurrent;
    const transactionType = resolveTransactionType(input);
    if (transactionType !== undefined) updates.transactionType = transactionType;
    if (input.amount !== undefined) updates.amount = Math.abs(input.amount);
    if (input.transactionDate) updates.transactionDate = new Date(input.transactionDate);

    // A fixed expense is by definition an expense: reject marking a row that is
    // (or stays) income. A request that flips the row to debit in the same call
    // is allowed. Checked against the resulting type before writing.
    if (input.isFixedExpense === true) {
      const existing = await Transaction.findOne({ _id: id, userId }).lean();
      if (!existing) return null;
      const resultingType = transactionType ?? existing.transactionType;
      if (resultingType === 'credit') throw new FixedExpenseOnIncomeError();
    }

    const doc = await Transaction.findOneAndUpdate({ _id: id, userId }, { $set: updates }, { new: true }).lean();
    if (!doc) return null;

    // A fixed expense is recurring, so the flag applies to the whole group: every
    // transaction of this user sharing the (category, amount, merchant) signature
    // is marked/unmarked together. Idempotent and tenant-scoped by construction.
    if (input.isFixedExpense !== undefined) {
      await this.propagateFixedExpense(userId, doc, input.isFixedExpense);
    }
    return toDTO(doc);
  }

  /**
   * Applies `value` to transactions owned by `userId` that share the target's
   * fixed-expense signature (same category, amount, and merchant) AND fall within
   * the 3-month trailing window anchored on the target's date — from the first of
   * the month two months before the target's month, through the target's date.
   * The target itself is already updated by the caller (so it is flagged even if
   * it sits outside the window). Pure data op — no external I/O, no Temporal.
   */
  private async propagateFixedExpense(
    userId: string,
    target: { category: string; amount: number; merchant: string; transactionDate: Date },
    value: boolean,
  ): Promise<void> {
    const anchor = new Date(target.transactionDate);
    await Transaction.updateMany(
      {
        userId,
        // Income is never a fixed expense — only propagate to debit siblings.
        transactionType: 'debit',
        category: target.category,
        amount: target.amount,
        merchant: target.merchant,
        transactionDate: { $gte: fixedExpenseWindowStart(anchor), $lte: anchor },
      },
      { $set: { isFixedExpense: value } },
    );
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await Transaction.findOneAndDelete({ _id: id, userId });
    return result !== null;
  }

  /**
   * Aggregates credit and debit totals for the user over an optional
   * date range. Net balance is `credits - debits`. Amounts in storage
   * are always non-negative; the sign is implied by `transactionType`.
   */
  async getBalance(userId: string, filters: BalanceFilters): Promise<BalanceDTO> {
    const match: Record<string, unknown> = { userId };
    const dateRange = utcDayRange(filters.startDate, filters.endDate);
    if (dateRange) match.transactionDate = dateRange;

    // One pass: transaction-type totals AND the debit breakdown by category.
    // The fixed-expense total is computed separately (it spans the previous +
    // current month, not the requested range — see computeFixedExpensesTotal).
    const [facet] = await Transaction.aggregate<{
      totals: { _id: 'credit' | 'debit'; total: number; count: number }[];
      byCategory: { _id: string | null; spent: number }[];
      variable: { _id: null; total: number }[];
    }>([
      { $match: match },
      {
        $facet: {
          totals: [
            { $group: { _id: '$transactionType', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          ],
          byCategory: [
            { $match: { transactionType: 'debit' } },
            { $group: { _id: '$category', spent: { $sum: '$amount' } } },
            { $sort: { spent: -1 } },
          ],
          // Variable (non-fixed) expenses in range — powers the dashboard's
          // discretionary daily-average, so committed fixed costs don't inflate it.
          variable: [
            { $match: { transactionType: 'debit', isFixedExpense: { $ne: true } } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ],
        },
      },
    ]);

    let credits = 0;
    let debits = 0;
    let count = 0;
    for (const row of facet?.totals ?? []) {
      if (row._id === 'credit') credits = row.total;
      else if (row._id === 'debit') debits = row.total;
      count += row.count;
    }

    // Spent is left unrounded here so the breakdown sums exactly to `debits`;
    // clients round for display.
    const byCategory = (facet?.byCategory ?? []).map((row) => ({
      category: row._id ?? 'other',
      spent: row.spent,
    }));

    const variableExpenses = facet?.variable?.[0]?.total ?? 0;

    return {
      credits: round2(credits),
      debits: round2(debits),
      balance: round2(credits - debits),
      count,
      byCategory,
      variableExpenses: round2(variableExpenses),
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
  }

  /**
   * Recurring fixed-expense summary for the user. A dedicated resource (not a
   * field on the range-scoped balance) because it answers a different question —
   * "what are my active committed costs?" — anchored on the server date rather
   * than a requested range.
   */
  async getFixedExpensesSummary(userId: string): Promise<FixedExpensesSummaryDTO> {
    return { total: round2(await this.computeFixedExpensesTotal(userId)) };
  }

  /**
   * Spending pace for the period: variable daily average, projected month-end
   * spend, and a status colour vs the variable budget. `budgetLimit` is the
   * caller's current monthly budget (0 when none), passed in so this service
   * does not depend on the budget service.
   */
  async getSpendingPace(
    userId: string,
    filters: BalanceFilters,
    budgetLimit: number,
  ): Promise<SpendingPaceDTO> {
    const balance = await this.getBalance(userId, filters);
    // Reuse the existing recurring fixed-expense total — no separate query type.
    const fixedExpenses = await this.computeFixedExpensesTotal(userId);
    return computeSpendingPace({
      variableExpenses: balance.variableExpenses,
      debits: balance.debits,
      budgetLimit,
      fixedExpenses,
      now: new Date(),
    });
  }

  /**
   * The user's currently-active recurring fixed-expense total: the sum over the
   * DISTINCT fixed-expense signatures (category, amount, merchant) of their fixed
   * (debit, `isFixedExpense`) transactions dated in the previous OR current
   * calendar month, anchored on the server's current date. De-duplicating by
   * signature means an expense recurring in both months is counted once, so the
   * result is "all of last month's fixed expenses plus this month's new ones".
   */
  private async computeFixedExpensesTotal(userId: string): Promise<number> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [row] = await Transaction.aggregate<{ total: number }>([
      {
        $match: {
          userId,
          transactionType: 'debit',
          isFixedExpense: true,
          transactionDate: { $gte: start, $lte: end },
        },
      },
      // Collapse to one entry per signature so a charge recurring in both months
      // counts once; `amount` is part of the key, so it carries through.
      { $group: { _id: { category: '$category', amount: '$amount', merchant: '$merchant' } } },
      { $group: { _id: null, total: { $sum: '$_id.amount' } } },
    ]);

    return row?.total ?? 0;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolves the transaction direction from an input payload. `transactionType`
 * is authoritative; the legacy `isIncome` boolean is honored only as a fallback
 * for older clients. Returns `undefined` when neither field is present (so a
 * partial update leaves the stored value untouched).
 */
function resolveTransactionType(
  input: Partial<CreateTransactionInput>,
): 'debit' | 'credit' | undefined {
  if (input.transactionType !== undefined) return input.transactionType;
  if (input.isIncome !== undefined) return input.isIncome ? 'credit' : 'debit';
  return undefined;
}
