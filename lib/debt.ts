// Pure balance + settlement math — integer cents only.
export interface DebtTransfer { from: string; to: string; amountInCents: number }

/** Net balance per user: positive = should receive, negative = owes. Payer is credited the full amount; each split debits its user. */
export function computeBalances(expenses: { paidById: string; splits: { userId: string; amountOwedInCents: number }[] }[]): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (id: string, delta: number) => balances.set(id, (balances.get(id) ?? 0) + delta);
  for (const e of expenses) {
    add(e.paidById, e.splits.reduce((a, s) => a + s.amountOwedInCents, 0));
    for (const s of e.splits) add(s.userId, -s.amountOwedInCents);
  }
  return balances;
}

/** Greedy debt simplification: repeatedly match the largest debtor with the largest creditor. Minimizes transfer count (at most n-1 transfers for n non-zero balances). */
export function computeSimplifiedDebts(balances: Map<string, number> | Record<string, number>): DebtTransfer[] {
  const entries = (balances instanceof Map ? [...balances.entries()] : Object.entries(balances))
    .filter(([, v]) => v !== 0)
    .map(([userId, v]) => ({ userId, amount: v }));
  const total = entries.reduce((a, e) => a + e.amount, 0);
  if (total !== 0) throw new Error(`balances must sum to zero (got ${total})`);
  const creditors = entries.filter((e) => e.amount > 0).sort((a, b) => b.amount - a.amount);
  const debtors = entries.filter((e) => e.amount < 0).map((e) => ({ userId: e.userId, amount: -e.amount })).sort((a, b) => b.amount - a.amount);
  const transfers: DebtTransfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0) transfers.push({ from: debtors[i].userId, to: creditors[j].userId, amountInCents: pay });
    debtors[i].amount -= pay; creditors[j].amount -= pay;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }
  return transfers;
}
