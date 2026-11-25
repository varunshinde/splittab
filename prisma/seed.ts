import { prisma } from "../lib/db";
import { STATIC_RATES } from "../lib/currency";

// Reference-data-only seed. There are NO demo users/groups/expenses anymore:
// accounts are created through the real signup flow, and friends/groups are
// created by users. This seeds only what the app needs to function:
// currency exchange rates + the multi-currency feature flag.
async function main() {
  await prisma.currencyRate.deleteMany();
  for (const [key, rateScaled] of Object.entries(STATIC_RATES)) {
    const [fromCurrency, toCurrency] = key.split("->");
    if (fromCurrency !== toCurrency) {
      await prisma.currencyRate.create({ data: { fromCurrency, toCurrency, rateScaled } });
    }
  }
  await prisma.featureFlag.upsert({
    where: { key: "multi-currency" },
    create: { key: "multi-currency", enabledForUserIds: [] },
    update: {},
  });
  console.log("Seeded reference data: currency rates + multi-currency feature flag (no users).");
}
main().finally(() => prisma.$disconnect());
