// Pairwise balance math — pure, integer cents only.
//
// The ledger rule: for an expense paid by P, every participant X != P owes P
// exactly X's split share. A settlement from F to T is a payment that moves
// the F<->T balance by the settled amount. This one rule yields per-friend
// nets across BOTH friend (non-group) expenses and group expenses, with no
// double counting: a user's total net is the sum of their pairwise nets.

export interface BalanceExpense {
  paidById: string;
  splits: { userId: string; amountOwedInCents: number }[];
  /** N5: a voided expense is history only — it moves no balances. */
  voidedAt?: Date | null;
}

const active = (e: BalanceExpense) => !e.voidedAt;
export interface BalanceSettlement {
  fromUserId: string;
  toUserId: string;
  amountInCents: number;
  /** N3: only CONFIRMED settlements move balances. Absent = legacy row
   *  created before confirmation existed, which counts. R6:
   *  VOID_REQUESTED still counts — a void takes effect only when the
   *  other party agrees to it. */
  status?: string;
}

const counts = (s: BalanceSettlement) => !s.status || s.status === "CONFIRMED" || s.status === "VOID_REQUESTED";

/**
 * Net amount `otherId` owes `meId`, in cents. Positive = they owe me,
 * negative = I owe them. Only expenses/settlements involving both count.
 */
export function netBetween(
  meId: string,
  otherId: string,
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[] = [],
): number {
  let net = 0;
  for (const e of expenses) {
    if (!active(e)) continue;
    if (e.paidById === meId) {
      const s = e.splits.find((x) => x.userId === otherId);
      if (s) net += s.amountOwedInCents;
    } else if (e.paidById === otherId) {
      const s = e.splits.find((x) => x.userId === meId);
      if (s) net -= s.amountOwedInCents;
    }
  }
  for (const s of settlements) {
    if (!counts(s)) continue;
    if (s.fromUserId === meId && s.toUserId === otherId) net += s.amountInCents;
    else if (s.fromUserId === otherId && s.toUserId === meId) net -= s.amountInCents;
  }
  return net;
}

/**
 * Pairwise nets for `meId` against every counterparty in the data.
 * Returns a Map counterpartyId -> net cents (positive = they owe me).
 * Counterparties with a zero net are omitted.
 */
export function pairwiseNets(
  meId: string,
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[] = [],
): Map<string, number> {
  const nets = new Map<string, number>();
  const bump = (otherId: string, delta: number) => {
    if (otherId === meId || delta === 0) return;
    nets.set(otherId, (nets.get(otherId) ?? 0) + delta);
  };
  for (const e of expenses) {
    if (!active(e)) continue;
    for (const s of e.splits) {
      if (s.userId === e.paidById) continue;
      // participant owes the payer; express from meId's perspective
      if (e.paidById === meId) bump(s.userId, s.amountOwedInCents);
      else if (s.userId === meId) bump(e.paidById, -s.amountOwedInCents);
    }
  }
  for (const s of settlements) {
    if (!counts(s)) continue;
    if (s.fromUserId === meId) bump(s.toUserId, s.amountInCents);
    else if (s.toUserId === meId) bump(s.fromUserId, -s.amountInCents);
  }
  for (const [k, v] of nets) if (v === 0) nets.delete(k);
  return nets;
}

/** My net within one expense set (e.g. one group): positive = I get back. */
export function myNet(meId: string, expenses: BalanceExpense[], settlements: BalanceSettlement[] = []): number {
  let net = 0;
  for (const e of expenses) {
    if (!active(e)) continue;
    const total = e.splits.reduce((a, s) => a + s.amountOwedInCents, 0);
    const mine = e.splits.find((s) => s.userId === meId)?.amountOwedInCents ?? 0;
    net += e.paidById === meId ? total - mine : -mine;
  }
  for (const s of settlements) {
    if (!counts(s)) continue;
    if (s.fromUserId === meId) net += s.amountInCents;
    if (s.toUserId === meId) net -= s.amountInCents;
  }
  return net;
}

/** Splitwise dashboard totals from pairwise nets. */
export function dashboardTotals(nets: Map<string, number>): { total: number; youOwe: number; youAreOwed: number } {
  let total = 0, youOwe = 0, youAreOwed = 0;
  for (const v of nets.values()) {
    total += v;
    if (v > 0) youAreOwed += v;
    else youOwe += -v;
  }
  return { total, youOwe, youAreOwed };
}
