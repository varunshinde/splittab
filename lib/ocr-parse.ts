// Receipt OCR text -> item suggestions. Pure and deliberately conservative:
// a line becomes an item only when it ends in a price and doesn't look like
// a bill footer (total/tax/tip/payment lines are captured separately or
// skipped). Everything the parser produces is a SUGGESTION — the UI makes
// the user review and edit before anything is saved, because OCR misreads
// happen and money amounts must be right.

export interface OcrSuggestion {
  description: string;
  amountInCents: number;
}

export interface ParsedReceipt {
  items: OcrSuggestion[];
  /** The bill's total as printed, when a total line was found. */
  totalInCents: number | null;
}

const SKIP_LINE = /\b(subtotal|sub-total|tax|tip|gratuity|service charge|change|cash|visa|mastercard|amex|discover|debit|credit|tendered|thank|welcome|please come|server|table|guests?|order|phone|tel|www|http|invoice|receipt|copy|balance forward)\b/i;
const TOTAL_LINE = /\b(grand total|total due|amount due|balance due|total)\b/i;
// A price at the very end of the line: optional currency symbol, digits,
// decimal point or comma, exactly two decimal digits.
const PRICE_AT_END = /[$€£]?\s*(\d{1,5})[.,](\d{2})\s*-?\s*$/;

function cleanDescription(raw: string): string {
  let d = raw
    .replace(/[$€£]?\s*\d{1,5}[.,]\d{2}\s*-?\s*$/, "") // the price itself
    .replace(/^\s*\d+\s*[x×]\s*/i, "") // leading "2 x " quantity
    .replace(/^\s*\d+\s+/, "") // leading bare quantity "2 "
    .replace(/[.\-_#*~]+$/g, "") // trailing leaders/separators
    .replace(/\s{2,}/g, " ")
    .trim();
  return d;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const items: OcrSuggestion[] = [];
  let totalInCents: number | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 4) continue;
    const m = line.match(PRICE_AT_END);
    if (!m) continue;
    const cents = Number(m[1]) * 100 + Number(m[2]);
    if (TOTAL_LINE.test(line) && !/sub/i.test(line)) {
      // Prefer the largest total-looking line (grand total over total).
      if (totalInCents === null || cents > totalInCents) totalInCents = cents;
      continue;
    }
    if (SKIP_LINE.test(line)) continue;
    const description = cleanDescription(line);
    if (description.replace(/[^a-zA-Z]/g, "").length < 2) continue;
    if (cents <= 0) continue;
    items.push({ description: description.slice(0, 100), amountInCents: cents });
    if (items.length >= 60) break;
  }
  return { items, totalInCents };
}
