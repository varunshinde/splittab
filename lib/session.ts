import { cookies } from "next/headers";
export const SESSION_COOKIE = "oss-splitwise-user";
// Simple "select user" session for MVP — no passwords, no OAuth (explicit non-goal).
export async function getCurrentUserId(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
export function formatMoney(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${currency} ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
