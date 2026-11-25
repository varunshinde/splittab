import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaNeon } from "@prisma/adapter-neon";
// Prisma 7: no binary query engine — a driver adapter talks to Postgres.
// Neon hosts (serverless/Vercel) use the Neon adapter over HTTPS/WebSocket;
// anything else (local Docker Postgres) uses the plain pg adapter.
const connectionString = process.env.DATABASE_URL;
const isNeon = !!connectionString && connectionString.includes("neon.tech");
const adapter = isNeon
  ? new PrismaNeon({ connectionString })
  : new PrismaPg({ connectionString });
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
