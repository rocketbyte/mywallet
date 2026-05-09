export interface BudgetCategoryDTO {
  category: string;
  budget: number;
  spent: number;
}

export interface BudgetDTO {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  limit_amount: number;
  categories: BudgetCategoryDTO[];
}

export interface UpsertBudgetInput {
  period_start?: string;
  limit_amount: number;
  categories?: { category: string; budget: number }[];
}
