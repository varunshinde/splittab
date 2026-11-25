// Pure split math — integer cents only, no floats for money.
export interface SplitShare { userId: string; amountOwedInCents: number }

function assertIntCents(n: number, label: string) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer (cents)`);
}

/** Equal split. Rounding remainder (total % n cents) goes 1c each to the FIRST participants, in order. */
export function equalSplit(totalInCents: number, participantIds: string[]): SplitShare[] {
  assertIntCents(totalInCents, "total");
  if (participantIds.length === 0) throw new Error("at least one participant is required");
  const base = Math.floor(totalInCents / participantIds.length);
  let remainder = totalInCents - base * participantIds.length;
  return participantIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { userId, amountOwedInCents: base + extra };
  });
}

/** Exact split. Amounts must sum exactly to the total. */
export function exactSplit(totalInCents: number, shares: SplitShare[]): SplitShare[] {
  assertIntCents(totalInCents, "total");
  shares.forEach((s) => assertIntCents(s.amountOwedInCents, "share"));
  const sum = shares.reduce((a, s) => a + s.amountOwedInCents, 0);
  if (sum !== totalInCents) throw new Error(`exact split amounts (${sum}) must sum to total (${totalInCents})`);
  return shares;
}

/** Percentage split. Each percentage must be an integer 0-100 and they must
 *  sum to 100. Floor each share; remainder cents go to the first participant. */
export function percentageSplit(totalInCents: number, parts: { userId: string; percentage: number }[]): SplitShare[] {
  assertIntCents(totalInCents, "total");
  for (const p of parts) {
    if (!Number.isInteger(p.percentage) || p.percentage < 0 || p.percentage > 100) {
      throw new Error(`each percentage must be an integer between 0 and 100 (got ${p.percentage})`);
    }
  }
  const pctSum = parts.reduce((a, p) => a + p.percentage, 0);
  if (pctSum !== 100) throw new Error(`percentages must sum to 100 (got ${pctSum})`);
  const shares = parts.map((p) => ({
    userId: p.userId,
    amountOwedInCents: Math.floor((totalInCents * p.percentage) / 100),
  }));
  let remainder = totalInCents - shares.reduce((a, s) => a + s.amountOwedInCents, 0);
  for (let i = 0; remainder > 0 && shares.length > 0; i = (i + 1) % shares.length) {
    shares[i].amountOwedInCents += 1; remainder -= 1;
  }
  return shares;
}

export function computeSplit(totalInCents: number, mode: "equal" | "exact" | "percentage", payload: unknown): SplitShare[] {
  if (mode === "equal") return equalSplit(totalInCents, payload as string[]);
  if (mode === "exact") return exactSplit(totalInCents, payload as SplitShare[]);
  return percentageSplit(totalInCents, payload as { userId: string; percentage: number }[]);
}
