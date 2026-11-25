// Currency conversion with scaled-integer rates (rate * 1_000_000). No floats.
// TODO: plug in Open Exchange Rates API behind this same interface.
export const RATE_SCALE = 1_000_000;

export type RateTable = Record<string, number>; // key "FROM->TO" -> rateScaled (Int)

export const STATIC_RATES: RateTable = {
  "USD->USD": 1_000_000,
  "EUR->USD": 1_250_000, "USD->EUR": 800_000, // exact reciprocals: round-trip is lossless
  "GBP->USD": 1_250_000, "USD->GBP": 800_000,
  "USD->INR": 83_000_000, "INR->USD": 12_048,
  "EUR->GBP": 1_000_000, "GBP->EUR": 1_000_000,
};

function divRoundHalfUp(numerator: number, denominator: number): number {
  // integer-only rounding for non-negative values
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

export function convertWithRate(amountInCents: number, rateScaled: number): number {
  if (!Number.isInteger(amountInCents) || !Number.isInteger(rateScaled)) throw new Error("amount and rate must be integers");
  return divRoundHalfUp(amountInCents * rateScaled, RATE_SCALE);
}

export function convertCurrency(amountInCents: number, from: string, to: string, rates: RateTable = STATIC_RATES): number {
  if (from === to) return amountInCents;
  const direct = rates[`${from}->${to}`];
  if (direct !== undefined) return convertWithRate(amountInCents, direct);
  // Pivot through USD with integer math at each leg.
  const toUsd = rates[`${from}->USD`];
  const fromUsd = rates[`USD->${to}`];
  if (toUsd === undefined || fromUsd === undefined) throw new Error(`no rate for ${from}->${to}`);
  return convertWithRate(convertWithRate(amountInCents, toUsd), fromUsd);
}
