import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { STATIC_RATES } from "../lib/currency";
import { equalSplit } from "../lib/splits";
import { tripPassExpiry } from "../lib/pro";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  await prisma.activity.deleteMany(); await prisma.expenseItem.deleteMany(); await prisma.expenseSplit.deleteMany();
  await prisma.expense.deleteMany(); await prisma.receipt.deleteMany(); await prisma.tripPass.deleteMany();
  await prisma.defaultSplit.deleteMany(); await prisma.featureFlag.deleteMany(); await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany(); await prisma.user.deleteMany(); await prisma.currencyRate.deleteMany();

  const [alice, bob, carol] = await Promise.all([
    prisma.user.create({ data: { name: "Alice", email: "alice@example.com", isPro: true } }),
    prisma.user.create({ data: { name: "Bob", email: "bob@example.com" } }),
    prisma.user.create({ data: { name: "Carol", email: "carol@example.com" } }),
  ]);
  const paris = await prisma.group.create({ data: { name: "Trip to Paris", baseCurrency: "EUR", members: { create: [{ userId: alice.id }, { userId: bob.id }, { userId: carol.id }] } } });
  const home = await prisma.group.create({ data: { name: "Household", baseCurrency: "USD", members: { create: [{ userId: alice.id }, { userId: bob.id }] } } });

  const mk = async (groupId: string, description: string, amountInCents: number, paidById: string, category: string, currency = "EUR") => {
    const members = await prisma.groupMember.findMany({ where: { groupId } });
    return prisma.expense.create({ data: { groupId, description, amountInCents, paidById, category, currency, splits: { create: equalSplit(amountInCents, members.map((m) => m.userId)) } } });
  };
  const dinner = await mk(paris.id, "Dinner in Paris", 9000, alice.id, "Food");
  await mk(paris.id, "Museum tickets", 4500, bob.id, "Activities");
  await mk(paris.id, "Taxi", 3001, carol.id, "Transport");
  await mk(home.id, "Groceries", 12000, alice.id, "Food", "USD");
  await mk(home.id, "Utilities", 8000, bob.id, "Bills", "USD");

  const receipt = await prisma.receipt.create({ data: { filePath: "public/uploads/seed-receipt.txt", fileSizeBytes: 128n } });
  await prisma.expense.update({ where: { id: dinner.id }, data: { receiptId: receipt.id } });
  await prisma.expenseItem.createMany({ data: [
    { expenseId: dinner.id, description: "Pasta", amountInCents: 3000, assignedToUserId: alice.id },
    { expenseId: dinner.id, description: "Salad", amountInCents: 2500, assignedToUserId: bob.id },
    { expenseId: dinner.id, description: "Wine (shared)", amountInCents: 3500, assignedToUserId: null },
  ]});
  await prisma.defaultSplit.create({ data: { userId: alice.id, groupId: home.id, percentage: 55 } });
  await prisma.defaultSplit.create({ data: { userId: bob.id, otherUserId: alice.id, percentage: 45 } });
  for (const [key, rateScaled] of Object.entries(STATIC_RATES)) {
    const [fromCurrency, toCurrency] = key.split("->");
    if (fromCurrency !== toCurrency) await prisma.currencyRate.create({ data: { fromCurrency, toCurrency, rateScaled } });
  }
  await prisma.featureFlag.create({ data: { key: "early-access-charts-v2", enabledForUserIds: [alice.id] } });
  await prisma.tripPass.create({ data: { grantedByUserId: alice.id, groupId: paris.id, expiresAt: tripPassExpiry(new Date()) } });
  await prisma.activity.createMany({ data: [
    { groupId: paris.id, userId: alice.id, type: "expense_added", message: 'Expense "Dinner in Paris" added' },
    { groupId: paris.id, userId: alice.id, type: "trip_pass_granted", message: "Trip Pass granted (30 days)" },
  ]});
  console.log("Seeded: 3 users (Alice isPro), 2 groups, 5 expenses, items, receipt, default splits, rates, flag, trip pass");
}
main().finally(() => prisma.$disconnect());
