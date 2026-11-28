import { describe, it, expect } from "vitest";
import { parseReceiptText } from "../lib/ocr-parse";

const RECEIPT = `
TASCA DO CHICO
Rua Garrett 12, Lisbon
Tel: 213 420 000

Grilled sardines        18.00
Seafood rice for two    32.00
2 x Vinho verde         14.00
Octopus salad           21.00
Pasteis de nata          9.00

Subtotal                94.00
Tax                      5.64
Tip                     10.00
TOTAL                  109.64
Cash                   120.00
Change                  10.36
Thank you!
`;

describe("parseReceiptText", () => {
  it("extracts item lines with prices and skips the bill footer", () => {
    const { items } = parseReceiptText(RECEIPT);
    expect(items.map((i) => i.description)).toEqual([
      "Grilled sardines",
      "Seafood rice for two",
      "Vinho verde",
      "Octopus salad",
      "Pasteis de nata",
    ]);
    expect(items.map((i) => i.amountInCents)).toEqual([1800, 3200, 1400, 2100, 900]);
  });

  it("captures the printed total separately", () => {
    const { totalInCents } = parseReceiptText(RECEIPT);
    expect(totalInCents).toBe(10964);
  });

  it("handles $ signs and decimal commas", () => {
    const { items, totalInCents } = parseReceiptText("Coffee $3.50\nCroissant 4,25\nTotal $7.75\n");
    expect(items).toEqual([
      { description: "Coffee", amountInCents: 350 },
      { description: "Croissant", amountInCents: 425 },
    ]);
    expect(totalInCents).toBe(775);
  });

  it("returns nothing for text without priced lines", () => {
    const { items, totalInCents } = parseReceiptText("hello world\nno prices here\n");
    expect(items).toEqual([]);
    expect(totalInCents).toBeNull();
  });
});
