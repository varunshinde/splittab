import { convertCurrency } from "./currency";
import type { BalanceExpense, BalanceSettlement } from "./balances";

// Multi-currency handling for aggregate views: each expense/settlement is
// converted into the target currency (per split line, integer math) before
// the pure balance functions run. Same-currency values pass through exact.

export function expenseToCurrency<T extends BalanceExpense & { currency: string }>(e: T, target: string): BalanceExpense & { currency: string } {
  if (e.currency === target) return e;
  return {
    ...e,
    currency: target,
    splits: e.splits.map((s) => ({ ...s, amountOwedInCents: convertCurrency(s.amountOwedInCents, e.currency, target) })),
  };
}

export function settlementToCurrency<T extends BalanceSettlement & { currency: string }>(s: T, target: string): BalanceSettlement & { currency: string } {
  if (s.currency === target) return s;
  return { ...s, currency: target, amountInCents: convertCurrency(s.amountInCents, s.currency, target) };
}
